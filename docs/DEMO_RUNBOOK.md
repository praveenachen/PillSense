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

### Final CalHacks configuration

The baseline seeded by `demo:seed` is:

| Slot | Medication |
|---|---|
| 0 | HOME (reserved, never assigned) |
| 1 | Vitamin D |
| 2 | Ibuprofen (Advil 200 mg tablet, explicitly labeled synthetic) |
| 3 | Omega-3 |
| 4 | **Empty.** Tylenol is added live through the camera scan. |
| 5 | Magnesium |
| 6 | Iron Pills |
| 7 | Empty spare |

No Tylenol is ever seeded. Any Tylenol in the database came from an earlier camera scan saved through the app, which is why `demo:seed` will not touch it. Seeding is idempotent, never moves a medication into a different slot, and reports an occupied slot instead of overwriting it.

```powershell
npm.cmd run demo:seed                  # baseline; reports any occupied slot as slotConflicts
npm.cmd run demo:final-status          # compares the dispenser with the table above (read-only)
npm.cmd run demo:release-slot -- 4     # shows the slot, then asks you to type RELEASE SLOT 4
npm.cmd run demo:prepare-final         # seed, review Slots 4/7 and any conflict, re-seed, verify
npm.cmd run demo:status
```

`demo:release-slot` and `demo:prepare-final` first print the assignment that would be released, then require the exact phrase `RELEASE SLOT <n>`. A release deactivates that assignment and its medication/schedule, but keeps every row, so history stays intact. It works only on the synthetic demo patient's dispenser, refuses while a dispense for that slot is unsettled, and never sends a device command or changes inventory. Do not run `demo:scenario -- onboarding` before the final take: it deactivates every seeded medication (re-run `demo:seed` to restore them). The low-supply scenario also reacts to the baseline's intentionally low Magnesium (3 pills).

Expected output is a small JSON result with synthetic scenario IDs and safe states. Status never prints patient names, API keys, pharmacy URLs, camera frames, prescriptions, or callback tokens. Seed is idempotent. Reset archives active scenario records and closes demo state while retaining events, cases, investigations, and completed checkouts.

## Scenario A — medication companion

1. Run `npm.cmd run demo:scenario -- onboarding`.
2. Sign in as the configured caregiver at `http://localhost:3000/demo`.
3. Open **Dispenser**, choose an empty slot, and select **Scan with camera**. Display `/demo/synthetic-advil-label.svg` on another screen or print it; it is visibly synthetic and supplies no dosing schedule.
4. Capture the label through the existing Claude Vision scanner. Review/correct every extracted field. Explicitly enter instructions, timezone, time, weekdays, and the target slot before saving.
5. Confirm the saved medication appears in Today, Schedule, and Dispenser.
6. Alternatively, for the predictable voice-to-hardware due state, run `npm.cmd run demo:scenario -- successful-dose`. This creates an Iron Pills reminder for the fixed Slot 6 fixture; it does not send a device command.
7. Open **Voice** and press **Start scheduled conversation**. This user gesture arms Cartesia and avoids browser autoplay claims. Say **Yes, I'm ready**. If a browser/BLE preflight fails before command authorization, repeating the readiness response may resume that still-unattempted session; it cannot authorize a second command after an attempt exists.
8. Optionally enable the explicit local-camera consent checkbox. Open **Operator Hardware Lab**. In Camera, start one local observation and demonstrate a hand-near-mouth event. Stop and release the camera afterward. The gesture is observation evidence only.
9. For physical hardware, use Hardware Lab **Controls** and follow all empty-carousel/manual-home confirmations. Pair the Arduino, GET_STATUS, and arm the one supervised Slot 6 voice demo. Return through the in-app **Patient app** link; the readiness response dispatches at most one authorized `MOVE,6,<id>`, reconciles `GET_LAST_RESULT`, and still requires physical inspection of Slot 0.
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
