# PillSense device protocol (PROPOSED)

Status: **PROPOSED for firmware coordination.** The status exchange and narrow Slot 6 supervised movement exchange below have been verified with the current Arduino Uno R4 WiFi sketch. UUIDs and UTF-8 messages remain provisional; framing, versioning, timeouts, and any broader motor protocol require firmware coordination.

## Verified provisional BLE status exchange

The application centralizes these values in `src/lib/dispenser/ble-protocol.ts`:

| Field | Provisional value |
| --- | --- |
| Advertised device name | `PillSense` |
| Service UUID | `19b10000-e8f2-537e-4f6c-d104768a1214` |
| Command characteristic | `19b10001-e8f2-537e-4f6c-d104768a1214` |
| Status characteristic | `19b10002-e8f2-537e-4f6c-d104768a1214` |
| Status command | UTF-8 `GET_STATUS` |
| Status responses observed across test sketches | UTF-8 `CALIBRATION_REQUIRED` or `READY` |

The command characteristic supports writes, and the shared status characteristic supports reads and notifications. The browser transport enables notifications before issuing commands, because a later state such as `READY` can replace a transient command response in the characteristic's current value. It also retains direct reads as a fallback.

The response is never treated as trusted motor evidence. In particular, `READY` or `CALIBRATION_REQUIRED` does not independently prove that the mechanism is physically at position 0. The development-only voice demo may persist a sanitized browser observation with `trustedHardwareEvidence=false` for session continuity and auditability.

## H3 supervised Slot 6 movement

The manual real-hardware panel remains a local supervised test path. Separately, the development-only voice demo can bind one authorized synthetic Slot 6 reminder to the same browser BLE gateway after an operator arms it. Claude, Fetch.ai, schedules, camera observations, and free-form responses cannot directly create motor commands.

### Development-only voice handoff

The operator must pair the Arduino, read `READY`, complete the empty/inert-carousel, manual-home, and clear-mechanism confirmations, then explicitly arm the current browser connection. The short-lived arm is stored server-side for the authorized synthetic patient and consumed before the browser writes `MOVE,6,<id>`.

The backend derives Slot 6 from the active reminder assignment; speech and the browser cannot provide an arbitrary target slot. It creates one compact operation ID, rejects prior attempts, and persists dispatch before the BLE write. A refresh, duplicate readiness response, disconnect, or `UNKNOWN` result cannot send another `MOVE`; only `GET_LAST_RESULT` reconciliation is permitted.

Correlated `STARTED` and `DONE` responses update the persistent medication interaction session. They remain browser-observed, unauthenticated hardware evidence. `DONE` does not verify Slot 0 alignment, pill release, collection, or ingestion. The voice demo does not decrement inventory, and patient-reported ingestion remains separate.

| Direction | UTF-8 message | Meaning |
| --- | --- | --- |
| Browser to Arduino | `MOVE,6,<operationId>` | Run the fixed Slot `0 -> 6 -> 0` step sequence once. |
| Arduino to browser | `STARTED,<operationId>` | The firmware reports that the sequence started. |
| Arduino to browser | `DONE,<operationId>` | The programmed motor steps completed. This does not verify physical position. |
| Arduino to browser | `UNKNOWN,<operationId>` | The firmware/browser cannot establish a terminal outcome. Do not resend. |
| Browser to Arduino | `GET_LAST_RESULT` | Read-only reconciliation; it never requests movement. |

The current firmware drives the 28BYJ-48 through the ULN2003 on Arduino pins **D8-D11** and permits only one motor operation per boot. The browser creates a 1-12 character alphanumeric operation ID, canonicalizes it to uppercase to match the firmware, sends only Slot 6, correlates `STARTED`, `DONE`, and `UNKNOWN` case-insensitively through that canonical ID, and locks MOVE for the rest of the page session as soon as dispatch begins. A successful GATT write is not motor completion. A disconnect, invalid response, or mismatched operation ID is an uncertain outcome and must never trigger an automatic retry.

