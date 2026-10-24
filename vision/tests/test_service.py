from fastapi.testclient import TestClient

from vision.camera import CameraSessionManager
from vision.service import Settings, create_app

from .test_camera import FakeCapture


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
        assert started.json()["status"] == "ERROR"
        assert [event["type"] for event in started.json()["events"]] == ["CAMERA_ERROR", "CAMERA_STOPPED"]

        other = client.get("/v1/sessions/session-other/events", headers=headers)
        assert other.status_code == 403
