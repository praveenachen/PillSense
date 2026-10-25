from __future__ import annotations

import asyncio
import time
import uuid
from types import SimpleNamespace

import pytest
from pydantic.v1 import ValidationError
from uagents_core.types import DeliveryStatus
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)

from agent.convex_client import ConvexBridgeError
from agent.models import AgentverseAcceptance, AgentverseRequestStatus
from fetch_agents.protocol import CareRequest, CareResponse, REQUEST_TYPE, REFILL_REQUEST_TYPE
from fetch_agents.addresses import derive_address
from fetch_agents.workflow import CareRequestWorkflow, ResponseTracker, WorkflowConfig
from fetch_agents.asi_chat import AsiChatConfig, AsiOneChatWorkflow, classify_intent

ALLOWED = "agent1" + "a" * 60
PILLSENSE = "agent1" + "p" * 60
ALIAS = "demo-" + "c" * 32


def request(request_id: str | None = None) -> CareRequest:
    return CareRequest(
        protocol_version="1.0",
        request_id=request_id or str(uuid.uuid4()),
        request_type=REQUEST_TYPE,
        case_alias=ALIAS,
        sent_at=int(time.time() * 1000),
    )


class FakeContext:
    def __init__(self, delivery_status: DeliveryStatus = DeliveryStatus.SENT):
        self.delivery_status = delivery_status
        self.sent: list[tuple[str, CareResponse]] = []
        self.logger = SimpleNamespace()

    async def send(self, destination: str, message: CareResponse):
        self.sent.append((destination, message))
        return SimpleNamespace(status=self.delivery_status)


class FakeChatContext:
    def __init__(self):
        self.sent: list[tuple[str, object]] = []

    async def send(self, destination: str, message: object):
        self.sent.append((destination, message))
        return SimpleNamespace(status=DeliveryStatus.SENT)


class FakeBridge:
    def __init__(
        self,
        *,
        acceptance: AgentverseAcceptance | None = None,
        statuses: list[AgentverseRequestStatus] | None = None,
        accept_error: bool = False,
    ):
        self.acceptance = acceptance or AgentverseAcceptance(ok=True, status="ACK")
        self.statuses = list(statuses or [
            AgentverseRequestStatus(ok=True, status="COMPLETED", outcomeCode="INVESTIGATION_AVAILABLE")
        ])
        self.accept_error = accept_error
        self.accepted: list[dict] = []
        self.marked: list[str] = []
        self.failed: list[str] = []

    def accept_agentverse_request(self, **kwargs):
        if self.accept_error:
            raise ConvexBridgeError("BRIDGE_UNAVAILABLE")
        self.accepted.append(kwargs)
        return self.acceptance

    def sync_agentverse_request(self, **_kwargs):
        if len(self.statuses) > 1:
            return self.statuses.pop(0)
        return self.statuses[0]

    def mark_agentverse_response_submitted(self, **kwargs):
        self.marked.append(kwargs["response_status"])

    def fail_agentverse_request(self, **kwargs):
        self.failed.append(kwargs["outcome_code"])


def run(workflow: CareRequestWorkflow, ctx: FakeContext, sender: str, message: CareRequest):
    asyncio.run(workflow.handle(ctx, sender, message))


def test_message_schema_is_strict_and_versioned() -> None:
    with pytest.raises(ValidationError):
        CareRequest(
            protocol_version="2.0",
            request_id=str(uuid.uuid4()),
            request_type=REQUEST_TYPE,
            case_alias=ALIAS,
            sent_at=1,
        )
    with pytest.raises(ValidationError):
        CareResponse(
            protocol_version="1.0",
            request_id=str(uuid.uuid4()),
            status="COMPLETED",
            detail_code="OK",
            sent_at=1,
            private_case_id="must-not-be-accepted",
        )


def test_stable_seeds_derive_stable_distinct_agent_addresses() -> None:
    assert derive_address("pillsense stable test seed") == derive_address(
        "pillsense stable test seed"
    )
    assert derive_address("pillsense stable test seed") != derive_address(
        "external stable test seed"
    )


def test_official_agent_chat_protocol_version_is_pinned() -> None:
    assert chat_protocol_spec.name == "AgentChatProtocol"
    assert chat_protocol_spec.version == "0.3.0"


