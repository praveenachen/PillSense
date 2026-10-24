export const CARTESIA_VERSION = "2026-08-14";
export const CARTESIA_TTS_MODEL = "sonic-3.6";
export const CARTESIA_STT_MODEL = "ink-whisper";
export const DEFAULT_CARTESIA_VOICE_ID = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4";

type Fetcher = typeof fetch;

export async function synthesizeWithCartesia(args: { apiKey: string; text: string; voiceId?: string; fetcher?: Fetcher }) {
  if (!args.apiKey) throw new Error("CARTESIA_NOT_CONFIGURED");
  const text = args.text.trim();
  if (!text || text.length > 500) throw new Error("INVALID_SPEECH_TEXT");
  const response = await (args.fetcher ?? fetch)("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: { Authorization: `Bearer ${args.apiKey}`, "Cartesia-Version": CARTESIA_VERSION, "Content-Type": "application/json" },
    body: JSON.stringify({ model_id: CARTESIA_TTS_MODEL, transcript: text, voice: args.voiceId || DEFAULT_CARTESIA_VOICE_ID, language: "en", output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 44100 } }),
  });
  if (!response.ok) throw new Error(`CARTESIA_TTS_${response.status}`);
  return response;
}

export async function transcribeWithCartesia(args: { apiKey: string; audio: Blob; filename: string; fetcher?: Fetcher }) {
  if (!args.apiKey) throw new Error("CARTESIA_NOT_CONFIGURED");
  if (args.audio.size < 1 || args.audio.size > 2_500_000) throw new Error("INVALID_AUDIO_SIZE");
  const form = new FormData();
  form.append("file", args.audio, args.filename);
  form.append("model", CARTESIA_STT_MODEL);
  form.append("language", "en");
  const response = await (args.fetcher ?? fetch)("https://api.cartesia.ai/stt", {
    method: "POST",
    headers: { Authorization: `Bearer ${args.apiKey}`, "Cartesia-Version": CARTESIA_VERSION },
    body: form,
  });
  if (!response.ok) throw new Error(`CARTESIA_STT_${response.status}`);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || typeof (payload as { text?: unknown }).text !== "string") throw new Error("INVALID_TRANSCRIPTION_RESPONSE");
  return (payload as { text: string }).text.trim();
}
