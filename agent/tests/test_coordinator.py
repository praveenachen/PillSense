from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from pydantic import ValidationError

from agent.convex_client import ConvexBridgeError
from agent.coordinator import (
    AnthropicInvestigator,
    DeterministicFallbackInvestigator,
    MedicationCareCoordinator,
)
from agent.models import ClaimedRun, InvestigationFindings, RunContext, ToolResult
from agent.tools import ToolBudgetExceeded, ToolRegistry


def claimed_run() -> ClaimedRun:
    return ClaimedRun(
        runId="case:demo:v1:attempt1",
        runToken="run-token",
        careCaseId="case-doc-id",
        caseVersion=1,
    )


def run_context(trigger: str = "NO_PATIENT_RESPONSE") -> RunContext:
    return RunContext(
        careCaseId="case-doc-id",
        patientId="patient-doc-id",
        caseVersion=1,
        triggerReason=trigger,
        workflowType="ADHERENCE_INVESTIGATION",
        casePayload={"occurrenceId": "occurrence-doc-id"},
    )


def refill_context() -> RunContext:
    return RunContext(
        careCaseId="refill-case-doc-id",
        patientId="patient-doc-id",
        caseVersion=1,
        triggerReason="LOW_SUPPLY",
        workflowType="REFILL_INVESTIGATION",
        casePayload={"medicationName": "Iron Pills", "estimatedSupplyCount": 2},
    )


def valid_refill_findings() -> dict[str, Any]:
    return {
        "items": [{
            "category": "POSSIBLE_SUPPLY_ISSUE",
            "evidenceReferences": ["refillCase:refill-case-doc-id"],
            "uncertainty": "MEDIUM",
            "explanation": "The forecast indicates low supply, pending physical verification.",
        }],
        "overallSummary": "A caregiver should review the estimated supply.",
        "proposedFollowUp": {
            "actionType": "CHECK_PHYSICAL_SUPPLY",
            "explanation": "Verify the count before recording a refill workflow action.",
        },
    }


def valid_findings() -> dict[str, Any]:
    return {
        "items": [
            {
                "category": "NO_RECORDED_RESPONSE",
                "evidenceReferences": ["occurrence:occurrence-doc-id"],
                "uncertainty": "LOW",
                "explanation": "No direct response is recorded.",
            }
        ],
        "overallSummary": "The case needs a human check-in.",
        "proposedFollowUp": {
            "actionType": "CONTACT_PATIENT",
            "explanation": "Use the care team's established contact process.",
        },
    }


def tool_use(call_id: str, name: str, input_value: dict[str, Any] | None = None):
    return SimpleNamespace(
        type="tool_use",
        id=call_id,
        name=name,
        input={} if input_value is None else input_value,
    )


class FakeBridge:
    def __init__(self, *, fail_tool: str | None = None):
        self.fail_tool = fail_tool
        self.calls: list[str] = []
        self.submission: dict[str, Any] | None = None
        self.run = claimed_run()

    def claim_run(self, _idempotency_key: str):
        return self.run

    def get_run_context(self, _run: ClaimedRun):
        return run_context()

    def call_tool(self, _run: ClaimedRun, operation: str, idempotency_key: str):
        del idempotency_key
        self.calls.append(operation)
        if operation == self.fail_tool:
            raise ConvexBridgeError("SIMULATED_TOOL_FAILURE")
        data = {"estimatedSupplyCount": 2} if operation == "getSupplyEstimate" else {"ingestionReport": "UNREPORTED"}
        return ToolResult(
            ok=True,
            data=data,
            evidenceReferences=["occurrence:occurrence-doc-id"],
            summary=f"{operation} read",
        )

    def submit(self, _run, findings, *, provider, model, idempotency_key):
        self.submission = {
            "findings": findings,
            "provider": provider,
            "model": model,
            "idempotencyKey": idempotency_key,
        }
        return {"ok": True}

    def fail_run(self, *_args, **_kwargs):
        raise AssertionError("The successful test flow must not fail the run")


