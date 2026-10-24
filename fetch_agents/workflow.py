from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Protocol

from uagents_core.types import DeliveryStatus

from agent.convex_client import ConvexAgentClient, ConvexBridgeError
from agent.models import AgentverseAcceptance, AgentverseRequestStatus
from .protocol import CareRequest, CareResponse, PROTOCOL_VERSION


class MessageContext(Protocol):
    logger: object

    async def send(self, destination: str, message: CareResponse): ...


class AgentverseBridge(Protocol):
    def accept_agentverse_request(self, **kwargs) -> AgentverseAcceptance: ...
    def sync_agentverse_request(self, **kwargs) -> AgentverseRequestStatus: ...
    def mark_agentverse_response_submitted(self, **kwargs) -> None: ...
    def fail_agentverse_request(self, **kwargs) -> None: ...


@dataclass(frozen=True)
class WorkflowConfig:
    allowed_sender: str | None
    wait_seconds: float = 180
    poll_seconds: float = 3


class CareRequestWorkflow:
    def __init__(self, bridge: ConvexAgentClient, config: WorkflowConfig):
        self.bridge = bridge
        self.config = config

    async def _send(
        self,
        ctx: MessageContext,
        sender: str,
        request_id: str,
        status: str,
        detail_code: str,
        *,
        audit: bool = True,
    ) -> bool:
        response = CareResponse(
            protocol_version=PROTOCOL_VERSION,
            request_id=request_id,
            status=status,
            detail_code=detail_code,
            sent_at=int(time.time() * 1000),
        )
        result = await ctx.send(sender, response)
        delivered = getattr(result, "status", DeliveryStatus.SENT) in {
            DeliveryStatus.SENT,
            DeliveryStatus.DELIVERED,
            "sent",
            "delivered",
        }
        if delivered and audit:
            await asyncio.to_thread(
                self.bridge.mark_agentverse_response_submitted,
                source_agent_address=sender,
                request_id=request_id,
                response_status=status,
            )
        return delivered

    async def handle(self, ctx: MessageContext, sender: str, message: CareRequest) -> None:
        # Do not confirm aliases, request IDs, or service state to untrusted senders.
        if sender != self.config.allowed_sender:
            return
        try:
            accepted = await asyncio.to_thread(
                self.bridge.accept_agentverse_request,
                source_agent_address=sender,
                protocol_version=message.protocol_version,
                request_id=message.request_id,
                request_type=message.request_type,
                case_alias=message.case_alias,
                sent_at=message.sent_at,
            )
        except ConvexBridgeError:
            await self._send(
                ctx, sender, message.request_id, "FAILED", "COORDINATOR_BRIDGE_UNAVAILABLE",
                audit=False,
            )
            return
        if not accepted.ok:
            await self._send(
                ctx,
                sender,
                message.request_id,
                "FAILED",
                accepted.code or "REQUEST_REJECTED",
                audit=False,
            )
            return

        if not await self._send(ctx, sender, message.request_id, "ACK", "REQUEST_ACCEPTED"):
            return

        deadline = time.monotonic() + self.config.wait_seconds
        in_progress_sent = False
        while time.monotonic() < deadline:
            try:
                current = await asyncio.to_thread(
                    self.bridge.sync_agentverse_request,
                    source_agent_address=sender,
                    request_id=message.request_id,
                )
            except ConvexBridgeError:
                await self._record_failure(sender, message.request_id, "COORDINATOR_BRIDGE_UNAVAILABLE")
                await self._send(
                    ctx, sender, message.request_id, "FAILED", "COORDINATOR_BRIDGE_UNAVAILABLE",
                    audit=False,
                )
                return
            if current.status == "COMPLETED":
                await self._send(
                    ctx, sender, message.request_id, "COMPLETED",
                    current.outcomeCode or "INVESTIGATION_AVAILABLE",
                )
                return
            if current.status == "FAILED":
                await self._send(
                    ctx, sender, message.request_id, "FAILED",
                    current.outcomeCode or "COORDINATOR_FAILED",
                )
                return
            if not in_progress_sent:
                if not await self._send(
                    ctx, sender, message.request_id, "IN_PROGRESS", "COORDINATOR_RUN_LINKED",
                ):
                    return
                in_progress_sent = True
            await asyncio.sleep(self.config.poll_seconds)

        await self._record_failure(sender, message.request_id, "COORDINATOR_TIMEOUT")
        await self._send(
            ctx, sender, message.request_id, "FAILED", "COORDINATOR_TIMEOUT",
        )

    async def _record_failure(self, sender: str, request_id: str, code: str) -> None:
        try:
            await asyncio.to_thread(
                self.bridge.fail_agentverse_request,
                source_agent_address=sender,
                request_id=request_id,
                outcome_code=code,
            )
        except ConvexBridgeError:
            return


class ResponseTracker:
    def __init__(self, expected_sender: str, request_id: str):
        self.expected_sender = expected_sender
        self.request_id = request_id
        self.responses: list[CareResponse] = []

    def accept(self, sender: str, response: CareResponse) -> bool:
        if sender != self.expected_sender or response.request_id != self.request_id:
            return False
        self.responses.append(response)
        return True
