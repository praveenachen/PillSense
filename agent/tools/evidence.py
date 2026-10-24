from __future__ import annotations

import uuid
from typing import Any

from ..convex_client import ConvexAgentClient
from ..models import ClaimedRun, ToolResult


TOOL_OPERATIONS = {
    "get_dose_context": "getDoseEvidence",
    "get_dispense_history": "getDispenseHistory",
    "get_device_status": "getDeviceEvidence",
    "get_inventory_context": "getInventoryEvidence",
    "get_patient_reports": "getPatientReports",
    "get_tray_observations": "getTrayObservations",
    "get_supply_estimate": "getSupplyEstimate",
    "get_consumption_forecast": "getConsumptionForecast",
    "get_refill_case_history": "getRefillCaseHistory",
    "get_refill_checkout_status": "getRefillCheckoutStatus",
}

TOOL_DESCRIPTIONS = {
    "get_dose_context": "Read the case-scoped dose occurrence and due-time context.",
    "get_dispense_history": "Read case-scoped command and motor evidence; it never proves ingestion.",
    "get_device_status": "Read case-scoped connection, alignment, fault, and device-event evidence.",
    "get_inventory_context": "Read nominal one-pill demo inventory for the assigned slot.",
    "get_patient_reports": "Read the direct TAKEN, NOT_TAKEN, or UNREPORTED patient report.",
    "get_tray_observations": "Check for tray/camera observations; currently returns NOT_AVAILABLE.",
    "get_supply_estimate": "Read the caregiver-entered supply estimate and its explicit confidence limitations.",
    "get_consumption_forecast": "Read the timezone-aware schedule consumption forecast.",
    "get_refill_case_history": "Read append-only refill workflow transitions for this case.",
    "get_refill_checkout_status": "Read safe caregiver approval and checkout progress; a return never proves fulfillment.",
}

WORKFLOW_TOOLS = {
    "ADHERENCE_INVESTIGATION": set(TOOL_OPERATIONS) - {"get_supply_estimate", "get_consumption_forecast", "get_refill_case_history"},
    "REFILL_INVESTIGATION": {"get_supply_estimate", "get_consumption_forecast", "get_refill_case_history", "get_refill_checkout_status"},
}

def tool_definitions_for(workflow_type: str) -> list[dict[str, Any]]:
    allowed = WORKFLOW_TOOLS.get(workflow_type, set())
    return [
    {
        "name": name,
        "description": TOOL_DESCRIPTIONS[name],
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
            "additionalProperties": False,
        },
        "strict": True,
    }
    for name in TOOL_DESCRIPTIONS if name in allowed
    ]

TOOL_DEFINITIONS = tool_definitions_for("ADHERENCE_INVESTIGATION")


class ToolBudgetExceeded(RuntimeError):
    pass


class ToolRegistry:
    def __init__(self, client: ConvexAgentClient, run: ClaimedRun, budget: int = 5, workflow_type: str = "ADHERENCE_INVESTIGATION"):
        self.client = client
        self.run = run
        self.budget = budget
        self.calls = 0
        self.results: dict[str, ToolResult] = {}
        self.allowed = WORKFLOW_TOOLS.get(workflow_type, set())

    def execute(self, name: str, call_id: str | None = None) -> dict[str, Any]:
        if name not in self.allowed:
            raise ValueError(f"Tool is not allowed: {name}")
        if name in self.results:
            return self.results[name].model_dump(mode="json")
        if self.calls >= self.budget:
            raise ToolBudgetExceeded("The five-call evidence budget is exhausted")
        self.calls += 1
        result = self.client.call_tool(
            self.run,
            TOOL_OPERATIONS[name],
            idempotency_key=call_id or str(uuid.uuid4()),
        )
        self.results[name] = result
        return result.model_dump(mode="json")
