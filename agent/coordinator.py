from __future__ import annotations

import argparse
import json
import os
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from anthropic import Anthropic

from .convex_client import ConvexAgentClient, ConvexBridgeError, ConvexClientConfig
from .models import (
    ClaimedRun,
    Finding,
    FindingCategory,
    FollowUpAction,
    InvestigationFindings,
    ProposedFollowUp,
    RunContext,
    Uncertainty,
)
from .tools import ToolBudgetExceeded, ToolRegistry, tool_definitions_for


SYSTEM_INSTRUCTIONS = """You are the PillSense Medication Care Coordinator.
Investigate only the supplied synthetic adherence or refill case using the read-only tools.
Never infer ingestion from motor completion, never recommend a catch-up dose, and never
authorize dispensing, alter medication instructions, contact a pharmacy, place an order,
or mark a refill received. Refill forecasts are estimates and require human verification.
For refill cases, read the case-scoped checkout status, explain the recommendation and
caregiver approval requirement, and describe any checkout return as unverified.
Use no more than five tool calls.
Return concise structured findings, cite only evidenceReferences returned by tools, and
propose only a permitted human caregiver follow-up. Finish by calling the
submit_investigation_findings tool; do not return the final result as prose. Do not reveal
chain-of-thought.
"""


@dataclass(frozen=True)
class WorkerSettings:
    convex_url: str
    service_secret: str
    anthropic_api_key: str | None
    anthropic_model: str
    poll_seconds: float

    @classmethod
    def from_environment(cls) -> "WorkerSettings":
        root = Path(__file__).resolve().parents[1]
        load_dotenv(root / ".env.agent", override=False)
        convex_url = os.getenv("CONVEX_AGENT_URL", "").strip()
        service_secret = os.getenv("PILLSENSE_AGENT_SERVICE_SECRET", "").strip()
        if not convex_url:
            raise RuntimeError("CONVEX_AGENT_URL is required in .env.agent")
        if not service_secret:
            raise RuntimeError("PILLSENSE_AGENT_SERVICE_SECRET is required in .env.agent")
        poll = float(os.getenv("AGENT_POLL_SECONDS", "5"))
        return cls(
            convex_url=convex_url,
            service_secret=service_secret,
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY") or None,
            anthropic_model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
            poll_seconds=min(60.0, max(1.0, poll)),
        )


FINAL_RESULT_TOOL = {
    "name": "submit_investigation_findings",
    "description": (
        "Return the final evidence-grounded investigation. Call this only after gathering "
        "enough evidence. This records no changes to medication, dispensing, or case status."
    ),
    "strict": True,
    "input_schema": {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "type": "object",
                    "properties": {
                        "category": {
                            "type": "string",
                            "enum": [category.value for category in FindingCategory],
                        },
                        "evidenceReferences": {
                            "type": "array",
                            "minItems": 1,
                            "items": {"type": "string"},
                        },
                        "uncertainty": {
                            "type": "string",
                            "enum": [value.value for value in Uncertainty],
                        },
                        "explanation": {"type": "string"},
                    },
                    "required": [
                        "category",
                        "evidenceReferences",
                        "uncertainty",
                        "explanation",
                    ],
                    "additionalProperties": False,
                },
            },
            "overallSummary": {"type": "string"},
            "proposedFollowUp": {
                "type": "object",
                "properties": {
                    "actionType": {
                        "type": "string",
                        "enum": [action.value for action in FollowUpAction],
                    },
                    "explanation": {"type": "string"},
                },
                "required": ["actionType", "explanation"],
                "additionalProperties": False,
            },
        },
        "required": ["items", "overallSummary", "proposedFollowUp"],
        "additionalProperties": False,
    },
}


def _content_block_dict(block: Any) -> dict[str, Any]:
    if isinstance(block, dict):
        return block
    if hasattr(block, "model_dump"):
        return block.model_dump(exclude_none=True)
    return {
        key: value
        for key, value in vars(block).items()
        if value is not None and not key.startswith("_")
    }


