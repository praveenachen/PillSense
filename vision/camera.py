"""Single-owner webcam lifecycle for the local PillSense vision bridge."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
import logging
import os
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
    STARTING = "STARTING"
    ACTIVE = "ACTIVE"
    STOPPED = "STOPPED"
    ERROR = "ERROR"
    EXPIRED = "EXPIRED"


@dataclass
class SessionRecord:
    session_id: str
    camera_index: int
    status: SessionStatus
    started_at: int
    timeout_seconds: float
    events: list[ObservationEvent]
    stop_requested: threading.Event
    thread: threading.Thread | None = None
    latest_preview: bytes | None = None
    initialization_phase: str = "queued"


class CameraBusyError(RuntimeError):
    pass


class SessionNotFoundError(RuntimeError):
    pass


def _default_capture(camera_index: int) -> Capture:
    import cv2

    # MSMF can block indefinitely when VideoCapture is opened from FastAPI's
    # worker/background threads even though the same camera works on the main
    # thread. DirectShow is the stable Windows backend for this local service.
    capture = (
        cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
        if os.name == "nt"
        else cv2.VideoCapture(camera_index)
    )
    capture.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    capture.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    return capture


def _default_detector() -> Detector:
    from .detector import HandMouthDetector

    return HandMouthDetector()


def _default_preview_encoder(frame: object) -> bytes | None:
    """Encode one annotated frame in memory; frames are never written to disk."""
    import cv2

    ok, encoded = cv2.imencode(
        ".jpg",
        frame,
        [int(cv2.IMWRITE_JPEG_QUALITY), 78],
    )
    return encoded.tobytes() if ok else None


class CameraSessionManager:
    """Owns at most one capture and stores only small observation messages."""

    def __init__(
        self,
        camera_index: int = 0,
        timeout_seconds: float = 300.0,
        initialization_timeout_seconds: float = 15.0,
        frame_interval_seconds: float = 0.03,
        capture_factory: Callable[[int], Capture] = _default_capture,
        detector_factory: Callable[[], Detector] = _default_detector,
        preview_encoder: Callable[[object], bytes | None] = _default_preview_encoder,
    ):
        self.camera_index = camera_index
        self.timeout_seconds = timeout_seconds
        self.initialization_timeout_seconds = initialization_timeout_seconds
        self.frame_interval_seconds = frame_interval_seconds
        self.capture_factory = capture_factory
        self.detector_factory = detector_factory
        self.preview_encoder = preview_encoder
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
                "cameraIndex": active.camera_index if active else self.camera_index,
                "rawFramesStored": False,
            }

    def start(
        self,
        session_id: str,
        camera_index: int | None = None,
        timeout_seconds: float | None = None,
    ) -> dict[str, object]:
        selected_camera_index = self.camera_index if camera_index is None else camera_index
        selected_timeout = self.timeout_seconds if timeout_seconds is None else min(timeout_seconds, self.timeout_seconds)
        if selected_timeout <= 0:
            raise ValueError("Camera session timeout must be positive")
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
            camera_index=selected_camera_index,
            status=SessionStatus.STARTING,
            started_at=int(time.time() * 1000),
            timeout_seconds=selected_timeout,
            events=[],
            stop_requested=threading.Event(),
        )
        thread = threading.Thread(
            target=self._initialize_and_run,
            args=(record,),
            name=f"pillsense-vision-{session_id[:8]}",
            daemon=True,
        )
        record.thread = thread
        with self._lock:
            self._remember(record)
        thread.start()
        threading.Thread(
            target=self._watch_initialization,
            args=(record,),
            name=f"pillsense-vision-watch-{session_id[:8]}",
            daemon=True,
        ).start()
        return self._snapshot_record(record)

    def stop(self, session_id: str) -> dict[str, object]:
        with self._lock:
            record = self._sessions.get(session_id)
            if record is None:
                raise SessionNotFoundError("Unknown camera observation session")
            thread = record.thread
            record.stop_requested.set()
            if record.status == SessionStatus.STARTING:
                self._finish_initialization(record, SessionStatus.STOPPED, "Camera initialization cancelled by operator")
        if thread and thread.is_alive():
            thread.join(timeout=0.25 if record.status == SessionStatus.STOPPED else 5.0)
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

    def preview(self, session_id: str) -> bytes | None:
        """Return only the latest in-memory annotated frame for this session."""
        with self._lock:
            record = self._sessions.get(session_id)
            if record is None:
                raise SessionNotFoundError("Unknown camera observation session")
            return record.latest_preview

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

    def _initialize_and_run(self, record: SessionRecord) -> None:
        logger = logging.getLogger("uvicorn.error")
        capture = None
        detector = None
        try:
            with self._lock:
                record.initialization_phase = "opening camera"
            logger.info(
                "Session %s: opening camera %s%s",
                record.session_id,
                record.camera_index,
                " with DirectShow" if os.name == "nt" else "",
            )
            capture = self.capture_factory(record.camera_index)
            if record.stop_requested.is_set() or record.status != SessionStatus.STARTING:
                capture.release()
                return
            if not capture.isOpened():
                capture.release()
                self._finish_initialization(record, SessionStatus.ERROR, "Camera unavailable or permission denied")
                return

            with self._lock:
                record.initialization_phase = "loading MediaPipe detector"
            logger.info("Session %s: loading MediaPipe detector", record.session_id)
            detector = self.detector_factory()
            if record.stop_requested.is_set() or record.status != SessionStatus.STARTING:
                detector.close()
                capture.release()
                return

            with self._lock:
                record.status = SessionStatus.ACTIVE
                record.initialization_phase = "active"
                self._active = record
                if self._starting_session_id == record.session_id:
                    self._starting_session_id = None
                self._emit(record, ObservationType.CAMERA_STARTED)
            logger.info("Session %s: camera and detector active", record.session_id)
            self._run(record, capture, detector)
        except Exception as exc:
            if detector is not None:
                detector.close()
            if capture is not None:
                capture.release()
            self._finish_initialization(
                record,
                SessionStatus.ERROR,
                f"Camera initialization failed during {record.initialization_phase}: {type(exc).__name__}",
            )
            logger.exception("Session %s initialization failed during %s", record.session_id, record.initialization_phase)

    def _watch_initialization(self, record: SessionRecord) -> None:
        if record.stop_requested.wait(self.initialization_timeout_seconds):
            return
        with self._lock:
            if record.status != SessionStatus.STARTING:
                return
            phase = record.initialization_phase
            record.stop_requested.set()
            self._finish_initialization(
                record,
                SessionStatus.ERROR,
                f"Camera initialization timed out during {phase}",
            )
        logging.getLogger("uvicorn.error").error(
            "Session %s: initialization timed out during %s",
            record.session_id,
            phase,
        )

    def _finish_initialization(
        self,
        record: SessionRecord,
        status: SessionStatus,
        diagnostic: str,
    ) -> None:
        with self._lock:
            if record.status not in (SessionStatus.STARTING, SessionStatus.ERROR):
                return
            already_terminal = record.status == SessionStatus.ERROR
            record.status = status
            record.initialization_phase = "finished"
            if self._starting_session_id == record.session_id:
                self._starting_session_id = None
            if status == SessionStatus.ERROR and not already_terminal:
                self._emit(record, ObservationType.CAMERA_ERROR, diagnostic)
            if not any(event.type == ObservationType.CAMERA_STOPPED for event in record.events):
                self._emit(record, ObservationType.CAMERA_STOPPED, diagnostic)

    def _run(self, record: SessionRecord, capture: Capture, detector: Detector) -> None:
        started = time.monotonic()
        person_visible: bool | None = None
        debouncer = GestureDebouncer()
        terminal_status = SessionStatus.STOPPED
        stop_detail = "Stopped by operator"
        try:
            while not record.stop_requested.is_set():
                now = time.monotonic()
                if now - started >= record.timeout_seconds:
                    terminal_status = SessionStatus.EXPIRED
                    stop_detail = "Five-minute observation window ended"
                    break
                ok, frame = capture.read()
                if not ok:
                    terminal_status = SessionStatus.ERROR
                    stop_detail = "Camera stopped returning frames"
                    self._emit(record, ObservationType.CAMERA_ERROR, stop_detail)
                    break
                result = detector.process(frame, annotate=True)
                annotated_frame = getattr(result, "frame", None)
                if annotated_frame is not None:
                    preview = self.preview_encoder(annotated_frame)
                    if preview is not None:
                        with self._lock:
                            record.latest_preview = preview
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
            "cameraIndex": record.camera_index,
            "status": record.status.value,
            "startedAt": record.started_at,
            "previewAvailable": record.latest_preview is not None,
            "initializationPhase": record.initialization_phase,
            "events": [event.to_dict() for event in record.events],
        }
