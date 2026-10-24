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

The Voice Companion supports exactly three deterministic intents:

1. `SCHEDULED_DOSE_ASSISTANCE` reads current authenticated occurrence state and points to visible mock controls. It never dispatches a command or calls Bluetooth.
2. `REPORT_TAKEN_OR_NOT_TAKEN` accepts only explicit language, selects one actual occurrence, then requires a second explicit confirmation before calling the existing `dispensing.reportIngestion` mutation.
3. `REPORT_DEVICE_PROBLEM` requires confirmation, then creates an idempotent patient-scoped issue containing the actual observed device state. It never fabricates a motor fault or retries a command.

Ambiguous statements, medical questions, refill ordering, and unsupported requests cause no mutation. Claude is not called by the voice layer.

## Demo

1. Sign in and open `/patient`.
2. In **Voice Companion**, select **Start 60-second voice demo**. This creates a labeled due demo occurrence without changing its schedule.
3. Listen to the Cartesia reminder while reading the synchronized caption.
4. Select **Push to Talk**, allow microphone access, say “I took my medication,” and select **Stop and transcribe**. The recording also stops automatically at ten seconds.
5. Review the transcript and interpreted action. Say “confirm” in a second Push-to-Talk session or select the visible **Confirm** button.
6. Observe the reactive patient-report update. No mock or real motor action occurs.

The same flow works without audio: use the text input and visible action buttons. If Cartesia or microphone access fails, captions, intent selection, confirmation, and Convex mutations remain available.

## Future motion wake trigger

`src/lib/voice/wake-trigger.ts` reserves a notification-only `VoiceWakeTrigger` interface. A future motion sensor may implement it to focus or open the Voice Companion. The interface exposes only a wake callback: it receives no dispenser adapter, command ID, medication state, Convex mutation, or BLE capability. Waking the UI must never count as action confirmation.