class AnthropicInvestigator:
    def __init__(self, api_key: str, model: str, client: Any | None = None):
        self.client = client or Anthropic(api_key=api_key, timeout=30.0, max_retries=2)
        self.model = model

    def investigate(
        self,
        context: RunContext,
        tools: ToolRegistry,
    ) -> InvestigationFindings:
        messages: list[dict[str, Any]] = [
            {
                "role": "user",
                "content": "Investigate this case-scoped payload:\n"
                + json.dumps(context.model_dump(mode="json"), separators=(",", ":")),
            }
        ]
        for _ in range(8):
            response = self.client.messages.create(
                model=self.model,
                max_tokens=4096,
                system=SYSTEM_INSTRUCTIONS,
                messages=messages,
                tools=[*tool_definitions_for(context.workflowType), FINAL_RESULT_TOOL],
                tool_choice={"type": "auto", "disable_parallel_tool_use": False},
            )
            assistant_content = [_content_block_dict(block) for block in response.content]
            messages.append({"role": "assistant", "content": assistant_content})
            calls = [block for block in response.content if block.type == "tool_use"]
            if not calls:
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "Return the final evidence-grounded result now by calling "
                            "submit_investigation_findings."
                        ),
                    }
                )
                continue

            has_evidence_call = any(call.name != FINAL_RESULT_TOOL["name"] for call in calls)
            tool_results: list[dict[str, Any]] = []
            for call in calls:
                if call.name == FINAL_RESULT_TOOL["name"]:
                    if has_evidence_call:
                        tool_results.append(
                            {
                                "type": "tool_result",
                                "tool_use_id": call.id,
                                "content": "Final findings must follow evidence tool results in a later turn.",
                                "is_error": True,
                            }
                        )
                        continue
                    try:
                        return InvestigationFindings.model_validate(call.input)
                    except Exception:
                        tool_results.append(
                            {
                                "type": "tool_result",
                                "tool_use_id": call.id,
                                "content": "Final findings failed application schema validation.",
                                "is_error": True,
                            }
                        )
                        continue
                try:
                    if call.input != {}:
                        raise ValueError("Evidence tools accept no arguments")
                    result = tools.execute(call.name, call.id)
                except ToolBudgetExceeded as error:
                    result = {"ok": False, "error": "TOOL_BUDGET_EXCEEDED", "detail": str(error)}
                except (ValueError, ConvexBridgeError) as error:
                    result = {"ok": False, "error": type(error).__name__}
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": call.id,
                        "content": json.dumps(result, separators=(",", ":")),
                        "is_error": not result.get("ok", False),
                    }
                )
            messages.append({"role": "user", "content": tool_results})
        raise RuntimeError("Claude tool loop exceeded the bounded workflow")


