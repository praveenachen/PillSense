from dataclasses import dataclass
from types import SimpleNamespace
import sys
import threading
import time

import pytest

import vision.camera as camera_module
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
    manager.start("session-one")
    with pytest.raises(CameraBusyError):
        manager.start("session-two")
    wait_for(lambda: manager.snapshot("session-one")["status"] == "ACTIVE")
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
    manager.start("session-unavailable")
    wait_for(lambda: manager.snapshot("session-unavailable")["status"] == "ERROR")
    snapshot = manager.snapshot("session-unavailable")
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


def test_blocked_camera_initialization_returns_immediately_and_times_out_with_phase():
    entered = threading.Event()
    release = threading.Event()
    capture = FakeCapture()

    def blocking_capture(_index):
        entered.set()
        release.wait(1.0)
        return capture

    manager = CameraSessionManager(
        initialization_timeout_seconds=0.05,
        capture_factory=blocking_capture,
        detector_factory=FakeDetector,
    )
    before = time.monotonic()
    snapshot = manager.start("session-blocked")
    assert time.monotonic() - before < 0.05
    assert snapshot["status"] == "STARTING"
    assert entered.wait(0.2)
    wait_for(lambda: manager.snapshot("session-blocked")["status"] == "ERROR")
    timed_out = manager.snapshot("session-blocked")
    errors = [event for event in timed_out["events"] if event["type"] == "CAMERA_ERROR"]
    assert errors[0]["diagnostic"] == "Camera initialization timed out during opening camera"
    release.set()
    wait_for(lambda: capture.released)


def test_windows_service_uses_directshow_for_worker_thread_camera_open(monkeypatch):
    calls = []
    capture = FakeCapture()
    fake_cv2 = SimpleNamespace(
        CAP_DSHOW=700,
        CAP_PROP_FRAME_WIDTH=3,
        CAP_PROP_FRAME_HEIGHT=4,
        VideoCapture=lambda *args: calls.append(args) or capture,
    )
    monkeypatch.setitem(sys.modules, "cv2", fake_cv2)
    monkeypatch.setattr(camera_module.os, "name", "nt")
    assert camera_module._default_capture(0) is capture
    assert calls == [(0, 700)]
