from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .models import (
    AgentverseAcceptance,
    AgentverseRequestStatus,
    ClaimedRun,
    InvestigationFindings,
    RunContext,
    ToolResult,
)


class ConvexBridgeError(RuntimeError):
    def __init__(self, code: str, status: int | None = None):
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class ConvexClientConfig:
    service_url: str
    service_secret: str
    timeout_seconds: float = 10.0
    max_attempts: int = 3


class ConvexAgentClient:
    def __init__(self, config: ConvexClientConfig):
        if not config.service_url.startswith("https://") and not config.service_url.startswith(
            "http://127.0.0.1"
        ):
            raise ValueError("CONVEX_AGENT_URL must use HTTPS (or loopback HTTP for local tests)")
        if not config.service_secret:
            raise ValueError("PILLSENSE_AGENT_SERVICE_SECRET is required")
        self.config = config

    def _request(
        self,
        payload: dict[str, Any],
        *,
        run_token: str | None = None,
    ) -> dict[str, Any]:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        headers = {
            "authorization": f"Bearer {self.config.service_secret}",
            "content-type": "application/json",
            "accept": "application/json",
        }
        if run_token:
            headers["x-pillsense-run-token"] = run_token
        last_error: Exception | None = None
        for attempt in range(self.config.max_attempts):
            try:
                request = Request(self.config.service_url, data=body, headers=headers, method="POST")
                with urlopen(request, timeout=self.config.timeout_seconds) as response:
                    parsed = json.loads(response.read().decode("utf-8"))
                    if not isinstance(parsed, dict):
                        raise ConvexBridgeError("INVALID_BRIDGE_RESPONSE", response.status)
                    return parsed
            except HTTPError as error:
                try:
                    parsed_error = json.loads(error.read().decode("utf-8"))
                    code = parsed_error.get("error") or parsed_error.get("code") or "BRIDGE_HTTP_ERROR"
                except (ValueError, AttributeError):
                    code = "BRIDGE_HTTP_ERROR"
                if error.code not in {408, 429, 500, 502, 503, 504}:
                    raise ConvexBridgeError(str(code), error.code) from error
                last_error = ConvexBridgeError(str(code), error.code)
            except (URLError, TimeoutError, json.JSONDecodeError) as error:
                last_error = error
            if attempt + 1 < self.config.max_attempts:
                time.sleep(0.25 * (2**attempt))
        if isinstance(last_error, ConvexBridgeError):
            raise last_error
        raise ConvexBridgeError("BRIDGE_UNAVAILABLE") from last_error

    def claim_run(self, idempotency_key: str | None = None) -> ClaimedRun | None:
        result = self._request(
            {
                "operation": "claimRun",
                "idempotencyKey": idempotency_key or str(uuid.uuid4()),
            }
        )
        if not result.get("claimed"):
            return None
        return ClaimedRun.model_validate(result)

    def get_run_context(self, run: ClaimedRun) -> RunContext:
        result = self._request(
            {"operation": "getRunContext", "runId": run.runId},
            run_token=run.runToken,
        )
        return RunContext.model_validate(result)

    def call_tool(
        self,
        run: ClaimedRun,
        operation: str,
        idempotency_key: str,
    ) -> ToolResult:
        result = self._request(
            {
                "operation": operation,
                "runId": run.runId,
                "idempotencyKey": idempotency_key,
            },
            run_token=run.runToken,
        )
        if not result.get("ok"):
            raise ConvexBridgeError(str(result.get("code", "TOOL_FAILED")))
        return ToolResult.model_validate(result)

    def submit(
        self,
        run: ClaimedRun,
        findings: InvestigationFindings,
        *,
        provider: str,
        model: str | None,
        idempotency_key: str,
    ) -> dict[str, Any]:
        result = self._request(
            {
                "operation": "submitInvestigation",
                "runId": run.runId,
                "idempotencyKey": idempotency_key,
                "provider": provider,
                "model": model,
                "findings": findings.model_dump(mode="json"),
            },
            run_token=run.runToken,
        )
        if not result.get("ok"):
            raise ConvexBridgeError(str(result.get("code", "SUBMISSION_FAILED")))
        return result

    def fail_run(
        self,
        run: ClaimedRun,
        failure_code: str,
        idempotency_key: str,
    ) -> None:
        result = self._request(
            {
                "operation": "failRun",
                "runId": run.runId,
                "idempotencyKey": idempotency_key,
                "failureCode": failure_code,
            },
            run_token=run.runToken,
        )
        if not result.get("ok"):
            raise ConvexBridgeError(str(result.get("code", "FAILURE_RECORDING_FAILED")))

    def accept_agentverse_request(
        self,
        *,
        source_agent_address: str,
        protocol_version: str,
        request_id: str,
        request_type: str,
        case_alias: str,
        sent_at: int,
        transport: str = "UAGENT_A2A",
    ) -> AgentverseAcceptance:
        try:
            result = self._request({
                "operation": "acceptAgentverseRequest",
                "sourceAgentAddress": source_agent_address,
                "transport": transport,
                "protocolVersion": protocol_version,
                "requestId": request_id,
                "requestType": request_type,
                "caseAlias": case_alias,
                "sentAt": sent_at,
            })
        except ConvexBridgeError as error:
            if error.status in {400, 403, 409}:
                return AgentverseAcceptance(
                    ok=False,
                    code=error.code,
                    duplicate=error.code == "REPLAY_REJECTED",
                )
            raise
        return AgentverseAcceptance.model_validate(result)

    def sync_agentverse_request(
        self,
        *,
        source_agent_address: str,
        request_id: str,
        transport: str = "UAGENT_A2A",
    ) -> AgentverseRequestStatus:
        result = self._request({
            "operation": "syncAgentverseRequest",
            "sourceAgentAddress": source_agent_address,
            "transport": transport,
            "requestId": request_id,
        })
        return AgentverseRequestStatus.model_validate(result)

    def mark_agentverse_response_submitted(
        self,
        *,
        source_agent_address: str,
        request_id: str,
        response_status: str,
        transport: str = "UAGENT_A2A",
    ) -> None:
        result = self._request({
            "operation": "markAgentverseResponseSubmitted",
            "sourceAgentAddress": source_agent_address,
            "transport": transport,
            "requestId": request_id,
            "responseStatus": response_status,
        })
        if not result.get("ok"):
            raise ConvexBridgeError(str(result.get("code", "RESPONSE_AUDIT_FAILED")))

    def fail_agentverse_request(
        self,
        *,
        source_agent_address: str,
        request_id: str,
        outcome_code: str,
        transport: str = "UAGENT_A2A",
    ) -> None:
        result = self._request({
            "operation": "failAgentverseRequest",
            "sourceAgentAddress": source_agent_address,
            "transport": transport,
            "requestId": request_id,
            "outcomeCode": outcome_code,
        })
        if not result.get("ok"):
            raise ConvexBridgeError(str(result.get("code", "REQUEST_FAILURE_AUDIT_FAILED")))
