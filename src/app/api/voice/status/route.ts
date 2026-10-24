import { auth } from "@clerk/nextjs/server";
import { CARTESIA_STT_MODEL, CARTESIA_TTS_MODEL } from "@/lib/voice/cartesia-client";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  return Response.json({ configured: Boolean(process.env.CARTESIA_API_KEY), ttsModel: CARTESIA_TTS_MODEL, sttModel: CARTESIA_STT_MODEL });
}
