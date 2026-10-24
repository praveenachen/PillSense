from __future__ import annotations

import os

from uagents.crypto import Identity

from .settings import load_fetch_environment, required


def derive_address(seed: str) -> str:
    return Identity.from_seed(seed, 0).address


def main() -> None:
    load_fetch_environment()
    pillsense = derive_address(required("PILLSENSE_AGENT_SEED"))
    print(f"PILLSENSE_AGENT_ADDRESS={pillsense}")
    external_seed = os.environ.get("EXTERNAL_CARE_AGENT_SEED", "").strip()
    if external_seed:
        print(
            "PILLSENSE_AGENTVERSE_ALLOWED_SENDER="
            f"{derive_address(external_seed)}"
        )


if __name__ == "__main__":
    main()
