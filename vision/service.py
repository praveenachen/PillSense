"""FastAPI entry point for the localhost-only PillSense vision bridge."""

from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass
import os
import secrets
import threading
import time

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .camera import CameraBusyError, CameraSessionManager, SessionNotFoundError


CAPABILITY_HEADER = "X-PillSense-Vision-Capability"


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8101
    camera_index: int = 0
    timeout_seconds: float = 300.0
    allowed_origins: tuple[str, ...] = (
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    )

    @classmethod
    def from_environment(cls) -> "Settings":
        origins = tuple(
            origin.strip()
            for origin in os.getenv(
                "PILLSENSE_VISION_ALLOWED_ORIGINS",
                "http://localhost:3000,http://127.0.0.1:3000",
            ).split(",")
            if origin.strip()
        )
        if not origins or any(
            not (origin.startswith("http://localhost:") or origin.startswith("http://127.0.0.1:"))
            for origin in origins
        ):
            raise RuntimeError("Vision origins must be an explicit localhost allowlist")
        return cls(
            port=int(os.getenv("PILLSENSE_VISION_PORT", "8101")),
            camera_index=int(os.getenv("PILLSENSE_VISION_CAMERA", "0")),
            timeout_seconds=float(os.getenv("PILLSENSE_VISION_TIMEOUT_SECONDS", "300")),
            allowed_origins=origins,
        )


class StartBody(BaseModel):
    sessionId: str = Field(pattern=r"^[A-Za-z0-9_-]{8,64}$")
    cameraIndex: int | None = Field(default=None, ge=0, le=8)


class CapabilityRegistry:
    """Short-lived tokens bound to one browser-created observation session."""

    def __init__(self, ttl_seconds: float = 600.0):
        self.ttl_seconds = ttl_seconds
        self._lock = threading.Lock()
        self._tokens: dict[str, tuple[float, str | None]] = {}

    def issue(self) -> str:
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._prune()
            self._tokens[token] = (time.monotonic() + self.ttl_seconds, None)
        return token

    def bind(self, token: str, session_id: str) -> None:
        with self._lock:
            self._prune()
            entry = self._tokens.get(token)
            if entry is None:
                raise HTTPException(status_code=401, detail="Invalid or expired vision capability")
            _, bound_session = entry
            if bound_session not in (None, session_id):
                raise HTTPException(status_code=403, detail="Vision capability belongs to another session")
            self._tokens[token] = (time.monotonic() + self.ttl_seconds, session_id)

    def require(self, token: str | None, session_id: str | None = None) -> str:
        if not token:
            raise HTTPException(status_code=401, detail="Vision capability required")
        with self._lock:
            self._prune()
            entry = self._tokens.get(token)
            if entry is None:
                raise HTTPException(status_code=401, detail="Invalid or expired vision capability")
            expires_at, bound_session = entry
            if session_id is not None and bound_session != session_id:
                raise HTTPException(status_code=403, detail="Vision capability does not own this session")
            self._tokens[token] = (max(expires_at, time.monotonic() + 60.0), bound_session)
        return token

    def _prune(self) -> None:
        now = time.monotonic()
        expired = [token for token, (expires_at, _) in self._tokens.items() if expires_at <= now]
        for token in expired:
            self._tokens.pop(token, None)


def create_app(
    settings: Settings | None = None,
    manager: CameraSessionManager | None = None,
) -> FastAPI:
    active_settings = settings or Settings.from_environment()
    active_manager = manager or CameraSessionManager(
        camera_index=active_settings.camera_index,
        timeout_seconds=active_settings.timeout_seconds,
    )
    capabilities = CapabilityRegistry()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        active_manager.shutdown()

    app = FastAPI(title="PillSense Local Vision Bridge", version="1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(active_settings.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", CAPABILITY_HEADER],
    )

    def require_origin(request: Request) -> str:
        origin = request.headers.get("origin")
        if origin not in active_settings.allowed_origins:
            raise HTTPException(status_code=403, detail="Browser origin is not allowed")
        return origin

    def capability_header(
        value: str | None = Header(default=None, alias=CAPABILITY_HEADER),
    ) -> str | None:
        return value

    @app.get("/health")
    def health() -> dict[str, object]:
        return active_manager.health()

    @app.post("/v1/capabilities", dependencies=[Depends(require_origin)])
    def issue_capability() -> dict[str, object]:
        return {"capabilityToken": capabilities.issue(), "expiresInSeconds": 600}

    @app.post("/v1/sessions", dependencies=[Depends(require_origin)])
    def start_session(
        body: StartBody,
        token: str | None = Depends(capability_header),
    ) -> dict[str, object]:
        validated = capabilities.require(token)
        capabilities.bind(validated, body.sessionId)
        try:
            return active_manager.start(body.sessionId, body.cameraIndex)
        except CameraBusyError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.get("/v1/sessions/{session_id}/events", dependencies=[Depends(require_origin)])
    def session_events(
        session_id: str,
        after: str | None = None,
        token: str | None = Depends(capability_header),
    ) -> dict[str, object]:
        capabilities.require(token, session_id)
        try:
            snapshot = active_manager.snapshot(session_id)
            return {
                "sessionId": session_id,
                "status": snapshot["status"],
                "events": active_manager.events_after(session_id, after),
            }
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/v1/sessions/{session_id}/preview.jpg", dependencies=[Depends(require_origin)])
    def session_preview(
        session_id: str,
        token: str | None = Depends(capability_header),
    ) -> Response:
        capabilities.require(token, session_id)
        try:
            preview = active_manager.preview(session_id)
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if preview is None:
            return Response(status_code=204, headers={"Cache-Control": "no-store"})
        return Response(
            content=preview,
            media_type="image/jpeg",
            headers={"Cache-Control": "no-store, max-age=0"},
        )

    @app.post("/v1/sessions/{session_id}/stop", dependencies=[Depends(require_origin)])
    def stop_session(
        session_id: str,
        token: str | None = Depends(capability_header),
    ) -> dict[str, object]:
        capabilities.require(token, session_id)
        try:
            return active_manager.stop(session_id)
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    return app


settings = Settings.from_environment()
app = create_app(settings=settings)


def main() -> None:
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=settings.port, log_level="info")


if __name__ == "__main__":
    main()
