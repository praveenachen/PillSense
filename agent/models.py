from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class FindingCategory(str, Enum):
    NO_RECORDED_RESPONSE = "NO_RECORDED_RESPONSE"
    DEVICE_CONNECTIVITY = "DEVICE_CONNECTIVITY"
    DEVICE_FAULT = "DEVICE_FAULT"
    POSSIBLE_SUPPLY_ISSUE = "POSSIBLE_SUPPLY_ISSUE"
    PILL_UNCOLLECTED = "PILL_UNCOLLECTED"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"


class Uncertainty(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class FollowUpAction(str, Enum):
    CONTACT_PATIENT = "CONTACT_PATIENT"
    REVIEW_DEVICE = "REVIEW_DEVICE"
    CHECK_PHYSICAL_SUPPLY = "CHECK_PHYSICAL_SUPPLY"
    DOCUMENT_NO_RESPONSE = "DOCUMENT_NO_RESPONSE"
    NO_ACTION = "NO_ACTION"


class Finding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: FindingCategory
    evidenceReferences: list[str] = Field(min_length=1, max_length=20)
    uncertainty: Uncertainty
    explanation: str = Field(min_length=1, max_length=600)


class ProposedFollowUp(BaseModel):
    model_config = ConfigDict(extra="forbid")

    actionType: FollowUpAction
    explanation: str = Field(min_length=1, max_length=500)


class InvestigationFindings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[Finding] = Field(min_length=1, max_length=6)
    overallSummary: str = Field(min_length=1, max_length=800)
    proposedFollowUp: ProposedFollowUp


class ClaimedRun(BaseModel):
    runId: str
    runToken: str
    careCaseId: str
    caseVersion: int


class RunContext(BaseModel):
    model_config = ConfigDict(extra="allow")

    careCaseId: str
    patientId: str
    caseVersion: int
    triggerReason: str
    workflowType: str
    casePayload: dict[str, Any]


class ToolResult(BaseModel):
    model_config = ConfigDict(extra="allow")

    ok: bool
    data: Any = None
    evidenceReferences: list[str] = Field(default_factory=list)
    summary: str = ""
    duplicate: bool = False


class AgentverseAcceptance(BaseModel):
    model_config = ConfigDict(extra="allow")

    ok: bool
    status: str | None = None
    code: str | None = None
    duplicate: bool = False


class AgentverseRequestStatus(BaseModel):
    model_config = ConfigDict(extra="allow")

    ok: bool
    status: str | None = None
    outcomeCode: str | None = None
    code: str | None = None
    provider: str | None = None
    toolCallCount: int = 0
    findingSignals: list[dict[str, str]] = Field(default_factory=list)
    proposedAction: str | None = None