def test_asi_chat_rejects_browser_supplied_identifiers_without_handoff() -> None:
    bridge = FakeBridge()
    context = FakeChatContext()
    workflow = AsiOneChatWorkflow(bridge, AsiChatConfig(ALIAS, 0.1, 0.001))
    message = ChatMessage(content=[TextContent(
        text=f"Investigate the synthetic adherence case id {ALIAS}",
    )])
    asyncio.run(workflow.handle(context, ALLOWED, message))
    assert bridge.accepted == []
    assert isinstance(context.sent[0][1], ChatAcknowledgement)
    response = context.sent[1][1]
    assert isinstance(response, ChatMessage)
    assert "does not accept patient IDs" in response.content[0].text
    assert isinstance(response.content[-1], EndSessionContent)


def test_asi_chat_requires_a_caregiver_preauthorized_alias() -> None:
    bridge = FakeBridge()
    context = FakeChatContext()
    workflow = AsiOneChatWorkflow(bridge, AsiChatConfig(None, 0.1, 0.001))
    message = ChatMessage(content=[TextContent(
        text="Run the PillSense synthetic demo adherence investigation.",
    )])
    asyncio.run(workflow.handle(context, ALLOWED, message))
    assert bridge.accepted == []
    response = context.sent[1][1]
    assert isinstance(response, ChatMessage)
    assert "not been preauthorized" in response.content[0].text


def test_asi_chat_completes_primary_workflow_with_safe_tool_result() -> None:
    bridge = FakeBridge(statuses=[AgentverseRequestStatus(
        ok=True,
        status="COMPLETED",
        outcomeCode="INVESTIGATION_AVAILABLE",
        provider="ANTHROPIC",
        toolCallCount=3,
        findingSignals=[{"category": "NO_RECORDED_RESPONSE", "uncertainty": "LOW"}],
        proposedAction="CONTACT_PATIENT",
    )])
    context = FakeChatContext()
    workflow = AsiOneChatWorkflow(bridge, AsiChatConfig(ALIAS, 0.1, 0.001))
    message = ChatMessage(content=[TextContent(
        text="Run the PillSense synthetic demo adherence investigation.",
    )])
    asyncio.run(workflow.handle(context, ALLOWED, message))

    assert isinstance(context.sent[0][1], ChatAcknowledgement)
    assert [type(message).__name__ for _, message in context.sent] == [
        "ChatAcknowledgement", "ChatMessage", "ChatMessage",
    ]
    assert bridge.accepted[0]["transport"] == "ASI_ONE_ACP"
    final = context.sent[-1][1]
    assert isinstance(final, ChatMessage)
    text = final.content[0].text
    assert "live Claude coordinator" in text
    assert "3 case-scoped evidence tool call(s)" in text
    assert "NO RECORDED RESPONSE" in text
    assert "CONTACT PATIENT" in text
    assert ALIAS not in text
    assert "patient-doc-id" not in text
    assert isinstance(final.content[-1], EndSessionContent)


def test_asi_chat_help_is_non_mutating() -> None:
    assert classify_intent("What can PillSense do?") == "HELP"
    bridge = FakeBridge()
    context = FakeChatContext()
    workflow = AsiOneChatWorkflow(bridge, AsiChatConfig(ALIAS, 0.1, 0.001))
    asyncio.run(workflow.handle(
        context,
        ALLOWED,
        ChatMessage(content=[TextContent(text="What can PillSense do?")]),
    ))
    assert bridge.accepted == []
    response = context.sent[-1][1]
    assert isinstance(response, ChatMessage)
    assert "Run the PillSense synthetic demo adherence investigation" in response.content[0].text
def test_unallowlisted_sender_gets_no_response_or_handoff() -> None:
    bridge = FakeBridge()
    context = FakeContext()
    workflow = CareRequestWorkflow(bridge, WorkflowConfig(ALLOWED, 0.1, 0.001))
    run(workflow, context, "agent1" + "x" * 60, request())
    assert bridge.accepted == []
    assert context.sent == []