class DeterministicFallbackInvestigator:
    TOOL_ORDER = (
        "get_dose_context",
        "get_patient_reports",
        "get_dispense_history",
        "get_device_status",
        "get_inventory_context",
    )

    def investigate(
        self,
        context: RunContext,
        tools: ToolRegistry,
    ) -> InvestigationFindings:
        evidence: dict[str, dict[str, Any]] = {}
        tool_order = self.TOOL_ORDER if context.workflowType == "ADHERENCE_INVESTIGATION" else (
            "get_supply_estimate", "get_consumption_forecast", "get_refill_case_history", "get_refill_checkout_status"
        )
        for name in tool_order:
            try:
                evidence[name] = tools.execute(name)
            except (ConvexBridgeError, ToolBudgetExceeded, ValueError):
                evidence[name] = {"ok": False, "data": None, "evidenceReferences": []}

        all_refs = list(
            dict.fromkeys(
                reference
                for result in evidence.values()
                for reference in result.get("evidenceReferences", [])
            )
        )
        if context.workflowType == "REFILL_INVESTIGATION":
            refs = all_refs or [f"refillCase:{context.careCaseId}"]
            supply = evidence.get("get_supply_estimate", {}).get("data") or {}
            forecast = evidence.get("get_consumption_forecast", {}).get("data") or {}
            unknown = supply.get("estimatedSupplyCount") is None
            return InvestigationFindings(
                items=[Finding(
                    category=FindingCategory.INSUFFICIENT_EVIDENCE if unknown else FindingCategory.POSSIBLE_SUPPLY_ISSUE,
                    evidenceReferences=refs[:20],
                    uncertainty=Uncertainty.HIGH if unknown else Uncertainty.MEDIUM,
                    explanation="Caregiver-entered supply is unavailable and requires physical verification." if unknown else "The schedule-based forecast indicates low supply; the physical count is not sensor-verified.",
                )],
                overallSummary="NON-LLM deterministic refill review completed from case-scoped records.",
                proposedFollowUp=ProposedFollowUp(actionType=FollowUpAction.CHECK_PHYSICAL_SUPPLY, explanation="A caregiver should verify supply and decide whether to record a refill request. No purchase, pharmacy contact, or dose action was performed."),
            )
        occurrence_ref = next(
            (reference for reference in all_refs if reference.startswith("occurrence:")),
            f"occurrence:{context.casePayload.get('occurrenceId')}",
        )
        baseline_refs = [occurrence_ref]
        trigger = context.triggerReason
        category = FindingCategory.INSUFFICIENT_EVIDENCE
        action = FollowUpAction.CONTACT_PATIENT
        explanation = "Available records do not verify ingestion; direct human confirmation is needed."
        uncertainty = Uncertainty.HIGH

        if trigger == "NO_PATIENT_RESPONSE":
            category = FindingCategory.NO_RECORDED_RESPONSE
            action = FollowUpAction.CONTACT_PATIENT
            explanation = "No direct patient response is recorded for this occurrence."
            uncertainty = Uncertainty.LOW
        elif trigger == "DEVICE_FAULT_OR_DISCONNECTED":
            device = evidence.get("get_device_status", {}).get("data") or {}
            runtime = device.get("runtime") or {}
            if runtime.get("state") == "FAULT":
                category = FindingCategory.DEVICE_FAULT
                explanation = "Case-scoped device evidence records a fault state."
            else:
                category = FindingCategory.DEVICE_CONNECTIVITY
                explanation = "Case-scoped evidence records a disconnection or unavailable device state."
            action = FollowUpAction.REVIEW_DEVICE
            uncertainty = Uncertainty.LOW
        elif trigger == "MOTOR_OUTCOME_UNKNOWN":
            category = FindingCategory.DEVICE_CONNECTIVITY
            action = FollowUpAction.REVIEW_DEVICE
            explanation = "The motor outcome is ambiguous and must not be retried automatically."
            uncertainty = Uncertainty.MEDIUM
        elif trigger == "MOTOR_COMPLETED_INGESTION_UNCONFIRMED":
            category = FindingCategory.INSUFFICIENT_EVIDENCE
            action = FollowUpAction.CONTACT_PATIENT
            explanation = "Motor completion is recorded, but release, collection, and ingestion remain unverified."
            uncertainty = Uncertainty.HIGH
        elif trigger == "PATIENT_REPORTED_NOT_TAKEN":
            category = FindingCategory.INSUFFICIENT_EVIDENCE
            action = FollowUpAction.CONTACT_PATIENT
            explanation = "The patient reported NOT_TAKEN; no medication recommendation is inferred."
            uncertainty = Uncertainty.LOW

        inventory_data = evidence.get("get_inventory_context", {}).get("data")
        items = [
            Finding(
                category=category,
                evidenceReferences=all_refs[:20] or baseline_refs,
                uncertainty=uncertainty,
                explanation=explanation,
            )
        ]
        if isinstance(inventory_data, dict) and inventory_data.get("demoInventory") == 0:
            inventory_refs = evidence["get_inventory_context"].get("evidenceReferences", [])
            items.append(
                Finding(
                    category=FindingCategory.POSSIBLE_SUPPLY_ISSUE,
                    evidenceReferences=inventory_refs[:20],
                    uncertainty=Uncertainty.MEDIUM,
                    explanation="Nominal demo inventory is empty; physical supply still requires human inspection.",
                )
            )
            if action == FollowUpAction.CONTACT_PATIENT:
                action = FollowUpAction.CHECK_PHYSICAL_SUPPLY

        return InvestigationFindings(
            items=items,
            overallSummary="NON-LLM deterministic review completed from case-scoped records.",
            proposedFollowUp=ProposedFollowUp(
                actionType=action,
                explanation="Use the care team's established human follow-up process; do not auto-dispense or recommend a late dose.",
            ),
        )


