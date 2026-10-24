# PillSense M3 reminders and care cases

Status: implemented for the authenticated hackathon prototype. Reminder transitions are deterministic backend logic; no LLM, Python coordinator, external notification service, or autonomous dispensing is involved.

## Reminder lifecycle

`doseOccurrences` remains the source schedule occurrence. Its `reminderState` is deliberately independent from `attemptStatus` and the motor result:

- `UPCOMING`: inside the configured lead window but before the fixed local due time.
- `DUE`: at or after the due time and still inside the follow-up window.
- `OVERDUE`: the follow-up window passed without a direct `TAKEN` report.
- `RESOLVED`: the patient reported `TAKEN`, the schedule occurrence became stale, or an authorized synthetic reset closed the demo occurrence.

The default windows are 60 minutes upcoming and 15 minutes follow-up. Authorized users may configure bounded synthetic-patient windows (1–120 and 1–60 minutes respectively). A five-minute Convex cron keeps seven-day occurrences populated and reconciles reminders. The patient screen also requests an authenticated reconciliation when opened and once per minute while it remains open.

Each state transition writes one `reminderEvents` record keyed by occurrence and state. Repeated checks are idempotent.

## Unresolved classification

Once an occurrence becomes overdue, one versioned `careCases` record is maintained for that occurrence. The deterministic trigger is one of:

- `NO_PATIENT_RESPONSE`
- `MOTOR_COMPLETED_INGESTION_UNCONFIRMED`
- `MOTOR_OUTCOME_UNKNOWN`
- `PATIENT_REPORTED_NOT_TAKEN`
- `DEVICE_FAULT_OR_DISCONNECTED`

`TAKEN` resolves the reminder. Motor completion never sets or implies `TAKEN`; physical release and collection remain unknown. PillSense does not recommend a catch-up dose and never retries an ambiguous command automatically.

The case evidence fingerprint prevents duplicate alerts and increments `caseVersion` only when relevant evidence changes. Caregiver acknowledgments and resolutions append `careCaseTransitions`. They do not modify the patient report, motor evidence, or compartment inventory.

## Agent-ready contract

`internal.careCases.agentPayload` is an internal-only query for a future trusted M4 coordinator. It returns:

- `caseId`
- `patientScope.patientId`
- `occurrenceId`
- `caseVersion`
- `triggerReason`
- `evidenceReferences` (command, reminder events, device events, patient report, and optional demo run)
- `investigationStatus`

An M4 Python action can receive a care-case document ID from a trusted server-side dispatch, load this payload, and write a separately modeled investigation result only if the case version is still current. M3 exposes no HTTP agent endpoint and performs no model call.

## Synthetic demo controls

The patient screen offers four clearly labeled scenarios: due reminder, unanswered routine, overdue escalation, and device unresolved. Each creates a `demoScenarioRuns` audit record and a new synthetic occurrence. The server chooses the simulated timestamps from the bounded follow-up setting; the browser cannot submit arbitrary authorization times.

Reset marks active synthetic runs as `RESET`, resolves their reminder/case state, and appends audit transitions. It never deletes occurrences, cases, or real records. Reminder scenarios do not dispense or reload the physical compartment; Slot 6 still represents one inert pill until a person physically reloads it.
