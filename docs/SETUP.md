# PillSense development setup

## Local app

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` only if you do not already have `.env.local`.
3. Keep the existing `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, and `NEXT_PUBLIC_CONVEX_SITE_URL` values from the provisioned deployment. Do not create a replacement deployment.
4. Run `npm run dev`.

Environment files stay ignored except for `.env.example`; never commit `.env.local` or secret keys.

## Environment ownership

Keep configuration split by runtime:

| Location | Variables | Purpose |
| --- | --- | --- |
| `.env.local` | `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_JWT_ISSUER_DOMAIN`, `CARTESIA_API_KEY`, optional `CARTESIA_VOICE_ID` | Next.js, Clerk, Cartesia server routes, and commands targeting the existing Convex development deployment |
| `.env.agent` | `CONVEX_AGENT_URL`, `PILLSENSE_AGENT_SERVICE_SECRET`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `AGENT_POLL_SECONDS` | Local Python coordinator only |
| `.env.fetch` | `CONVEX_AGENT_URL`, `PILLSENSE_AGENT_SERVICE_SECRET`, stable uAgent seeds, derived agent addresses, synthetic case alias, bounded polling settings | Local Fetch.ai mailbox agents only |
| Convex development environment | `PILLSENSE_AGENT_SERVICE_SECRET`, `PILLSENSE_AGENTVERSE_ALLOWED_SENDER`, and the deployed Clerk issuer configuration | Server-side bridge authentication, exact uAgent sender allowlist, and Clerk JWT validation |

`PILLSENSE_AGENT_SERVICE_SECRET` must have the same value in `.env.agent` and the existing Convex development environment. It must not be placed in `.env.local`, prefixed with `NEXT_PUBLIC_`, or exposed to frontend code. `.env.example` and `.env.agent.example` contain names and placeholders only.

M7 adds `.env.fetch.example`. The real `.env.fetch`, agent seed phrases, service secret, preauthorized alias, and Agentverse addresses remain server-only and gitignored. ACP registration, ASI:One verification, and the optional two-uAgent demo are in `docs/AGENTVERSE.md`.

## Start the local stack

Use separate terminals from the repository root:

```powershell
# Terminal 1: keep the existing Convex development deployment connected
npx.cmd convex dev

# Terminal 2: Next.js
npm run dev

# Terminal 3: optional care coordinator
agent\.venv\Scripts\python.exe -m agent.coordinator
```

The coordinator uses `claude-sonnet-5-5` when `ANTHROPIC_API_KEY` is present. If the key is missing or Claude fails, it submits the explicitly labeled `DETERMINISTIC_FALLBACK` result. Do not run the worker merely to validate the key: a claimed investigation may make a paid Anthropic request.

## Clerk + Convex authentication (remaining manual configuration)

The React boundary is scaffolded with Clerk's `ClerkProvider` and Convex's `ConvexProviderWithClerk`. It activates only when both `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` exist. Without them, the M0 route shells render but receive no Convex client and query no protected data.