class MedicationCareCoordinator:
    def __init__(
        self,
        bridge: ConvexAgentClient,
        *,
        llm: AnthropicInvestigator | None,
    ):
        self.bridge = bridge
        self.llm = llm
        self.fallback = DeterministicFallbackInvestigator()

    def process(self, run: ClaimedRun) -> str:
        context = self.bridge.get_run_context(run)
        tools = ToolRegistry(self.bridge, run, budget=5, workflow_type=context.workflowType)
        provider = "DETERMINISTIC_FALLBACK"
        model: str | None = None
        if self.llm:
            try:
                findings = self.llm.investigate(context, tools)
                provider = "ANTHROPIC"
                model = self.llm.model
            except Exception:
                findings = self.fallback.investigate(context, tools)
        else:
            findings = self.fallback.investigate(context, tools)
        self.bridge.submit(
            run,
            findings,
            provider=provider,
            model=model,
            idempotency_key=f"result:{run.runId}:{run.caseVersion}",
        )
        return provider

    def poll_once(self) -> bool:
        claim_key = str(uuid.uuid4())
        run = self.bridge.claim_run(claim_key)
        if not run:
            return False
        try:
            provider = self.process(run)
            print(f"Completed {run.runId} with {provider}")
        except ConvexBridgeError as error:
            if error.code != "STALE_CASE_VERSION":
                try:
                    self.bridge.fail_run(
                        run,
                        failure_code=error.code,
                        idempotency_key=f"failure:{run.runId}:{claim_key}",
                    )
                except ConvexBridgeError:
                    pass
            print(f"Run {run.runId} stopped safely: {error.code}")
        except Exception as error:
            try:
                self.bridge.fail_run(
                    run,
                    failure_code=type(error).__name__.upper(),
                    idempotency_key=f"failure:{run.runId}:{claim_key}",
                )
            except ConvexBridgeError:
                pass
            print(f"Run {run.runId} stopped safely")
        return True


def build_coordinator(settings: WorkerSettings) -> MedicationCareCoordinator:
    bridge = ConvexAgentClient(
        ConvexClientConfig(
            service_url=settings.convex_url,
            service_secret=settings.service_secret,
        )
    )
    llm = (
        AnthropicInvestigator(settings.anthropic_api_key, settings.anthropic_model)
        if settings.anthropic_api_key
        else None
    )
    return MedicationCareCoordinator(bridge, llm=llm)


def main() -> None:
    parser = argparse.ArgumentParser(description="PillSense local medication care coordinator")
    parser.add_argument("--once", action="store_true", help="Poll once, then exit")
    args = parser.parse_args()
    settings = WorkerSettings.from_environment()
    coordinator = build_coordinator(settings)
    mode = "live Anthropic Claude" if settings.anthropic_api_key else "NON-LLM deterministic fallback"
    print(f"PillSense coordinator started ({mode}); secrets are not logged")
    while True:
        coordinator.poll_once()
        if args.once:
            return
        time.sleep(settings.poll_seconds)


if __name__ == "__main__":
    main()