class FakeMessages:
    def __init__(self, responses: list[Any] | None = None, error: Exception | None = None):
        self.responses = list(responses or [])
        self.error = error
        self.requests: list[dict[str, Any]] = []

    def create(self, **kwargs):
        self.requests.append(deepcopy(kwargs))
        if self.error:
            raise self.error
        return self.responses.pop(0)


def fake_client(messages: FakeMessages):
    return SimpleNamespace(messages=messages)


def response(*blocks: Any):
    return SimpleNamespace(content=list(blocks))


def test_tool_budget_is_capped_at_five() -> None:
    bridge = FakeBridge()
    registry = ToolRegistry(bridge, claimed_run(), budget=5)
    names = [
        "get_dose_context",
        "get_dispense_history",
        "get_device_status",
        "get_inventory_context",
        "get_patient_reports",
    ]
    for name in names:
        registry.execute(name)
    with pytest.raises(ToolBudgetExceeded):
        registry.execute("get_tray_observations")
    assert registry.calls == 5


def test_invalid_or_prohibited_follow_up_is_rejected() -> None:
    invalid = valid_findings()
    invalid["proposedFollowUp"]["actionType"] = "AUTO_DISPENSE"
    with pytest.raises(ValidationError):
        InvestigationFindings.model_validate(invalid)


def test_refill_registry_rejects_adherence_and_mutating_tools() -> None:
    registry = ToolRegistry(FakeBridge(), claimed_run(), workflow_type="REFILL_INVESTIGATION")
    with pytest.raises(ValueError):
        registry.execute("get_dose_context")
    with pytest.raises(ValueError):
        registry.execute("order_refill")


def test_refill_registry_exposes_read_only_checkout_status_tool() -> None:
    registry = ToolRegistry(FakeBridge(), claimed_run(), workflow_type="REFILL_INVESTIGATION")
    assert "get_refill_checkout_status" in registry.allowed
    assert "approve_refill" not in registry.allowed


def test_claude_refill_investigation_uses_read_only_supply_tools() -> None:
    messages = FakeMessages([
        response(tool_use("supply", "get_supply_estimate"), tool_use("forecast", "get_consumption_forecast"),
                 tool_use("checkout", "get_refill_checkout_status")),
        response(tool_use("final", "submit_investigation_findings", valid_refill_findings())),
    ])
    bridge = FakeBridge()
    investigator = AnthropicInvestigator("test-key", "test-model", fake_client(messages))
    findings = investigator.investigate(
        refill_context(),
        ToolRegistry(bridge, claimed_run(), workflow_type="REFILL_INVESTIGATION"),
    )
    assert findings.proposedFollowUp.actionType.value == "CHECK_PHYSICAL_SUPPLY"
    assert bridge.calls == ["getSupplyEstimate", "getConsumptionForecast", "getRefillCheckoutStatus"]


def test_refill_deterministic_fallback_is_non_mutating() -> None:
    bridge = FakeBridge()
    findings = DeterministicFallbackInvestigator().investigate(
        refill_context(), ToolRegistry(bridge, claimed_run(), workflow_type="REFILL_INVESTIGATION")
    )
    assert findings.items[0].category.value == "POSSIBLE_SUPPLY_ISSUE"
    assert findings.proposedFollowUp.actionType.value == "CHECK_PHYSICAL_SUPPLY"
    assert bridge.calls == ["getSupplyEstimate", "getConsumptionForecast", "getRefillCaseHistory", "getRefillCheckoutStatus"]


def test_deterministic_fallback_survives_a_tool_failure() -> None:
    bridge = FakeBridge(fail_tool="getDeviceEvidence")
    registry = ToolRegistry(bridge, claimed_run(), budget=5)
    findings = DeterministicFallbackInvestigator().investigate(
        run_context("DEVICE_FAULT_OR_DISCONNECTED"), registry
    )
    assert findings.items
    assert findings.proposedFollowUp.actionType.value == "REVIEW_DEVICE"
    assert registry.calls == 5


