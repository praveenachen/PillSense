from dataclasses import dataclass
import time

import pytest

from vision.camera import CameraBusyError, CameraSessionManager


class FakeCapture:
    def __init__(self, opened=True, frames=None):
        self.opened = opened
        self.frames = list(frames or [object()] * 100)
        self.released = False

    def isOpened(self):
        return self.opened

    def read(self):
        if not self.frames:
            return False, None
        return True, self.frames.pop(0)

    def release(self):
        self.released = True

    def set(self, _prop, _value):
        return True


@dataclass
class Result:
    person_visible: bool
    detected: bool
    frame: object | None = None


class FakeDetector:
    def __init__(self, results=None):
        self.results = list(results or [Result(True, False)] * 100)
        self.closed = False

    def process(self, _frame, annotate=False):
        assert annotate is True
        return self.results.pop(0) if self.results else Result(True, False)

    def close(self):
        self.closed = True


def wait_for(predicate, timeout=1.0):
    started = time.monotonic()
    while not predicate():
        if time.monotonic() - started > timeout:
            raise AssertionError("Timed out waiting for camera worker")
        time.sleep(0.005)


def test_start_stop_lifecycle_releases_single_camera_owner():
    capture = FakeCapture()
    detector = FakeDetector()
    manager = CameraSessionManager(
        frame_interval_seconds=0.005,
        capture_factory=lambda _index: capture,
        detector_factory=lambda: detector,
        preview_encoder=lambda _frame: b"jpeg-preview",
    )
    started = manager.start("session-one")
    assert started["status"] == "ACTIVE"
    with pytest.raises(CameraBusyError):
        manager.start("session-two")
    stopped = manager.stop("session-one")
    assert stopped["status"] == "STOPPED"
    assert capture.released is True
    assert detector.closed is True
    assert [event["type"] for event in stopped["events"]][0] == "CAMERA_STARTED"
    assert [event["type"] for event in stopped["events"]][-1] == "CAMERA_STOPPED"


def test_preview_uses_same_capture_and_requested_camera_without_storing_history():
    selected_indexes = []
    capture = FakeCapture(frames=[object()] * 100)
    detector = FakeDetector([Result(True, False, frame=object())] * 100)
    manager = CameraSessionManager(
        frame_interval_seconds=0.005,
        capture_factory=lambda index: selected_indexes.append(index) or capture,
        detector_factory=lambda: detector,
        preview_encoder=lambda _frame: b"latest-jpeg",
    )
    manager.start("session-preview", camera_index=2)
    wait_for(lambda: manager.preview("session-preview") is not None)
    assert selected_indexes == [2]
    assert manager.preview("session-preview") == b"latest-jpeg"
    assert manager.snapshot("session-preview")["previewAvailable"] is True
    manager.stop("session-preview")


def test_camera_unavailable_returns_error_events_without_worker():
    capture = FakeCapture(opened=False)
    manager = CameraSessionManager(capture_factory=lambda _index: capture)
    snapshot = manager.start("session-unavailable")
    assert snapshot["status"] == "ERROR"
    assert [event["type"] for event in snapshot["events"]] == ["CAMERA_ERROR", "CAMERA_STOPPED"]
    assert capture.released is True
    assert manager.health()["cameraOwnerActive"] is False


def test_person_transitions_and_gesture_are_meaningful_not_per_frame():
    capture = FakeCapture(frames=[object()] * 200)
    detector = FakeDetector(
        [Result(False, False), Result(True, False), Result(True, True)]
        + [Result(True, True)] * 20
    )
    manager = CameraSessionManager(
        frame_interval_seconds=0.001,
        capture_factory=lambda _index: capture,
        detector_factory=lambda: detector,
    )
    manager.start("session-events")
    wait_for(lambda: any(
        event["type"] == "HAND_AT_MOUTH_DETECTED"
        for event in manager.events_after("session-events", None)
    ))
    snapshot = manager.stop("session-events")
    types = [event["type"] for event in snapshot["events"]]
    assert types.count("PERSON_NOT_VISIBLE") == 1
    assert types.count("PERSON_VISIBLE") == 1
    assert types.count("HAND_AT_MOUTH_DETECTED") == 1
