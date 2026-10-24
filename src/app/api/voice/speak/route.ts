import { auth } from "@clerk/nextjs/server";
import { synthesizeWithCartesia } from "@/lib/voice/cartesia-client";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) return Response.json({ error: "CARTESIA_NOT_CONFIGURED" }, { status: 503 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return Response.json({ error: "INVALID_JSON" }, { status: 400 }); }
  const text = payload && typeof payload === "object" ? (payload as { text?: unknown }).text : null;
  if (typeof text !== "string" || !text.trim() || text.length > 500) return Response.json({ error: "INVALID_SPEECH_TEXT" }, { status: 400 });
  try {
    const audio = await synthesizeWithCartesia({ apiKey, text, voiceId: process.env.CARTESIA_VOICE_ID });
    return new Response(audio.body, { status: 200, headers: { "content-type": audio.headers.get("content-type") || "audio/wav", "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "SPEECH_GENERATION_FAILED" }, { status: 502 });
  }
}