def test_valid_request_hands_off_and_correlates_all_statuses() -> None:
    bridge = FakeBridge(statuses=[
        AgentverseRequestStatus(ok=True, status="IN_PROGRESS"),
        AgentverseRequestStatus(ok=True, status="COMPLETED", outcomeCode="INVESTIGATION_AVAILABLE"),
    ])
    context = FakeContext()
    message = request()
    workflow = CareRequestWorkflow(bridge, WorkflowConfig(ALLOWED, 0.1, 0.001))
    run(workflow, context, ALLOWED, message)
    assert [item.status for _, item in context.sent] == ["ACK", "IN_PROGRESS", "COMPLETED"]
    assert all(item.request_id == message.request_id for _, item in context.sent)
    assert bridge.marked == ["ACK", "IN_PROGRESS", "COMPLETED"]
    assert bridge.accepted[0]["case_alias"] == ALIAS


def test_refill_request_returns_only_safe_structured_status() -> None:
    bridge = FakeBridge(statuses=[AgentverseRequestStatus(
        ok=True, status="COMPLETED", outcomeCode="AWAITING_CAREGIVER_APPROVAL",
    )])
    context = FakeContext()
    message = CareRequest(
        protocol_version="1.0", request_id=str(uuid.uuid4()),
        request_type=REFILL_REQUEST_TYPE, case_alias=ALIAS,
        sent_at=int(time.time() * 1000),
    )
    workflow = CareRequestWorkflow(bridge, WorkflowConfig(ALLOWED, 0.1, 0.001))
    run(workflow, context, ALLOWED, message)
    assert bridge.accepted[0]["request_type"] == REFILL_REQUEST_TYPE
    assert context.sent[-1][1].detail_code == "AWAITING_CAREGIVER_APPROVAL"
    assert context.sent[-1][1].status == "COMPLETED"


def test_duplicate_request_is_rejected_without_second_handoff() -> None:
    bridge = FakeBridge(acceptance=AgentverseAcceptance(
        ok=False, code="REPLAY_REJECTED", duplicate=True,
    ))
    context = FakeContext()
    workflow = CareRequestWorkflow(bridge, WorkflowConfig(ALLOWED, 0.1, 0.001))
    run(workflow, context, ALLOWED, request())
    assert [item.status for _, item in context.sent] == ["FAILED"]
    assert context.sent[0][1].detail_code == "REPLAY_REJECTED"
    assert bridge.marked == []


def test_unavailable_convex_bridge_fails_closed() -> None:
    bridge = FakeBridge(accept_error=True)
    context = FakeContext()
    workflow = CareRequestWorkflow(bridge, WorkflowConfig(ALLOWED, 0.1, 0.001))
    run(workflow, context, ALLOWED, request())
    assert context.sent[0][1].detail_code == "COORDINATOR_BRIDGE_UNAVAILABLE"
    assert bridge.marked == []


def test_timeout_is_persisted_and_returned() -> None:
    bridge = FakeBridge(statuses=[AgentverseRequestStatus(ok=True, status="IN_PROGRESS")])
    context = FakeContext()
    workflow = CareRequestWorkflow(bridge, WorkflowConfig(ALLOWED, 0.005, 0.001))
    run(workflow, context, ALLOWED, request())
    assert bridge.failed == ["COORDINATOR_TIMEOUT"]
    assert context.sent[-1][1].status == "FAILED"
    assert context.sent[-1][1].detail_code == "COORDINATOR_TIMEOUT"


def test_failed_agentverse_submission_is_not_recorded_as_sent() -> None:
    bridge = FakeBridge()
    context = FakeContext(DeliveryStatus.FAILED)
    workflow = CareRequestWorkflow(bridge, WorkflowConfig(ALLOWED, 0.1, 0.001))
    run(workflow, context, ALLOWED, request())
    assert [item.status for _, item in context.sent] == ["ACK"]
    assert bridge.marked == []


def test_external_response_tracker_rejects_wrong_sender_and_request() -> None:
    request_id = str(uuid.uuid4())
    response = CareResponse(
        protocol_version="1.0",
        request_id=request_id,
        status="ACK",
        detail_code="REQUEST_ACCEPTED",
        sent_at=1,
    )
    tracker = ResponseTracker(PILLSENSE, request_id)
    assert tracker.accept(ALLOWED, response) is False
    assert tracker.accept(PILLSENSE, response.copy(update={"request_id": str(uuid.uuid4())})) is False
    assert tracker.accept(PILLSENSE, response) is True
    assert tracker.responses == [response]
