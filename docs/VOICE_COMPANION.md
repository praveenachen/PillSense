# PillSense M6 voice companion

The Voice Companion is an accessibility layer over existing authenticated PillSense state. Cartesia produces speech and transcription; it does not decide or persist medication actions. Convex remains the authority for dose occurrences, patient reports, device issues, reminders, and caregiver access.

## Cartesia APIs

- Text-to-speech: `POST https://api.cartesia.ai/tts/bytes`, model `sonic-3.6`, English WAV at 44.1 kHz.
- Short-audio speech-to-text: `POST https://api.cartesia.ai/stt`, model `ink-whisper`, English WebM upload.
- API version: `2026-08-14`.
- Default voice: Cartesia's documented example voice `db6b0ed5-d5d3-463d-ae85-518a07d3c2b4`. Set `CARTESIA_VOICE_ID` server-side to use another voice selected and tested in Cartesia Playground.

Cartesia documents `ink-2` as its current stable realtime streaming model. M6 deliberately uses the supported `ink-whisper` batch endpoint for recordings capped at ten seconds. This avoids a long-lived browser WebSocket and is more reliable for a hackathon demonstration. The browser sends audio only to the authenticated PillSense route handler; PillSense does not persist the raw recording.

The current API references are:

- https://docs.cartesia.ai/api-reference/tts/bytes
- https://docs.cartesia.ai/api-reference/stt/transcribe
- https://docs.cartesia.ai/build-with-cartesia/stt/latest
- https://docs.cartesia.ai/get-started/authenticate-your-client-applications

## Security boundary

`CARTESIA_API_KEY` is read only inside Next.js route handlers. Every voice endpoint calls Clerk `auth()` and returns HTTP 401 without an authenticated session. The browser never receives the key or a long-lived Cartesia credential. Audio and speech responses use `no-store` semantics.

The Voice Companion supports deterministic, server-validated intents:

1. `SCHEDULED_DOSE_ASSISTANCE` reads current authenticated occurrence state. A structured voice readiness response can dispatch the fixed Slot 6 Arduino demo only when the current browser BLE connection was explicitly armed in Hardware Lab first.
2. `REPORT_TAKEN_OR_NOT_TAKEN` accepts only explicit language, selects one actual occurrence, then requires a second explicit confirmation before calling the existing `dispensing.reportIngestion` mutation.
3. `REPORT_DEVICE_PROBLEM` requires confirmation, then creates an idempotent patient-scoped issue containing the actual observed device state. It never fabricates a motor fault or retries a command.

Ambiguous statements, medical questions, refill ordering, and unsupported requests cause no mutation. Claude is not called by the voice layer.

### Development-only voice hardware gate

Voice-to-hardware is available only when Convex is configured for development, the signed-in caregiver exactly matches the configured demo operator, the caregiver has an active relationship to the synthetic patient, and the shared Bluetooth gateway observed `READY`. The operator must complete the physical safety confirmations in dispenser settings (or Hardware Lab) and explicitly arm that exact browser connection for ten minutes before the voice interaction. The due reminder must resolve to the active Slot 6 assignment with no prior command. The main Dispenser screen uses its existing Pair / Ready / Loaded steps; Loaded reflects saved positive inventory counts, not a physical sensor.

The arm is consumed before `MOVE` is written. The shared root gateway owns the only Web Bluetooth transport and the firmware one-MOVE lock. Refresh, duplicate speech, `UNKNOWN`, disconnect, rejection, and mismatched IDs never cause an automatic resend; only `GET_LAST_RESULT` reconciliation is allowed.

Browser-observed outcomes are persisted with `trustedHardwareEvidence=false`. `DONE` means only that the programmed step sequence completed. It does not prove physical alignment, pill release, collection, or ingestion and does not decrement synthetic inventory. Seeded inventory counts do not gate this positioning demo or establish what is physically loaded. The operator must confirm an empty carousel or inert demo props only, with no real medications. Patient-reported `TAKEN` remains separate. If camera consent was granted, the existing local OpenCV control appears only after motor completion.

## Demo

1. Use the synthetic Slot 6 due-reminder scenario on the existing development deployment.
2. In desktop Chrome, open `/demo` → **Dispenser**, select **Pair Arduino**, and require firmware `READY` in the real Arduino card.
3. With an empty carousel or inert props only, manually align Slot 0, clear the mechanism, then open the Dispenser gear, check all three confirmations, and select **Arm Slot 6 voice demo**. Hardware Lab's separate manual test remains empty-carousel only.
4. On **Home**, tap the due medication reminder. This selects that exact occurrence, opens Voice, and speaks its current question without a second Start button. Synthetic demo greetings use “Hello Praveena!”; real accounts retain their patient name. Reopening resumes the persisted question and does not reset or repeat a hardware attempt.
5. After each spoken question, the microphone opens automatically (Chrome permission is still required), records for at most ten seconds, then transcribes. Tap the recording button to submit sooner, or End to cancel. Leaving Voice stops playback and recording, releases tracks, and ignores late audio/transcription results. Say “Yes, I’m ready.” The synthetic Iron Pills demo offers MedlinePlus side-effect education before movement; answer yes to hear it, then yes to continue. Answering no to the education offer skips education and asks whether to continue. **Reminder options → Hear side-effect information** also works on an existing session without reopening a completed hardware attempt.
6. Observe **Preparing dispenser**, **Physical movement in progress**, and then the actual correlated completion or uncertain state. No second motor click is required.
7. If camera consent was selected, optionally start and stop the local observation shown after completion.
8. Use **I took my medication** only as a separate patient report; motor or camera results never set ingestion.

Text and touch remain available for non-hardware features. The automatic hardware handoff specifically requires a structured `VOICE` readiness event, an active arm, and the same live BLE connection.

## Future motion wake trigger

`src/lib/voice/wake-trigger.ts` reserves a notification-only `VoiceWakeTrigger` interface. A future motion sensor may implement it to focus or open the Voice Companion. The interface exposes only a wake callback: it receives no dispenser adapter, command ID, medication state, Convex mutation, or BLE capability. Waking the UI must never count as action confirmation.
