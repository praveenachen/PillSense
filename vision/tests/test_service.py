from fastapi.testclient import TestClient
import threading
import time

from vision.camera import CameraSessionManager
from vision.service import Settings, create_app

from .test_camera import FakeCapture, FakeDetector


ORIGIN = "http://localhost:3000"


def app_client():
    manager = CameraSessionManager(capture_factory=lambda _index: FakeCapture(opened=False))
    app = create_app(
        settings=Settings(allowed_origins=(ORIGIN,)),
        manager=manager,
    )
    return TestClient(app)


def test_unapproved_webpage_cannot_mint_capability():
    with app_client() as client:
        response = client.post("/v1/capabilities", headers={"Origin": "https://example.com"})
        assert response.status_code == 403


def test_state_change_requires_session_capability():
    with app_client() as client:
        response = client.post(
            "/v1/sessions",
            headers={"Origin": ORIGIN},
            json={"sessionId": "session-1234"},
        )
        assert response.status_code == 401


def test_capability_is_bound_to_one_session_and_camera_error_is_reported():
    with app_client() as client:
        capability = client.post("/v1/capabilities", headers={"Origin": ORIGIN}).json()["capabilityToken"]
        headers = {"Origin": ORIGIN, "X-PillSense-Vision-Capability": capability}
        started = client.post("/v1/sessions", headers=headers, json={"sessionId": "session-1234"})
        assert started.status_code == 200
        assert started.json()["status"] in ("STARTING", "ERROR")
        for _ in range(50):
            events_response = client.get("/v1/sessions/session-1234/events", headers=headers)
            if events_response.json()["status"] == "ERROR":
                break
            time.sleep(0.01)
        assert events_response.json()["status"] == "ERROR"
        assert [event["type"] for event in events_response.json()["events"]] == ["CAMERA_ERROR", "CAMERA_STOPPED"]

        other = client.get("/v1/sessions/session-other/events", headers=headers)
        assert other.status_code == 403

        preview = client.get("/v1/sessions/session-1234/preview.jpg", headers=headers)
        assert preview.status_code == 204


def test_preview_requires_the_session_scoped_capability():
    with app_client() as client:
        response = client.get(
            "/v1/sessions/session-1234/preview.jpg",
            headers={"Origin": ORIGIN},
        )
        assert response.status_code == 401


def test_recovery_attaches_a_new_capability_without_opening_a_second_camera():
    captures = []

    def capture_factory(_index):
        capture = FakeCapture(frames=[object()] * 500)
        captures.append(capture)
        return capture

    manager = CameraSessionManager(
        frame_interval_seconds=0.01,
        capture_factory=capture_factory,
        detector_factory=FakeDetector,
    )
    app = create_app(settings=Settings(allowed_origins=(ORIGIN,)), manager=manager)
    with TestClient(app) as client:
        first_token = client.post("/v1/capabilities", headers={"Origin": ORIGIN}).json()["capabilityToken"]
        first_headers = {"Origin": ORIGIN, "X-PillSense-Vision-Capability": first_token}
        started = client.post("/v1/sessions", headers=first_headers, json={"sessionId": "session-recover"})
        assert started.status_code == 200

        recovery_token = client.post("/v1/capabilities", headers={"Origin": ORIGIN}).json()["capabilityToken"]
        recovery_headers = {"Origin": ORIGIN, "X-PillSense-Vision-Capability": recovery_token}
        recovered = client.post("/v1/sessions/session-recover/recover", headers=recovery_headers)
        assert recovered.status_code == 200
        assert recovered.json()["status"] == "ACTIVE"
        assert len(captures) == 1

        stopped = client.post("/v1/sessions/session-recover/stop", headers=recovery_headers)
        assert stopped.status_code == 200
        assert stopped.json()["status"] == "STOPPED"


def test_recovery_does_not_create_a_missing_session_after_service_restart():
    captures = []
    manager = CameraSessionManager(capture_factory=lambda _index: captures.append(True) or FakeCapture())
    app = create_app(settings=Settings(allowed_origins=(ORIGIN,)), manager=manager)
    with TestClient(app) as client:
        token = client.post("/v1/capabilities", headers={"Origin": ORIGIN}).json()["capabilityToken"]
        headers = {"Origin": ORIGIN, "X-PillSense-Vision-Capability": token}
        recovered = client.post("/v1/sessions/session-missing/recover", headers=headers)
        assert recovered.status_code == 404
        assert captures == []


