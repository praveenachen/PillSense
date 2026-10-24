from __future__ import annotations

from pathlib import Path

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    chat_protocol_spec,
)

from agent.convex_client import ConvexAgentClient, ConvexClientConfig
from .protocol import CareRequest, CareResponse, care_protocol
from .settings import PillSenseAgentSettings, SharedSettings
from .workflow import CareRequestWorkflow, WorkflowConfig
from .asi_chat import AsiChatConfig, AsiOneChatWorkflow


def main() -> None:
    shared = SharedSettings.from_environment()
    settings = PillSenseAgentSettings.from_environment()
    bridge = ConvexAgentClient(ConvexClientConfig(
        service_url=shared.convex_url,
        service_secret=shared.service_secret,
    ))
    workflow = CareRequestWorkflow(bridge, WorkflowConfig(
        allowed_sender=settings.allowed_sender,
        wait_seconds=settings.wait_seconds,
        poll_seconds=settings.poll_seconds,
    ))
    chat_workflow = AsiOneChatWorkflow(bridge, AsiChatConfig(
        case_alias=settings.case_alias,
        wait_seconds=settings.wait_seconds,
        poll_seconds=settings.poll_seconds,
    ))
    agent = Agent(
        name="pillsense-care-coordinator",
        seed=settings.seed,
        port=settings.port,
        mailbox=True,
        handle_messages_concurrently=True,
        publish_agent_details=True,
        readme_path=str(Path(__file__).with_name("README.md")),
        description=(
            "Runs a bounded medication-adherence investigation for one caregiver-preauthorized "
            "synthetic PillSense demo case. It never dispenses or changes medication instructions."
        ),
        handle="pillsense-care-coordinator",
    )
    protocol = care_protocol()
    chat_protocol = Protocol(spec=chat_protocol_spec)

    @protocol.on_message(model=CareRequest, replies={CareResponse})
    async def receive_request(ctx: Context, sender: str, message: CareRequest):
        await workflow.handle(ctx, sender, message)

    @chat_protocol.on_message(ChatMessage)
    async def receive_chat(ctx: Context, sender: str, message: ChatMessage):
        await chat_workflow.handle(ctx, sender, message)

    @chat_protocol.on_message(ChatAcknowledgement)
    async def receive_chat_acknowledgement(
        _ctx: Context,
        _sender: str,
        _message: ChatAcknowledgement,
    ):
        return None

    agent.include(protocol, publish_manifest=True)
    agent.include(chat_protocol, publish_manifest=True)
    print(f"PillSense Care Coordinator Agent address: {agent.address}")
    print("Mailbox mode enabled; secrets and case details are not logged")
    agent.run()


if __name__ == "__main__":
    main()
