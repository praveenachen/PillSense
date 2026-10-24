from __future__ import annotations

from typing import Literal

from pydantic.v1 import validator
from uagents import Model, Protocol

PROTOCOL_NAME = "PillSenseCareRequestProtocol"
PROTOCOL_VERSION = "1.0"
REQUEST_TYPE = "DEMO_ADHERENCE_INVESTIGATION"
REFILL_REQUEST_TYPE = "DEMO_REFILL_STATUS"


class StrictMessage(Model):
    class Config:
        extra = "forbid"


class CareRequest(StrictMessage):
    protocol_version: Literal["1.0"]
    request_id: str
    request_type: Literal["DEMO_ADHERENCE_INVESTIGATION", "DEMO_REFILL_STATUS"]
    case_alias: str
    sent_at: int

    @validator("request_id")
    def validate_request_id(cls, value: str) -> str:
        import uuid

        try:
            parsed = uuid.UUID(value)
        except ValueError as error:
            raise ValueError("request_id must be a UUID") from error
        if str(parsed) != value.lower():
            raise ValueError("request_id must use canonical UUID form")
        return value

    @validator("case_alias")
    def validate_case_alias(cls, value: str) -> str:
        import re

        if not re.fullmatch(r"demo-[a-z0-9]{20,64}", value):
            raise ValueError("case_alias is invalid")
        return value


class CareResponse(StrictMessage):
    protocol_version: Literal["1.0"]
    request_id: str
    status: Literal["ACK", "IN_PROGRESS", "COMPLETED", "FAILED"]
    detail_code: str
    sent_at: int


def care_protocol() -> Protocol:
    return Protocol(name=PROTOCOL_NAME, version=PROTOCOL_VERSION)