def test_stop_if_present_stops_the_matching_local_session_without_recovery():
    captures = []

    def capture_factory(_index):
        capture = FakeCapture(frames=[object()] * 500)
        captures.append(capture)
        return capture

    manager = CameraSessionManager(
        frame_interval_seconds=0.01,
        capture_factory=capture_factory,
        detector_factory=FakeDetector,
    )
    app = create_app(settings=Settings(allowed_origins=(ORIGIN,)), manager=manager)
    with TestClient(app) as client:
        first_token = client.post("/v1/capabilities", headers={"Origin": ORIGIN}).json()["capabilityToken"]
        first_headers = {"Origin": ORIGIN, "X-PillSense-Vision-Capability": first_token}
        assert client.post("/v1/sessions", headers=first_headers, json={"sessionId": "session-resume"}).status_code == 200
        assert client.post("/v1/sessions/session-resume/stop", headers=first_headers).json()["status"] == "STOPPED"

        stop_token = client.post("/v1/capabilities", headers={"Origin": ORIGIN}).json()["capabilityToken"]
        stop_headers = {"Origin": ORIGIN, "X-PillSense-Vision-Capability": stop_token}
        stopped_again = client.post(
            "/v1/sessions/session-resume/stop-if-present",
            headers=stop_headers,
        )
        assert stopped_again.status_code == 200
        assert stopped_again.json()["outcome"] == "STOPPED"
        assert stopped_again.json()["snapshot"]["status"] == "STOPPED"
        assert len(captures) == 1


def test_stop_if_present_after_restart_reports_missing_without_opening_camera():
    captures = []
    manager = CameraSessionManager(capture_factory=lambda _index: captures.append(True) or FakeCapture())
    app = create_app(settings=Settings(allowed_origins=(ORIGIN,)), manager=manager)
    with TestClient(app) as client:
        token = client.post("/v1/capabilities", headers={"Origin": ORIGIN}).json()["capabilityToken"]
        headers = {"Origin": ORIGIN, "X-PillSense-Vision-Capability": token}
        response = client.post("/v1/sessions/stale-convex-session/stop-if-present", headers=headers)
        assert response.status_code == 200
        assert response.json() == {"outcome": "NOT_FOUND"}
        assert captures == []


def test_stop_if_present_does_not_interrupt_a_different_local_owner():
    manager = CameraSessionManager(
        frame_interval_seconds=0.01,
        capture_factory=lambda _index: FakeCapture(frames=[object()] * 500),
        detector_factory=FakeDetector,
    )
    app = create_app(settings=Settings(allowed_origins=(ORIGIN,)), manager=manager)
    with TestClient(app) as client:
        owner_token = client.post("/v1/capabilities", headers={"Origin": ORIGIN}).json()["capabilityToken"]
        owner_headers = {"Origin": ORIGIN, "X-PillSense-Vision-Capability": owner_token}
        client.post("/v1/sessions", headers=owner_headers, json={"sessionId": "session-owner"})

        other_token = client.post("/v1/capabilities", headers={"Origin": ORIGIN}).json()["capabilityToken"]
        other_headers = {"Origin": ORIGIN, "X-PillSense-Vision-Capability": other_token}
        response = client.post("/v1/sessions/session-other/stop-if-present", headers=other_headers)
        assert response.status_code == 200
        assert response.json() == {"outcome": "NOT_FOUND"}
        assert manager.health()["activeSessionId"] == "session-owner"
        client.post("/v1/sessions/session-owner/stop", headers=owner_headers)


def test_http_start_does_not_wait_for_a_blocked_camera_driver():
    entered = threading.Event()
    release = threading.Event()

    def blocking_capture(_index):
        entered.set()
        release.wait(1.0)
        return FakeCapture()

    manager = CameraSessionManager(
        initialization_timeout_seconds=0.1,
        capture_factory=blocking_capture,
        detector_factory=FakeDetector,
    )
    app = create_app(settings=Settings(allowed_origins=(ORIGIN,)), manager=manager)
    with TestClient(app) as client:
        token = client.post("/v1/capabilities", headers={"Origin": ORIGIN}).json()["capabilityToken"]
        headers = {"Origin": ORIGIN, "X-PillSense-Vision-Capability": token}
        before = time.monotonic()
        response = client.post("/v1/sessions", headers=headers, json={"sessionId": "session-blocked-http"})
        assert time.monotonic() - before < 0.1
        assert response.status_code == 200
        assert response.json()["status"] == "STARTING"
        assert entered.wait(0.2)
        release.set()
