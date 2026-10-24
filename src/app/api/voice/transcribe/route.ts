import { auth } from "@clerk/nextjs/server";
import { transcribeWithCartesia } from "@/lib/voice/cartesia-client";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) return Response.json({ error: "CARTESIA_NOT_CONFIGURED" }, { status: 503 });
  let form: FormData;
  try { form = await request.formData(); } catch { return Response.json({ error: "INVALID_AUDIO_UPLOAD" }, { status: 400 }); }
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size < 1 || audio.size > 2_500_000) return Response.json({ error: "INVALID_AUDIO_SIZE" }, { status: 400 });
  try {
    const text = await transcribeWithCartesia({ apiKey, audio, filename: audio instanceof File ? audio.name : "voice.webm" });
    return Response.json({ text }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "TRANSCRIPTION_FAILED" }, { status: 502 });
  }
}