def test_claude_executes_multiple_tool_calls_and_returns_tool_results() -> None:
    messages = FakeMessages(
        [
            response(
                tool_use("tool-1", "get_dose_context"),
                tool_use("tool-2", "get_patient_reports"),
            ),
            response(tool_use("final-1", "submit_investigation_findings", valid_findings())),
        ]
    )
    bridge = FakeBridge()
    investigator = AnthropicInvestigator("test-key", "test-model", fake_client(messages))

    findings = investigator.investigate(run_context(), ToolRegistry(bridge, claimed_run()))

    assert findings.proposedFollowUp.actionType.value == "CONTACT_PATIENT"
    assert bridge.calls == ["getDoseEvidence", "getPatientReports"]
    result_blocks = messages.requests[1]["messages"][-1]["content"]
    assert [block["tool_use_id"] for block in result_blocks] == ["tool-1", "tool-2"]
    assert all(block["type"] == "tool_result" for block in result_blocks)


def test_malformed_final_result_is_rejected_then_validated() -> None:
    malformed = valid_findings()
    malformed["proposedFollowUp"]["actionType"] = "AUTO_DISPENSE"
    messages = FakeMessages(
        [
            response(tool_use("bad-final", "submit_investigation_findings", malformed)),
            response(tool_use("good-final", "submit_investigation_findings", valid_findings())),
        ]
    )
    bridge = FakeBridge()
    investigator = AnthropicInvestigator("test-key", "test-model", fake_client(messages))

    investigator.investigate(run_context(), ToolRegistry(bridge, claimed_run()))

    error_result = messages.requests[1]["messages"][-1]["content"][0]
    assert error_result["tool_use_id"] == "bad-final"
    assert error_result["is_error"] is True
    assert bridge.calls == []


def test_claude_cannot_execute_more_than_five_evidence_tools() -> None:
    names = [
        "get_dose_context",
        "get_dispense_history",
        "get_device_status",
        "get_inventory_context",
        "get_patient_reports",
        "get_tray_observations",
    ]
    messages = FakeMessages(
        [
            response(*(tool_use(f"tool-{index}", name) for index, name in enumerate(names))),
            response(tool_use("final", "submit_investigation_findings", valid_findings())),
        ]
    )
    bridge = FakeBridge()
    investigator = AnthropicInvestigator("test-key", "test-model", fake_client(messages))

    investigator.investigate(run_context(), ToolRegistry(bridge, claimed_run(), budget=5))

    assert len(bridge.calls) == 5
    tool_results = messages.requests[1]["messages"][-1]["content"]
    assert tool_results[-1]["is_error"] is True
    assert "TOOL_BUDGET_EXCEEDED" in tool_results[-1]["content"]


def test_complete_worker_flow_with_mocked_claude() -> None:
    messages = FakeMessages(
        [
            response(tool_use("tool-1", "get_dose_context")),
            response(tool_use("final", "submit_investigation_findings", valid_findings())),
        ]
    )
    bridge = FakeBridge()
    investigator = AnthropicInvestigator("test-key", "test-model", fake_client(messages))
    coordinator = MedicationCareCoordinator(bridge, llm=investigator)

    assert coordinator.poll_once() is True
    assert bridge.calls == ["getDoseEvidence"]
    assert bridge.submission is not None
    assert bridge.submission["provider"] == "ANTHROPIC"
    assert bridge.submission["model"] == "test-model"


def test_anthropic_api_error_uses_clearly_labeled_fallback() -> None:
    bridge = FakeBridge()
    messages = FakeMessages(error=RuntimeError("simulated Anthropic outage"))
    investigator = AnthropicInvestigator("test-key", "test-model", fake_client(messages))
    coordinator = MedicationCareCoordinator(bridge, llm=investigator)

    coordinator.process(claimed_run())

    assert bridge.submission is not None
    assert bridge.submission["provider"] == "DETERMINISTIC_FALLBACK"
    assert bridge.submission["model"] is None


def test_missing_llm_uses_clearly_labeled_fallback() -> None:
    bridge = FakeBridge()
    coordinator = MedicationCareCoordinator(bridge, llm=None)

    coordinator.process(claimed_run())
    assert bridge.submission is not None
    assert bridge.submission["provider"] == "DETERMINISTIC_FALLBACK"
    assert bridge.submission["model"] is None