Because `Stepper.step()` blocks firmware command processing during movement, a `GET_LAST_RESULT` write can complete or be processed later than an ordinary status request. One explicit browser reconciliation action may therefore issue up to three bounded, read-only `GET_LAST_RESULT` queries while watching notifications and direct reads. A stale `READY` or matching `STARTED` is never treated as completion. Only `DONE,<operationId>` with the canonical matching ID enables the completed state. The user may explicitly query again if no correlated terminal result is available; the browser never resends `MOVE`.

`DONE` means only that the programmed step sequence completed. It is not evidence that Slot 0 was reached, because the mechanism has no physical-position sensor. The supervising person must inspect and acknowledge Slot 0 afterward. It is also not evidence of pill release, collection, or ingestion.

### Supervised browser test

1. Remove every pill and medication from the carousel. Inspect the mechanism, manually align it to Slot 0, make sure moving parts are clear, and only then power the Arduino running the already-verified combined BLE + Stepper sketch. Confirm it advertises as `PillSense`.
2. Open PillSense from `http://localhost:3000/patient` in Windows desktop Chrome. Web Bluetooth requires a supported browser and a secure context; localhost qualifies.
3. In **REAL ARDUINO · SUPERVISED HARDWARE TEST**, select **Connect to Arduino** and choose `PillSense` in Chrome's device picker.
4. Confirm the indicator changes to **Connected**.
5. Select **Get device status**. Confirm **Last Arduino response** shows `READY`. Do not interpret this as sensor-verified alignment.
6. Check all three confirmations: the carousel is empty, it was physically aligned to Slot 0 before startup, and moving parts are clear.
7. Select **Run Slot 6 Motor Test** once. Confirm the button immediately remains disabled and observe the physical `0 -> 6 -> 0` motion from a safe distance.
8. After physical movement stops, select **Get last result**. Confirm the response is `DONE,<operationId>` with the same operation ID shown by the panel (firmware and browser display it in uppercase). This action performs only bounded read-only reconciliation and is safe to use again or after reconnect. `READY` is not completion.
9. Physically inspect Slot 0 and only then check the final manual-verification acknowledgment. `DONE` alone is insufficient.
10. Power off the Arduino and confirm the UI changes to **Disconnected** without creating a Convex event. Continue to use **MOCK DEVICE · SIMULATED DISPENSING** for every dispensing demonstration.

### Starting a separate supervised test

Only begin a separate test after the prior outcome is reconciled, the device is powered off, the empty carousel and mechanism are physically reinspected, Slot 0 is manually realigned, and the firmware/device is intentionally reinitialized. Then load a fresh page session and repeat every confirmation. Reloading or rebooting is **not** a recovery strategy for an uncertain medication dispense; this procedure applies only to this empty-carousel hardware test. If the prior outcome remains uncertain, stop and investigate rather than attempting another movement.

## H6A verified physical LED checkpoint

The source-of-truth sketch is `firmware/PillSense_BLE_Motor_Test/PillSense_BLE_Motor_Test.ino`. It adds three physical status indicators without changing the verified BLE command protocol or motor sequence:

- **Red on D2:** the device is powered and idle/not in use.
- **Yellow on D3:** an accepted motor sequence is active, including outbound movement, the target pause, and return movement.
- **Green on D4:** the complete commanded step sequence finished, including the return steps.

The user physically verified H6A with an empty carousel: the supervised Slot 6 test moved from Slot 0 to Slot 6 and back to Slot 0, the LEDs followed the red/yellow/green sequence above, and the application received the matching BLE completion result. This records the user's physical test; Codex did not upload or operate the hardware.

Green is not sensor evidence. The carousel still has no position sensor, so sequence completion does not independently verify physical Slot 0 alignment, pill release, collection, or ingestion. The operator must continue to align and inspect Slot 0 manually. The LED state is not persisted as trusted Convex evidence and does not enable automatic medication dispensing.

## Physical positions

- Position `0` is reserved exclusively for manual home alignment. It is never a medication slot and must never be accepted by `DISPENSE`.
- Positions `1` through `7` are medication slots (`SlotId`).
- The hackathon MVP assumes one inert test pill in each physical slot.

## Device states

