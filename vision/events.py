"""Typed, non-clinical observation events and gesture debouncing."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum
import time
import uuid


SOURCE_ID = "WINDOWS_OPENCV_MEDIAPIPE"


class ObservationType(str, Enum):
    CAMERA_STARTED = "CAMERA_STARTED"
    CAMERA_STOPPED = "CAMERA_STOPPED"
    PERSON_VISIBLE = "PERSON_VISIBLE"
    PERSON_NOT_VISIBLE = "PERSON_NOT_VISIBLE"
    HAND_AT_MOUTH_DETECTED = "HAND_AT_MOUTH_DETECTED"
    CAMERA_ERROR = "CAMERA_ERROR"


@dataclass(frozen=True)
class ObservationEvent:
    eventId: str
    sessionId: str
    timestamp: int
    type: ObservationType
    source: str = SOURCE_ID
    diagnostic: str | None = None

    @classmethod
    def create(
        cls,
        session_id: str,
        event_type: ObservationType,
        diagnostic: str | None = None,
    ) -> "ObservationEvent":
        return cls(
            eventId=f"vision-{uuid.uuid4().hex}",
            sessionId=session_id,
            timestamp=int(time.time() * 1000),
            type=event_type,
            diagnostic=diagnostic,
        )

    def to_dict(self) -> dict[str, object]:
        value = asdict(self)
        value["type"] = self.type.value
        if self.diagnostic is None:
            value.pop("diagnostic")
        return value


class GestureDebouncer:
    """Emit once per continuous gesture, with a quiet reset and cooldown."""

    def __init__(self, cooldown_seconds: float = 2.0, reset_seconds: float = 0.35):
        self.cooldown_seconds = cooldown_seconds
        self.reset_seconds = reset_seconds
        self._latched = False
        self._clear_since: float | None = None
        self._last_emitted_at: float | None = None

    def update(self, detected: bool, now: float) -> bool:
        if detected:
            self._clear_since = None
            if self._latched:
                return False
            if (
                self._last_emitted_at is not None
                and now - self._last_emitted_at < self.cooldown_seconds
            ):
                return False
            self._latched = True
            self._last_emitted_at = now
            return True

        if not self._latched:
            return False
        if self._clear_since is None:
            self._clear_since = now
            return False
        if now - self._clear_since >= self.reset_seconds:
            self._latched = False
            self._clear_since = None
        return False
