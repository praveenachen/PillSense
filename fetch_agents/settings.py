from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]


def load_fetch_environment() -> None:
    load_dotenv(ROOT / ".env.fetch", override=False)


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required in the ignored .env.fetch file")
    return value


@dataclass(frozen=True)
class SharedSettings:
    convex_url: str
    service_secret: str

    @classmethod
    def from_environment(cls) -> "SharedSettings":
        load_fetch_environment()
        return cls(
            convex_url=required("CONVEX_AGENT_URL"),
            service_secret=required("PILLSENSE_AGENT_SERVICE_SECRET"),
        )


@dataclass(frozen=True)
class PillSenseAgentSettings:
    seed: str
    allowed_sender: str | None
    port: int
    wait_seconds: float
    poll_seconds: float
    case_alias: str | None

    @classmethod
    def from_environment(cls) -> "PillSenseAgentSettings":
        load_fetch_environment()
        return cls(
            seed=required("PILLSENSE_AGENT_SEED"),
            allowed_sender=os.environ.get("PILLSENSE_AGENTVERSE_ALLOWED_SENDER", "").strip() or None,
            port=int(os.environ.get("PILLSENSE_AGENTVERSE_PORT", "8100")),
            wait_seconds=float(os.environ.get("PILLSENSE_AGENTVERSE_WAIT_SECONDS", "180")),
            poll_seconds=float(os.environ.get("PILLSENSE_AGENTVERSE_POLL_SECONDS", "3")),
            case_alias=os.environ.get("PILLSENSE_DEMO_CASE_ALIAS", "").strip() or None,
        )


@dataclass(frozen=True)
class ExternalAgentSettings:
    seed: str
    pillsense_address: str
    case_alias: str
    port: int

    @classmethod
    def from_environment(cls, case_alias: str | None = None) -> "ExternalAgentSettings":
        load_fetch_environment()
        return cls(
            seed=required("EXTERNAL_CARE_AGENT_SEED"),
            pillsense_address=required("PILLSENSE_AGENT_ADDRESS"),
            case_alias=case_alias or required("PILLSENSE_DEMO_CASE_ALIAS"),
            port=int(os.environ.get("EXTERNAL_CARE_AGENT_PORT", "8101")),
        )
