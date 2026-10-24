from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass
from typing import Literal, Protocol

from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
)
from uagents_core.types import DeliveryStatus

from agent.convex_client import ConvexAgentClient, ConvexBridgeError
from agent.models import AgentverseRequestStatus

ASI_TRANSPORT = "ASI_ONE_ACP"


class ChatContext(Protocol):
    async def send(self, destination: str, message: object): ...


@dataclass(frozen=True)
class AsiChatConfig:
    case_alias: str | None
    wait_seconds: float = 180
    poll_seconds: float = 3


def text_from_message(message: ChatMessage) -> str:
    return " ".join(
        item.text.strip()
        for item in message.content
        if isinstance(item, TextContent) and item.text.strip()
    )


def classify_intent(text: str) -> Literal["INVESTIGATE", "REJECT_IDENTIFIER", "HELP"]:
    normalized = " ".join(text.lower().split())
    if re.search(r"\bdemo-[a-z0-9]{8,}\b", normalized) or any(
        phrase in normalized for phrase in ("case id", "patient id", "user id")
    ):
        return "REJECT_IDENTIFIER"
    asks_to_run = any(word in normalized for word in ("investigat", "analy", "run", "check"))
    identifies_demo = any(word in normalized for word in ("synthetic", "demo", "pillsense"))
    adherence_topic = any(
        phrase in normalized
        for phrase in ("adherence", "missed dose", "medication", "care case")
    )
    return "INVESTIGATE" if asks_to_run and identifies_demo and adherence_topic else "HELP"


def safe_result_text(result: AgentverseRequestStatus) -> str:
    source = {
        "ANTHROPIC": "the live Claude coordinator",
        "DETERMINISTIC_FALLBACK": "the explicitly labeled non-LLM fallback",
    }.get(result.provider or "", "the PillSense coordinator")
    signals = ", ".join(
        f"{item.get('category', 'UNKNOWN').replace('_', ' ')} "
        f"({item.get('uncertainty', 'UNKNOWN').lower()} uncertainty)"
        for item in result.findingSignals[:6]
    ) or "no safe finding signals available"
    action = (result.proposedAction or "HUMAN_REVIEW").replace("_", " ")
    return (
        f"Synthetic demo investigation completed through {source}. "
        f"The coordinator executed {result.toolCallCount} case-scoped evidence tool call(s). "
        f"Safe finding signals: {signals}. Proposed human follow-up: {action}. "
        "No medication instructions were changed, no ingestion was inferred, and no dispense command was issued."
    )


class AsiOneChatWorkflow:
    def __init__(self, bridge: ConvexAgentClient, config: AsiChatConfig):
        self.bridge = bridge
        self.config = config

    async def handle(self, ctx: ChatContext, sender: str, message: ChatMessage) -> None:
        await ctx.send(
            sender,
            ChatAcknowledgement(acknowledged_msg_id=message.msg_id),
        )
        intent = classify_intent(text_from_message(message))
        if intent == "REJECT_IDENTIFIER":
            await self._send_text(
                ctx,
                sender,
                "PillSense does not accept patient IDs, case IDs, or aliases in chat. "
                "Ask me to run the preauthorized synthetic demo adherence investigation instead.",
                end_session=True,
            )
            return
        if intent != "INVESTIGATE":
            await self._send_text(
                ctx,
                sender,
                "I can run one safe workflow: ‘Run the PillSense synthetic demo adherence investigation.’ "
                "It uses a caregiver-preauthorized synthetic case and cannot dispense or change medication instructions.",
                end_session=True,
            )
            return
        if not self.config.case_alias:
            await self._send_text(
                ctx,
                sender,
                "The synthetic demo case has not been preauthorized by the caregiver yet. "
                "No investigation was started.",
                end_session=True,
            )
            return

        request_id = str(message.msg_id)
        sent_at = int(message.timestamp.timestamp() * 1000)
        try:
            accepted = await asyncio.to_thread(
                self.bridge.accept_agentverse_request,
                source_agent_address=sender,
                protocol_version="1.0",
                request_id=request_id,
                request_type="DEMO_ADHERENCE_INVESTIGATION",
                case_alias=self.config.case_alias,
                sent_at=sent_at,
                transport=ASI_TRANSPORT,
            )
        except ConvexBridgeError:
            await self._send_text(
                ctx, sender, "The coordinator bridge is unavailable. No private data was returned.",
                end_session=True,
            )
            return
        if not accepted.ok:
            detail = "This chat request was already processed." if accepted.code == "REPLAY_REJECTED" else (
                "The preauthorized synthetic case is unavailable or no longer current."
            )
            await self._send_text(ctx, sender, detail, end_session=True)
            return

        if not await self._send_text(
            ctx,
            sender,
            "Request accepted. The existing PillSense coordinator is now running bounded, case-scoped evidence tools.",
            response_status="IN_PROGRESS",
            request_id=request_id,
        ):
            return

        deadline = time.monotonic() + self.config.wait_seconds
        while time.monotonic() < deadline:
            try:
                current = await asyncio.to_thread(
                    self.bridge.sync_agentverse_request,
                    source_agent_address=sender,
                    request_id=request_id,
                    transport=ASI_TRANSPORT,
                )
            except ConvexBridgeError:
                await self._record_failure(sender, request_id, "COORDINATOR_BRIDGE_UNAVAILABLE")
                await self._send_text(
                    ctx, sender, "The coordinator bridge became unavailable. The request failed safely.",
                    end_session=True,
                )
                return
            if current.status == "COMPLETED":
                await self._send_text(
                    ctx,
                    sender,
                    safe_result_text(current),
                    end_session=True,
                    response_status="COMPLETED",
                    request_id=request_id,
                )
                return
            if current.status == "FAILED":
                await self._send_text(
                    ctx,
                    sender,
                    "The synthetic investigation failed safely. No dispense or medication change was performed.",
                    end_session=True,
                    response_status="FAILED",
                    request_id=request_id,
                )
                return
            await asyncio.sleep(self.config.poll_seconds)

        await self._record_failure(sender, request_id, "COORDINATOR_TIMEOUT")
        await self._send_text(
            ctx,
            sender,
            "The synthetic investigation timed out and failed safely. No dispense or medication change was performed.",
            end_session=True,
            response_status="FAILED",
            request_id=request_id,
        )

    async def _send_text(
        self,
        ctx: ChatContext,
        sender: str,
        text: str,
        *,
        end_session: bool = False,
        response_status: str | None = None,
        request_id: str | None = None,
    ) -> bool:
        content: list[TextContent | EndSessionContent] = [TextContent(text=text)]
        if end_session:
            content.append(EndSessionContent())
        result = await ctx.send(sender, ChatMessage(content=content))
        submitted = getattr(result, "status", DeliveryStatus.SENT) in {
            DeliveryStatus.SENT,
            DeliveryStatus.DELIVERED,
            "sent",
            "delivered",
        }
        if submitted and response_status and request_id:
            try:
                await asyncio.to_thread(
                    self.bridge.mark_agentverse_response_submitted,
                    source_agent_address=sender,
                    request_id=request_id,
                    response_status=response_status,
                    transport=ASI_TRANSPORT,
                )
            except ConvexBridgeError:
                pass
        return submitted

    async def _record_failure(self, sender: str, request_id: str, code: str) -> None:
        try:
            await asyncio.to_thread(
                self.bridge.fail_agentverse_request,
                source_agent_address=sender,
                request_id=request_id,
                outcome_code=code,
                transport=ASI_TRANSPORT,
            )
        except ConvexBridgeError:
            pass