1. Create or select a Clerk application.
2. Add its publishable key as `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and secret key as `CLERK_SECRET_KEY` in `.env.local` and the hosting environment.
3. In Clerk, enable the Convex integration or create the Clerk JWT template named `convex` with audience/application ID `convex`.
4. Set `CLERK_JWT_ISSUER_DOMAIN` to the exact issuer domain Clerk provides. `convex/auth.config.ts` uses it to validate Clerk tokens.
5. Run `npx convex dev` against the **existing** `CONVEX_DEPLOYMENT` so the auth configuration reaches that development deployment. Do not change or regenerate deployment credentials.
6. Before adding protected queries or mutations, require `ctx.auth.getUserIdentity()` server-side and derive ownership from `tokenIdentifier`; never trust a client-supplied user ID.

M1/M2 medication, occurrence, command, event, and caregiver activity functions are protected in Convex. The public route shells do not grant data access.

The temporary `auth.confirmation` query is the reference authorization pattern:
it rejects missing identities inside Convex and returns only
`{ authenticated: true }`. Page visibility is not a substitute for this
function-level check. The current route shells contain no private data and may
remain public; future medication, device, and caregiver functions must derive
the caller from `ctx.auth.getUserIdentity()` and enforce ownership or role
authorization before reading data.

## Verification

Run:

```text
npm run typecheck
npm run lint
npm test
```

The device contract and mock live in `src/lib/dispenser`. The proposed firmware behavior is in `docs/DEVICE_PROTOCOL.md`.

## M2 demo dispensing

1. Sign in and confirm both Clerk and Convex show authenticated.
2. Ensure the synthetic Iron Pills assignment exists in Slot 6 with one inert demo pill.
3. Open `/patient`. The browser mock connects in `CALIBRATION_REQUIRED` state.
4. Select **Calibrate Home**.
5. Select **Create due dose · DEMO MODE**. This creates a synthetic due occurrence linked to the active schedule without changing its instructions or time.
6. Leave **Simulated result** on **Motor completed** and select **Dispense mock pill**.
7. Review the persisted result and estimated inventory on `/caregiver`.

The adapter, mock motor result, and release/collection evidence are simulated. Dose occurrences, authorizations, command attempts, device events, nominal inventory, and patient `TAKEN`/`NOT_TAKEN` reports are persisted in Convex.

Adding another time to an existing medication is deferred. The future implementation should create another `medicationSchedules` row for the same medication and reuse its existing `compartmentAssignments` row; it must not create a second compartment assignment.

## M3 reminder and caregiver-alert demo

1. Sign in and confirm both Clerk and Convex show authenticated.
2. Ensure the synthetic **Iron Pills** assignment exists in **Slot 6**, daily at **09:00 America/Toronto**.
3. Open `/patient`. In **In-app reminders**, select **Simulate Overdue escalation**. This creates an explicit, audited synthetic time transition; no real wait is required.
4. Open `/caregiver`. The reactive **Caregiver alerts** panel shows an `OPEN` case with reason **No patient response**, linked reminder evidence, due time, and a human follow-up recommendation.
5. Enter a follow-up note and select **Acknowledge** or **Resolve case**. Confirm that the patient ingestion report and one-pill inventory are unchanged.
6. Return to `/patient` and select **Reset synthetic reminder scenarios** before repeating the demo. Records are closed and retained, not deleted.

Use **Simulate Device unresolved** to demonstrate the separate device-fault/disconnection classification. **Simulate Due reminder** and **Simulate Unanswered routine** remain inside the follow-up window and do not create an overdue caregiver case yet.

The five-minute Convex cron and authenticated page reconciliation keep seven-day occurrences and reminder states current. External notifications are not implemented; reminders appear only in the app. See `docs/REMINDERS_AND_CASES.md` for the state model and future agent payload.

## M4 local care coordinator

The `/caregiver` alert now provides **Investigate with AI** for open synthetic cases, and `/agent-activity` displays persistent run and tool activity. The deterministic alert does not depend on the worker.

Python setup, server-only credential configuration, the polling command, browser walkthrough, and live-Claude smoke-test procedure are documented in `docs/AGENT_COORDINATOR.md`. No worker secret or Anthropic key belongs in `.env.local` or a `NEXT_PUBLIC_` variable. The worker defaults to the supported `claude-sonnet-5-5` model and uses the explicitly labeled non-LLM fallback when `ANTHROPIC_API_KEY` is absent or Claude fails.

## M5 refill forecast demo

1. Sign in as the caregiver and create the synthetic **Iron Pills** medication in **Slot 6**, daily at **09:00 America/Toronto**, if it is not already present.
2. On `/caregiver`, find **Refill support · caregiver verified** and select **Run low-supply demo**. This temporarily records 2 synthetic supply units in a field separate from the one-pill hardware demo inventory.
3. The low-supply case appears immediately. Review the estimated days, confidence, uncertainty, and configured threshold (default 3 days).
4. Select **Mark reviewed**, then **Record refill requested**. This records workflow state only; it does not place an order or contact a pharmacy.
5. Enter the physically verified new count before selecting **Record refill received**. Receipt is never inferred or automated.
6. Optionally select **Investigate with AI**, start the existing Python worker, and inspect the `REFILL_INVESTIGATION` on `/agent-activity`.
7. Select **Reset demo**. The prior supply metadata is restored and medication, agent, case, and transition history is retained.

The forecast uses fixed local schedules and IANA timezones, including daylight-saving transitions. It conservatively assumes every scheduled dose consumes one supply unit. Unresolved missed-dose or ingestion evidence lowers confidence; it never increases the estimated count. Caregiver-entered supply is not a prescription, pharmacy record, camera result, or sensor-confirmed physical count.

## M6 Cartesia voice companion

Create an API key in Cartesia Playground and add it only to the existing ignored `.env.local`:

```text
CARTESIA_API_KEY=your_server_only_key
```

Optionally set `CARTESIA_VOICE_ID` to a tested Cartesia Playground voice. Never create `NEXT_PUBLIC_CARTESIA_API_KEY`. Restart `npm run dev` after changing `.env.local`. The complete architecture, three supported intents, safety boundary, text-only fallback, demo sequence, and future motion-trigger contract are documented in `docs/VOICE_COMPANION.md`.

## M7 Fetch.ai Agentverse and ASI:One

Install the isolated pinned uAgents environment, authorize one synthetic case in `/agent-activity`, connect the PillSense agent through Agentverse Inspector Mailbox, publish its official `AgentChatProtocol` manifest and profile, and verify the complete investigation in a real ASI:One conversation. The second uAgent is optional bonus orchestration. Follow `docs/AGENTVERSE.md`; no public tunnel, payment protocol, or second LLM path is used.

## H6B local camera observation

Use Python 3.11 and keep the camera bridge on loopback:

```powershell
py -3.11 -m venv vision\.venv
.\vision\.venv\Scripts\python.exe -m pip install -r vision\requirements.txt
.\vision\.venv\Scripts\python.exe -m vision.service
```

In separate terminals, run `npx convex dev` for the existing deployment and
`npm run dev`. Sign in at `http://localhost:3000/demo`, remain on **Today**, and
select **Start camera**. After camera permission is available, keep exactly one
person in view and bring a hand toward the mouth. The panel reports the genuine
observation and its time. In the Convex dashboard, inspect
`cameraObservationSessions` and `cameraObservationEvents`; the event must belong
to the authenticated synthetic patient's session and have source
`WINDOWS_OPENCV_MEDIAPIPE`.

Select **Stop camera**, confirm the panel reaches `STOPPED`, and confirm another
camera application can open the webcam. Do not start browser `getUserMedia` at
the same time. No raw frame is stored or uploaded, and an observation never
marks a dose taken or triggers Bluetooth movement. See `vision/README.md` for
configuration, privacy boundaries, standalone debugging, and focused tests.
