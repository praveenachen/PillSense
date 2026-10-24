"""Single-owner webcam lifecycle for the local PillSense vision bridge."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
import threading
import time
from typing import Callable, Protocol

from .events import GestureDebouncer, ObservationEvent, ObservationType


class Capture(Protocol):
    def isOpened(self) -> bool: ...
    def read(self) -> tuple[bool, object]: ...
    def release(self) -> None: ...
    def set(self, prop: int, value: float) -> bool: ...


class Detector(Protocol):
    def process(self, frame: object, annotate: bool = False): ...
    def close(self) -> None: ...


class SessionStatus(str, Enum):
    ACTIVE = "ACTIVE"
    STOPPED = "STOPPED"
    ERROR = "ERROR"
    EXPIRED = "EXPIRED"


@dataclass
class SessionRecord:
    session_id: str
    status: SessionStatus
    started_at: int
    events: list[ObservationEvent]
    stop_requested: threading.Event
    thread: threading.Thread | None = None


class CameraBusyError(RuntimeError):
    pass


class SessionNotFoundError(RuntimeError):
    pass


def _default_capture(camera_index: int) -> Capture:
    import cv2

    capture = cv2.VideoCapture(camera_index)
    capture.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    capture.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    return capture


def _default_detector() -> Detector:
    from .detector import HandMouthDetector

    return HandMouthDetector()


class CameraSessionManager:
    """Owns at most one capture and stores only small observation messages."""

    def __init__(
        self,
        camera_index: int = 0,
        timeout_seconds: float = 300.0,
        frame_interval_seconds: float = 0.03,
        capture_factory: Callable[[int], Capture] = _default_capture,
        detector_factory: Callable[[], Detector] = _default_detector,
    ):
        self.camera_index = camera_index
        self.timeout_seconds = timeout_seconds
        self.frame_interval_seconds = frame_interval_seconds
        self.capture_factory = capture_factory
        self.detector_factory = detector_factory
        self._lock = threading.RLock()
        self._active: SessionRecord | None = None
        self._starting_session_id: str | None = None
        self._sessions: dict[str, SessionRecord] = {}

    def health(self) -> dict[str, object]:
        with self._lock:
            active = self._active
            return {
                "service": "ready",
                "cameraOwnerActive": (active is not None and active.status == SessionStatus.ACTIVE) or self._starting_session_id is not None,
                "activeSessionId": active.session_id if active else self._starting_session_id,
                "cameraIndex": self.camera_index,
                "rawFramesStored": False,
            }

    def start(self, session_id: str) -> dict[str, object]:
        with self._lock:
            if self._active is not None and self._active.status == SessionStatus.ACTIVE:
                if self._active.session_id == session_id:
                    return self.snapshot(session_id)
                raise CameraBusyError("The webcam is already owned by another observation session")
            if self._starting_session_id is not None:
                raise CameraBusyError("The webcam is already starting for another observation session")
            existing = self._sessions.get(session_id)
            if existing:
                return self.snapshot(session_id)
            self._starting_session_id = session_id

        record = SessionRecord(
            session_id=session_id,
            status=SessionStatus.ACTIVE,
            started_at=int(time.time() * 1000),
            events=[],
            stop_requested=threading.Event(),
        )
        try:
            capture = self.capture_factory(self.camera_index)
        except Exception as exc:
            record.status = SessionStatus.ERROR
            self._emit(record, ObservationType.CAMERA_ERROR, f"Camera initialization failed: {type(exc).__name__}")
            self._emit(record, ObservationType.CAMERA_STOPPED, "Camera never became active")
            with self._lock:
                self._starting_session_id = None
                self._remember(record)
            return self._snapshot_record(record)
        if not capture.isOpened():
            capture.release()
            record.status = SessionStatus.ERROR
            self._emit(record, ObservationType.CAMERA_ERROR, "Camera unavailable or permission denied")
            self._emit(record, ObservationType.CAMERA_STOPPED, "Camera never became active")
            with self._lock:
                self._starting_session_id = None
                self._remember(record)
            return self._snapshot_record(record)

        try:
            detector = self.detector_factory()
        except Exception as exc:
            capture.release()
            record.status = SessionStatus.ERROR
            self._emit(record, ObservationType.CAMERA_ERROR, f"Detector initialization failed: {type(exc).__name__}")
            self._emit(record, ObservationType.CAMERA_STOPPED, "Camera released after detector error")
            with self._lock:
                self._starting_session_id = None
                self._remember(record)
            return self._snapshot_record(record)

        self._emit(record, ObservationType.CAMERA_STARTED)
        thread = threading.Thread(
            target=self._run,
            args=(record, capture, detector),
            name=f"pillsense-vision-{session_id[:8]}",
            daemon=True,
        )
        record.thread = thread
        with self._lock:
            self._remember(record)
            self._active = record
            self._starting_session_id = None
        thread.start()
        return self._snapshot_record(record)

    def stop(self, session_id: str) -> dict[str, object]:
        with self._lock:
            record = self._sessions.get(session_id)
            if record is None:
                raise SessionNotFoundError("Unknown camera observation session")
            thread = record.thread
            record.stop_requested.set()
        if thread and thread.is_alive():
            thread.join(timeout=5.0)
        return self.snapshot(session_id)

    def events_after(self, session_id: str, after: str | None) -> list[dict[str, object]]:
        with self._lock:
            record = self._sessions.get(session_id)
            if record is None:
                raise SessionNotFoundError("Unknown camera observation session")
            events = list(record.events)
        if after:
            index = next((i for i, event in enumerate(events) if event.eventId == after), -1)
            if index >= 0:
                events = events[index + 1 :]
        return [event.to_dict() for event in events]

    def snapshot(self, session_id: str) -> dict[str, object]:
        with self._lock:
            record = self._sessions.get(session_id)
            if record is None:
                raise SessionNotFoundError("Unknown camera observation session")
            return self._snapshot_record(record)

    def shutdown(self) -> None:
        with self._lock:
            active = self._active
        if active:
            self.stop(active.session_id)

    def _remember(self, record: SessionRecord) -> None:
        self._sessions[record.session_id] = record
        if len(self._sessions) > 8:
            oldest = next(iter(self._sessions))
            if oldest != record.session_id:
                self._sessions.pop(oldest, None)

    def _run(self, record: SessionRecord, capture: Capture, detector: Detector) -> None:
        started = time.monotonic()
        person_visible: bool | None = None
        debouncer = GestureDebouncer()
        terminal_status = SessionStatus.STOPPED
        stop_detail = "Stopped by operator"
        try:
            while not record.stop_requested.is_set():
                now = time.monotonic()
                if now - started >= self.timeout_seconds:
                    terminal_status = SessionStatus.EXPIRED
                    stop_detail = "Five-minute observation window ended"
                    break
                ok, frame = capture.read()
                if not ok:
                    terminal_status = SessionStatus.ERROR
                    stop_detail = "Camera stopped returning frames"
                    self._emit(record, ObservationType.CAMERA_ERROR, stop_detail)
                    break
                result = detector.process(frame, annotate=False)
                if result.person_visible != person_visible:
                    person_visible = result.person_visible
                    self._emit(
                        record,
                        ObservationType.PERSON_VISIBLE if person_visible else ObservationType.PERSON_NOT_VISIBLE,
                    )
                if debouncer.update(result.detected, now):
                    self._emit(record, ObservationType.HAND_AT_MOUTH_DETECTED)
                if self.frame_interval_seconds:
                    time.sleep(self.frame_interval_seconds)
        except Exception as exc:
            terminal_status = SessionStatus.ERROR
            stop_detail = f"Camera processing failed: {type(exc).__name__}"
            self._emit(record, ObservationType.CAMERA_ERROR, stop_detail)
        finally:
            try:
                detector.close()
            finally:
                capture.release()
            with self._lock:
                record.status = terminal_status
                self._emit(record, ObservationType.CAMERA_STOPPED, stop_detail)
                if self._active is record:
                    self._active = None

    def _emit(
        self,
        record: SessionRecord,
        event_type: ObservationType,
        diagnostic: str | None = None,
    ) -> None:
        with self._lock:
            record.events.append(ObservationEvent.create(record.session_id, event_type, diagnostic))
            if len(record.events) > 200:
                del record.events[:-200]

    @staticmethod
    def _snapshot_record(record: SessionRecord) -> dict[str, object]:
        return {
            "sessionId": record.session_id,
            "status": record.status.value,
            "startedAt": record.started_at,
            "events": [event.to_dict() for event in record.events],
        }
