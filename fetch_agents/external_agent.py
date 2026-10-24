from __future__ import annotations

import argparse
import time
import uuid

from uagents import Agent, Context

from .protocol import CareRequest, CareResponse, PROTOCOL_VERSION, REQUEST_TYPE, care_protocol
from .settings import ExternalAgentSettings
from .workflow import ResponseTracker


def main() -> None:
    parser = argparse.ArgumentParser(description="External synthetic care request uAgent")
    parser.add_argument("--send", action="store_true", help="Send one demo request after startup")
    parser.add_argument("--case-alias", help="Caregiver-authorized synthetic case alias")
    args = parser.parse_args()
    settings = ExternalAgentSettings.from_environment(args.case_alias)
    request_id = str(uuid.uuid4())
    tracker = ResponseTracker(settings.pillsense_address, request_id)
    agent = Agent(
        name="external-care-request",
        seed=settings.seed,
        port=settings.port,
        mailbox=True,
        publish_agent_details=False,
    )
    protocol = care_protocol()

    @agent.on_event("startup")
    async def send_demo_request(ctx: Context):
        if not args.send:
            return
        message = CareRequest(
            protocol_version=PROTOCOL_VERSION,
            request_id=request_id,
            request_type=REQUEST_TYPE,
            case_alias=settings.case_alias,
            sent_at=int(time.time() * 1000),
        )
        result = await ctx.send(settings.pillsense_address, message)
        ctx.logger.info(
            "Care request %s submission status: %s",
            request_id,
            getattr(result, "status", "unknown"),
        )

    @protocol.on_message(model=CareResponse)
    async def receive_response(ctx: Context, sender: str, response: CareResponse):
        if tracker.accept(sender, response):
            ctx.logger.info(
                "Correlated response %s: %s (%s)",
                response.request_id,
                response.status,
                response.detail_code,
            )

    agent.include(protocol, publish_manifest=True)
    print(f"External Care Request Agent address: {agent.address}")
    print(f"Request ID for this process: {request_id}")
    agent.run()


if __name__ == "__main__":
    main()