| State | Meaning |
| --- | --- |
| `DISCONNECTED` | No usable transport session. |
| `CALIBRATION_REQUIRED` | Connected, but a person must manually align position 0 and confirm it. |
| `READY` | Home alignment is confirmed and the device may accept a dispense command. |
| `DISPENSING` | One motor operation is in progress. |
| `FAULT` | Operation is blocked pending recovery or operator review. |

Power-up, reconnect, reset, and fault recovery should require manual home alignment before returning to `READY`.

## High-level commands

- `GET_STATUS`: return current state, connectivity, alignment, active command ID, and fault code.
- `MOVE,6,<operationId>`: current H3-only, empty-carousel supervised sequence from Slot 0 to Slot 6 and back to Slot 0. No other slot is exposed by the browser UI.
- `CONFIRM_HOME_ALIGNED`: operator confirms that the mechanism is physically at position 0; transition from `CALIBRATION_REQUIRED` to `READY` when safe.
- `DISPENSE(commandId, slotId)`: attempt one motor operation for a slot from 1 through 7.
- `GET_LAST_RESULT`: return the last command result, if one exists. The current H3 firmware stores it only in RAM; durable storage remains proposed future work.

## Command identity and duplicate handling

Every future `DISPENSE` carries a non-empty, stable `commandId` generated by the coordinator. The same logical request must reuse the same ID across reconnects. Production firmware should durably remember enough recent IDs and results to suppress duplicates. The current H3 sketch instead enforces one motor operation per boot and retains its last operation ID only in RAM.

For any already-seen `commandId`, return the recorded result and **do not operate the motor again**. A reused ID with different parameters is a protocol error. An ambiguous result must not be retried under the same or a newly generated ID without operator reconciliation.

## Acknowledgments and results

An acknowledgment only confirms command receipt; it is not evidence of motor completion. A terminal result is one of:

- `COMPLETED`: the motor operation completed as commanded.
- `REJECTED`: no motor operation began (for example invalid slot, calibration required, busy, or faulted).
- `UNKNOWN`: the coordinator cannot determine whether the motor operated, commonly after a timeout or disconnect.

Results should echo `commandId` and `slotId`, include the device state/fault detail, and distinguish these facts:

1. motor completion;
2. physical pill release;
3. pill collection by a person;
4. ingestion.

For M2, motor completion does **not** prove release, collection, or ingestion. Those fields remain `UNKNOWN` unless future sensors or user confirmation provide direct evidence. A patient `TAKEN` or `NOT_TAKEN` report is stored separately and never rewrites motor evidence.

## M2 mock event mapping

The browser-only mock gateway emits coordinator events named `COMMAND_ACCEPTED`, `MOTOR_STARTED`, `MOTOR_COMPLETED`, `UNKNOWN`, `FAULT`, and `DISCONNECTED`. Convex persists a unique `eventId` and deduplicates it transactionally. `MOTOR_COMPLETED` decrements nominal demo inventory exactly once; `UNKNOWN`, `FAULT`, or `DISCONNECTED` preserves an ambiguous command and blocks automatic retry.

These event names and the coordinator-only command states `AUTHORIZED` and `DISPATCHED` are **not yet a final firmware wire protocol**. The real device must still negotiate acknowledgments, durable replay behavior, timeouts, and encoding with the firmware teammate. The browser mock is not treated as a trusted physical device identity.

## Recovery rules

1. On disconnect during a command, record/report `UNKNOWN`; never automatically resend `DISPENSE`.
2. Query status and last result after reconnect using the same command ID for reconciliation only.
3. Enter `FAULT` for an ambiguous motor result and require operator review.
4. After reset, position uncertainty, or a cleared fault, return to `CALIBRATION_REQUIRED`.
5. Reject slot `0` and all values outside `1..7` without moving the motor.

## Items to coordinate with firmware

- Final BLE service/characteristic UUID assignment and protocol versioning.
- Encoding (JSON, CBOR, or binary), framing, checksums, and maximum frame size.
- Persistence window for command IDs/results.
- Exact acknowledgment, timeout, fault, and version-negotiation fields.
- Whether sensors can directly confirm release or collection.
