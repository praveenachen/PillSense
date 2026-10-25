# PillSense H6C demo runbook

This runbook prepares three repeatable **synthetic** CalHacks stories. It never sends a BLE motor command, starts a camera, calls Walgreens, or deletes audit history. Run it only against the existing Convex development deployment.

## One-time development configuration

Use the `tokenIdentifier` of the signed-in Clerk caregiver that owns the synthetic patient relationship. This is an authorization identifier, not a Clerk secret. Set the same exact value locally and in the existing Convex development environment; do not paste API keys into either command.

```powershell
Set-Location C:\Users\ishan\Documents\pillsense
npx.cmd convex env set PILLSENSE_DEMO_ENVIRONMENT development
npx.cmd convex env set PILLSENSE_DEMO_OPERATOR_TOKEN_IDENTIFIER "<exact-caregiver-tokenIdentifier>"
```

Add matching names to the ignored `.env.local` without overwriting its existing values:

```text
PILLSENSE_DEMO_ENVIRONMENT=development
PILLSENSE_DEMO_OPERATOR_TOKEN_IDENTIFIER=<exact-caregiver-tokenIdentifier>
```

The CLI refuses `prod:` deployments. Convex independently checks the development flag, authenticated identity, caregiver role, and synthetic patient scope. A hidden route is not the authorization boundary.

## Start the stack on Windows

Use separate PowerShell terminals from the repository root:

```powershell
# Terminal 1 — existing Convex development deployment
npx.cmd convex dev

# Terminal 2 — web app
npm.cmd run dev

# Terminal 3 — central care coordinator (live Claude when configured;
# otherwise explicitly labeled NON_LLM_FALLBACK)
.\agent\.venv\Scripts\python.exe -m agent.coordinator

# Terminal 4 — local-only OpenCV/MediaPipe bridge, when camera is demonstrated
.\vision\.venv\Scripts\python.exe -m vision.service
```

Cartesia and the medication-label scanner use server-only keys from the existing ignored `.env.local`. The coordinator uses `.env.agent`. No key belongs in a `NEXT_PUBLIC_` variable. Chrome must allow audio playback and microphone access. The camera is owned only by the Python service; do not also open it with browser `getUserMedia`.

## CLI commands

```powershell
npm.cmd run demo:seed
npm.cmd run demo:status
npm.cmd run demo:reset                  # type RESET when prompted
npm.cmd run demo:scenario -- onboarding
npm.cmd run demo:scenario -- successful-dose
npm.cmd run demo:scenario -- missed-dose
npm.cmd run demo:advance-missed-dose
npm.cmd run demo:scenario -- low-supply
```

Expected output is a small JSON result with synthetic scenario IDs and safe states. Status never prints patient names, API keys, pharmacy URLs, camera frames, prescriptions, or callback tokens. Seed is idempotent. Reset archives active scenario records and closes demo state while retaining events, cases, investigations, and completed checkouts.

## Scenario A — medication companion

1. Run `npm.cmd run demo:scenario -- onboarding`.
2. Sign in as the configured caregiver at `http://localhost:3000/demo`.
3. Open **Dispenser**, choose an empty slot, and select **Scan with camera**. Display `/demo/synthetic-advil-label.svg` on another screen or print it; it is visibly synthetic and supplies no dosing schedule.
4. Capture the label through the existing Claude Vision scanner. Review/correct every extracted field. Explicitly enter instructions, timezone, time, weekdays, and Slot 6 before saving.
5. Confirm the saved medication appears in Today, Schedule, and Dispenser.
6. Alternatively, for a predictable due state, run `npm.cmd run demo:scenario -- successful-dose`.
7. Open **Voice** and press **Start scheduled conversation**. This user gesture arms Cartesia and avoids browser autoplay claims. Say **Yes**, **Yes please**, then **Yes**. The reviewed Advil/ibuprofen education is sourced from MedlinePlus and is general information, not individualized advice.
8. Optionally enable the explicit local-camera consent checkbox. Open **Operator Hardware Lab**. In Camera, start one local observation and demonstrate a hand-near-mouth event. Stop and release the camera afterward. The gesture is observation evidence only.
9. For physical hardware, use Hardware Lab **Controls** and follow all empty-carousel/manual-home confirmations. Pair the Arduino, GET_STATUS, dispatch the one supervised Slot 6 test, reconcile GET_LAST_RESULT, and physically inspect Slot 0. Voice never dispatches the motor.
10. Return to Voice and select **I took my medication**, then confirm. This is a patient report, separate from motor completion and camera evidence.

If Cartesia, microphone, camera, or BLE is unavailable, use the visible text/touch fallback. Do not fabricate success.

## Scenario B — proactive refill

1. Run `npm.cmd run demo:scenario -- low-supply`.
2. Keep the coordinator worker running. The eligible synthetic low-supply case automatically queues one version-scoped investigation. If Claude is unavailable, the bounded fallback is labeled `NON_LLM_FALLBACK`.
3. Open **Care**, expand **Refill status**, and watch the investigation update reactively.
4. Inspect estimated count, days remaining, confidence, uncertainty, and findings. Optionally enter a caregiver-verified count.
5. Select **Mark reviewed**, then **Record refill requested**.
6. Select **Approve and prepare checkout**. This is the separate human authorization gate. Mock mode is local simulation; sandbox mode calls Walgreens QA only. A failed sandbox request is shown as failed and is never silently replaced with mock.
7. Open a returned hosted link only when status is `CHECKOUT_READY`. A callback/return is unverified and never changes inventory. Record physical receipt separately in the full caregiver workflow only after real caregiver verification.

## Scenario C — missed-dose protection

1. Run `npm.cmd run demo:scenario -- missed-dose`.
2. Confirm the due reminder appears; do not respond.
3. Run `npm.cmd run demo:advance-missed-dose`. This applies a clearly labeled six-minute synthetic timestamp to normal reminder reconciliation. It does not alter the system clock or schedule.
4. Open **Care**. The deterministic alert exists independently of AI. The coordinator run is automatically queued and updates from `PENDING` to `RUNNING` to `COMPLETED` when the worker is available.
5. Review the actual findings, document caregiver follow-up, and acknowledge/resolve separately. Never infer ingestion and never issue a late automatic dispense.

The same advance is available under Hardware Lab → Diagnostics → **Synthetic reminder scenarios** only when the signed-in operator also matches the configured demo CLI identifier.

## Evidence and recovery

The dark Care Activity tab combines only persisted, authorization-scoped evidence. Each entry identifies real versus synthetic source and keeps camera, motor, patient report, agent, and refill evidence distinct.

Before repeating:

```powershell
npm.cmd run demo:reset
npm.cmd run demo:seed
npm.cmd run demo:status
```

If a Python camera service restarted, use Hardware Lab’s **Stop previous session** reconciliation before starting a fresh session. If BLE outcome is uncertain, query GET_LAST_RESULT read-only; never resend MOVE automatically. Rebooting hardware is not a recovery procedure for an uncertain medication dispense.

## Truthful integration labels

- Clerk/Convex data transitions are real and persisted on the configured development deployment.
- Cartesia audio, Claude Vision, live Claude coordinator, Walgreens QA, Agentverse, camera, and Arduino are real only when their existing services/credentials/hardware are running and the UI reports success.
- CLI scenarios, fixture labels, demo patients, demo inventory, mock Walgreens checkout, and simulated time are synthetic.
- Motor `DONE` means the firmware’s step sequence completed. It does not prove position, release, collection, or ingestion.
- Hand-near-mouth means only that the local detector observed the configured gesture. It does not prove ingestion.
