import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { parseMedicationScan } from "../../../lib/medication-scan";
import { getConvexToken } from "../../../lib/convex-token";
import { createRateLimiter } from "../../../lib/rate-limit";

/** The camera sends one downscaled JPEG; anything larger than this is rejected before it is read. */
const MAX_BODY_BYTES = 3_000_000;
const MAX_IMAGE_CHARS = 2_800_000;
const JPEG_BASE64_PREFIX = "data:image/jpeg;base64,";
// Bounds a runaway client, not a global quota: state is per server instance.
const checkRate = createRateLimiter([{ limit: 6, windowMs: 60_000 }, { limit: 40, windowMs: 3_600_000 }]);

/** True when the decoded bytes start with the JPEG signature (FF D8 FF). */
function looksLikeJpeg(image: string) {
  try {
    const head = atob(image.slice(JPEG_BASE64_PREFIX.length, JPEG_BASE64_PREFIX.length + 8));
    return head.charCodeAt(0) === 0xff && head.charCodeAt(1) === 0xd8 && head.charCodeAt(2) === 0xff;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  let session: Awaited<ReturnType<typeof auth>>;
  try {
    session = await auth();
  } catch {
    return Response.json({ error: "AUTHENTICATION_UNAVAILABLE" }, { status: 503 });
  }
  if (!session.userId) return Response.json({ error: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  const rate = checkRate(session.userId);
  if (!rate.allowed) {
    return Response.json({ error: "RATE_LIMITED" }, { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds), "cache-control": "no-store" } });
  }
  const token = await getConvexToken((options) => session.getToken(options), session.sessionClaims);
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!token) return Response.json({ error: "CONVEX_TOKEN_UNAVAILABLE" }, { status: 503 });
  if (!convexUrl) return Response.json({ error: "CAREGIVER_ACCESS_UNAVAILABLE" }, { status: 503 });
  try {
    const client = new ConvexHttpClient(convexUrl);
    client.setAuth(token);
    const setup = await client.query(api.caregiver.setup, {});
    if (setup.status !== "ready") return Response.json({ error: "CAREGIVER_ACCESS_REQUIRED" }, { status: 403 });
  } catch {
    return Response.json({ error: "CONVEX_ACCESS_CHECK_FAILED" }, { status: 503 });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: "CLAUDE_NOT_CONFIGURED" }, { status: 503 });
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    body = JSON.parse(text);
  } catch { return Response.json({ error: "INVALID_IMAGE" }, { status: 400 }); }
  const image = body && typeof body === "object" ? (body as Record<string, unknown>).image : null;
  if (typeof image !== "string" || image.length > MAX_IMAGE_CHARS || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image) || !looksLikeJpeg(image)) {
    return Response.json({ error: "INVALID_IMAGE" }, { status: 400 });
  }
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_VISION_MODEL || "claude-sonnet-5-5",
        max_tokens: 450,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.slice(JPEG_BASE64_PREFIX.length) } },
          { type: "text", text: "Read only text clearly visible on this medication package. Return exactly one JSON object with keys brand, activeIngredient, strength, dosageForm, din, ndc, quantity, otherVisibleDetails. Use null for every unreadable or absent field. OtherVisibleDetails must be an array of at most 8 short visible facts. Do not infer directions, dose frequency, package quantity, DIN, NDC, or drug identity from prior knowledge. No Markdown." },
        ] }],
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!response.ok) return Response.json({ error: response.status === 429 ? "CLAUDE_RATE_LIMITED" : "CLAUDE_API_ERROR" }, { status: response.status === 429 ? 429 : 502 });
    const payload: unknown = await response.json();
    const content = payload && typeof payload === "object" ? (payload as { content?: unknown }).content : null;
    const text = Array.isArray(content) ? content.find((item) => item && typeof item === "object" && item.type === "text")?.text : null;
    if (typeof text !== "string") throw new Error("INVALID_SCAN_RESPONSE");
    const scan = parseMedicationScan(JSON.parse(text));
    return Response.json({ scan }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "SCAN_FAILED" }, { status: 502 });
  }
}
