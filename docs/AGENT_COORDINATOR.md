# PillSense M4 medication care coordinator

Status: implemented as a local Python 3.11 worker for the authenticated synthetic demo. Convex remains the sole persistent backend. The coordinator investigates evidence and proposes human follow-up; it cannot dispense, modify medication instructions, change inventory, mark a dose `TAKEN`, or resolve a care case.

M7 can also create or reuse the same persisted adherence run after an authenticated caregiver pre-authorizes an opaque synthetic case alias. The Fetch.ai uAgent is transport-only: it does not call Claude or define a second coordinator. All claiming, five-call evidence limits, case-version validation, structured findings, audit logging, and fallback behavior described here remain unchanged. See `docs/AGENTVERSE.md`.

## Architecture

- An authenticated caregiver requests a run from an `OPEN` synthetic care case.
- Convex creates one active `agentRuns` record per case and case version.
- A local worker polls `POST /agent/service` and atomically claims a pending run.
- The claim returns a short-lived, run-scoped token. Subsequent calls require both the server-only service secret and this run token.
- The worker may perform at most five case-scoped read-only evidence calls. Every call is persisted in `agentActions` without storing model chain-of-thought.
- Convex validates case freshness, evidence ownership, finding categories, and proposed action types before accepting results.
- If Python or the model is unavailable, the deterministic M3 caregiver alert remains fully operational.

The single HTTP endpoint accepts only these operations:

- `claimRun`
- `getRunContext`
- `getDoseEvidence`
- `getDispenseHistory`
- `getDeviceEvidence`
- `getInventoryEvidence`
- `getPatientReports`
- `getTrayObservations` (returns `NOT_AVAILABLE`; there is no camera)
- `getSupplyEstimate` (refill runs only)
- `getConsumptionForecast` (refill runs only)
- `getRefillCaseHistory` (refill runs only)
- `submitInvestigation`
- `failRun`

Requests are POST-only, limited to 32 KiB, authenticated before parsing private operations, and restricted to this allowlist. State-changing operations require idempotency keys. A supplied patient or case ID never grants access; scope comes from the claimed run.

## One-time credential setup

Do not reuse Clerk keys and do not put the worker secret in `.env.local` or any `NEXT_PUBLIC_` variable.

The worker reads only the root `.env.agent` file. The agent URL, service secret, Anthropic key/model, and polling interval do not belong in `.env.local`. Convex stores its own server-side copy of `PILLSENSE_AGENT_SERVICE_SECRET`; local files do not configure the deployed environment automatically.

1. From PowerShell, generate a secret in memory:

   ```powershell
   $agentSecret = [Convert]::ToBase64String(
     [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
   )
   ```

2. Store it on the existing Convex development deployment:

   ```powershell
   npx.cmd convex env set PILLSENSE_AGENT_SERVICE_SECRET $agentSecret
   ```

3. If `.env.agent` does not exist, copy `.env.agent.example` to it and paste the same value into `PILLSENSE_AGENT_SERVICE_SECRET`. If it already exists, edit it in place; never replace its existing credentials. Keep `.env.agent` local and ignored.
4. Set `CONVEX_AGENT_URL` to the existing deployment's HTTP Actions URL plus `/agent/service`, for example the existing `NEXT_PUBLIC_CONVEX_SITE_URL` value followed by `/agent/service`.
5. Optionally set `ANTHROPIC_API_KEY` and a model available to that Anthropic account. The checked-in default is `claude-sonnet-5-5`, Anthropic's current supported Sonnet model. If the key is blank, the worker uses the clearly labeled `DETERMINISTIC_FALLBACK` path.

If the Convex environment secret is absent, the endpoint returns `503 AGENT_SERVICE_NOT_CONFIGURED`; it never falls back to unauthenticated access.

To verify that the two secret copies match without revealing either value, send an authenticated request with an unsupported operation. A response of `400 OPERATION_NOT_ALLOWED` proves authentication succeeded; `401 SERVICE_AUTHENTICATION_FAILED` means the values differ. Do not use `claimRun` as a configuration probe because it can claim pending work.

## Local installation and execution on Windows

Run from the repository root:

```powershell
py -3.11 -m venv agent\.venv
agent\.venv\Scripts\python.exe -m pip install -r agent\requirements.txt
if (-not (Test-Path .env.agent)) { Copy-Item .env.agent.example .env.agent }
```

If `.env.agent` already exists, keep it and add the Anthropic variables manually. After completing `.env.agent`, start the polling worker:

```powershell
agent\.venv\Scripts\python.exe -m agent.coordinator
```

For a single poll during a smoke test:

```powershell
agent\.venv\Scripts\python.exe -m agent.coordinator --once
```

The polling interval defaults to five seconds and is bounded to 1–60 seconds. HTTP calls use a 10-second timeout with three bounded attempts for transient errors. Idempotency keys make repeated state-changing requests safe; the worker does not independently repeat dispensing or any other physical side effect.

## Browser demonstration

1. Sign in and confirm both Clerk and Convex authentication indicators are authenticated.
2. On `/patient`, select **Simulate Overdue escalation**.
3. On `/caregiver`, locate the resulting `OPEN` synthetic care case.
4. Select **Investigate with AI**. The case changes to `PENDING`.
5. Start the local worker if it is not already running.
6. Open `/agent-activity` and watch the run reactively move through `RUNNING` to `COMPLETED`.
7. Review tool names, safe evidence references, structured findings, result source, and proposed caregiver follow-up.
8. Return to `/caregiver` to see the same enriched finding on the alert. Acknowledging or resolving the alert remains a separate human action.

For a refill investigation, run the synthetic low-supply demo in the caregiver refill panel, then select **Investigate with AI** on that refill case. Refill runs expose only the caregiver-entered supply estimate, schedule forecast, and append-only case history tools. They cannot call adherence tools, alter supply, request or receive a refill, contact a pharmacy, purchase anything, or change a dose.

## Live-LLM smoke test

This repository's automated tests use mocked Claude Messages API responses and do not spend API credits. To run a live smoke test:

1. Create an API key in the Anthropic Console and put it only in the ignored, worker-side `.env.agent` as `ANTHROPIC_API_KEY`. Keep `ANTHROPIC_MODEL=claude-sonnet-5-5`, or replace it only with another model ID enabled for that Anthropic account.
2. Create a fresh overdue synthetic case and select **Investigate with AI**.
3. Run the worker with `--once`.
4. Confirm `/agent-activity` labels the result `Live Claude · claude-sonnet-5-5`, shows one to five persisted tool calls, and contains only allowed categories, evidence IDs, and caregiver follow-up actions.
5. Confirm the case ingestion report, inventory, instructions, and status were not changed by the agent.

The implementation follows Anthropic's client-side Messages API protocol: Claude emits `tool_use` blocks, the worker executes them through the existing case-scoped registry, and the next user message returns matching `tool_result` blocks. Claude must finish by calling the strict `submit_investigation_findings` result tool. The tool schema constrains the shape, Pydantic validates all field limits and allowed values, and Convex independently validates the submitted result and its evidence ownership. Raw model reasoning and prompts are not persisted.

## Known deployment boundary

Convex cannot directly reach a laptop behind a local firewall. The Windows worker polls outbound over HTTPS. A continuously available hosted worker is required before production or unattended use. The M7 Fetch.ai agent can enqueue this same workflow, but Cartesia changes, camera data, automated pharmacy/order integrations, payments, and production notifications remain out of scope.
