# Walgreens sandbox refill handoff

The integration uses the existing `refillCases` and Claude coordinator run. Only an authenticated, paired caregiver can review a recommendation, record `REQUEST_REFILL`, approve the Walgreens handoff, create a hosted checkout session, or read its URL. The browser return is unverified; only the existing caregiver `RECEIVE_REFILL` transition changes supply after physical receipt.

## Convex configuration

Set these **on the intended Convex development deployment**:

```text
WALGREENS_MODE=sandbox
WALGREENS_REFILL_API_KEY=<sandbox key>
WALGREENS_REFILL_AFF_ID=<sandbox affiliate ID>
WALGREENS_CALLBACK_URL=https://<deployment>.convex.site/walgreens/refill/callback
```

Use `WALGREENS_MODE=mock` when sandbox access is unavailable. An unset mode with no API key also selects mock mode. Mock mode needs no Walgreens credentials; it uses the Convex site callback URL unless `WALGREENS_CALLBACK_URL` is set. A mock `landingUrl` points directly to the callback and simulates `DONE`; it is **not** Walgreens checkout. Only [Walgreens' official sandbox Rx numbers](https://developer.walgreens.com/support/rx-numbers), such as `0459772-59382`, are accepted. The server only posts to the [documented QA endpoint](https://developer.walgreens.com/sites/default/files/v2_RXRefillAPI.html); there is no production endpoint in the adapter.

The callback URL is the configured `WALGREENS_CALLBACK_URL` above, or the Convex site URL with `/walgreens/refill/callback` appended. It must be publicly reachable over HTTPS and end at `/walgreens/refill/callback`. Register that URL with Walgreens if their sandbox account requires registration. Keep its path and scheme exact; the server appends a single-use token for each checkout.

## Frontend integration contract

The caregiver refill card now calls the existing approval and session actions and shows checkout status. The sequence is:

Latest `main` adds `src/components/refill-bell.tsx` on Today. Its “Order” action currently calls the existing caregiver-only `refills.transition` review/request mutations; it does not open Walgreens checkout. Keep the Walgreens approval and hosted URL in the authenticated caregiver flow. The frontend teammate should resolve the patient-facing button behavior and wording separately; it must not bypass caregiver authorization.

1. `api.refills.listForCaregiver` shows forecast, case status, and the existing coordinator investigation state. If needed, call `api.agentRuns.requestRefillInvestigation({ refillCaseId })`; the existing coordinator worker must process it.
2. Show the recommendation and evidence from `api.agentRuns.listForCaregiver`. For explicit review, call `api.refills.transition({ refillCaseId, action: "REVIEW" })`, followed by `api.refills.transition({ refillCaseId, action: "REQUEST_REFILL" })` only after caregiver confirmation.
3. Call `api.walgreens.approve({ refillCaseId })` after the coordinator investigation completes. This returns `checkoutId`. The caller must present the Walgreens handoff clearly to the caregiver.
4. Call `api.walgreens.createSession({ checkoutId, idempotencyKey, rxNumber })` with a stable random idempotency key for that button attempt and an official sandbox Rx number. In `CHECKOUT_READY`, open the returned `landingUrl` in a browser. Do not show or log the Rx number or URL in analytics.
5. Query `api.walgreens.listForCase({ refillCaseId })` for checkout status. `CHECKOUT_RETURNED_UNVERIFIED` means the browser returned from Walgreens, not that a pharmacy filled or delivered a prescription. On physical receipt, the caregiver can use the existing `RECEIVE_REFILL` transition with a verified count.

An ambiguous `ERROR` checkout blocks another approval because a network failure could have produced a hosted checkout. A missing credential or explicit credential rejection can be corrected, then the caregiver can approve a new attempt. There is intentionally no automatic retry of a Walgreens POST.

## Fetch.ai demo contract

The existing PillSense uAgent keeps its seed, address, and protocol. A paired caregiver calls `api.agentverse.preauthorizeRefillCase({ refillCaseId })` for a synthetic active refill case and gives its opaque alias to the configured allowlisted external agent. Start the existing coordinator worker and PillSense Fetch agent, then send a `CareRequest` with `request_type="DEMO_REFILL_STATUS"` and that alias. The test sender can use `python -m fetch_agents.external_agent --send --refill --case-alias <alias>`.

The Fetch response contains only `request_id`, transport status, and a safe outcome code such as `REFILL_RECOMMENDED`, `SUPPLY_VERIFICATION_REQUIRED`, `AWAITING_CAREGIVER_APPROVAL`, `CHECKOUT_READY`, `CHECKOUT_RETURNED_UNVERIFIED`, `CANCELLED`, or `ERROR`. It contains no medication, patient, prescription, or hosted URL. A new request ID can retrieve updated status after the caregiver handoff; the linked completed coordinator run is reused. Agentverse cannot approve or create a checkout.

## Verification boundary

Local Convex/Vitest and Python tests use mocks and synthetic records. A successful sandbox integration requires observing an actual POST to Walgreens QA and its response with configured test credentials. A successful Agentverse round trip requires the existing Fetch agents to be registered/reachable and an actual message/response. Neither is established by unit tests alone.
