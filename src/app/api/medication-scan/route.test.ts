import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  query: vi.fn(),
  setAuth: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    setAuth = mocks.setAuth;
    query = mocks.query;
  },
}));

import { POST } from "./route";

// A real JPEG header (FF D8 FF E0) followed by padding, as a base64 data URL.
const jpegImage = `data:image/jpeg;base64,${btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1))}`;
const scanRequest = (image: string, extraHeaders: Record<string, string> = {}) => new Request("http://localhost:3000/api/medication-scan", {
  method: "POST", headers: { "content-type": "application/json", ...extraHeaders }, body: JSON.stringify({ image }),
});
const caregiverSession = (userId: string) => mocks.auth.mockResolvedValue({ userId, sessionClaims: { aud: "convex" }, getToken: vi.fn().mockResolvedValue("token") });

const imageRequest = () => new Request("http://localhost:3000/api/medication-scan", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ image: "invalid-image" }),
});

describe("medication scan access check", () => {
  const priorUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const priorKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.ANTHROPIC_API_KEY = "test-key";
    mocks.query.mockResolvedValue({ status: "ready" });
  });

  afterEach(() => {
    if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL;
    else process.env.NEXT_PUBLIC_CONVEX_URL = priorUrl;
    if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = priorKey;
  });

  it("accepts the Clerk Convex integration token", async () => {
    const getToken = vi.fn().mockResolvedValue("integration-token");
    mocks.auth.mockResolvedValue({ userId: "caregiver", sessionClaims: { aud: "convex" }, getToken });
    const response = await POST(imageRequest());
    expect(response.status).toBe(400);
    expect(getToken).toHaveBeenCalledWith({});
    expect(mocks.setAuth).toHaveBeenCalledWith("integration-token");
    expect(mocks.query).toHaveBeenCalledOnce();
  });

  it("accepts the JWT template token", async () => {
    const getToken = vi.fn().mockResolvedValue("template-token");
    mocks.auth.mockResolvedValue({ userId: "caregiver", sessionClaims: {}, getToken });
    const response = await POST(imageRequest());
    expect(response.status).toBe(400);
    expect(getToken).toHaveBeenCalledWith({ template: "convex" });
    expect(mocks.setAuth).toHaveBeenCalledWith("template-token");
  });

  it("rejects a non-caregiver even with a valid token", async () => {
    mocks.auth.mockResolvedValue({ userId: "patient", sessionClaims: { aud: "convex" }, getToken: vi.fn().mockResolvedValue("patient-token") });
    mocks.query.mockResolvedValue({ status: "unauthorized" });
    const response = await POST(imageRequest());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "CAREGIVER_ACCESS_REQUIRED" });
  });

  it("rejects unauthenticated requests before reading the image", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    const response = await POST(scanRequest(jpegImage));
    expect(response.status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("rejects an oversized upload from its declared length", async () => {
    caregiverSession("big");
    const response = await POST(scanRequest(jpegImage, { "content-length": "3500000" }));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "PAYLOAD_TOO_LARGE" });
  });

  it("rejects data that is not a JPEG even when it is labelled as one", async () => {
    caregiverSession("fake");
    const response = await POST(scanRequest(`data:image/jpeg;base64,${btoa("not a jpeg at all")}`));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "INVALID_IMAGE" });
  });

  it("rate limits repeated scans per user with a retry hint", async () => {
    caregiverSession("busy");
    const statuses: number[] = [];
    let last: Response | null = null;
    for (let i = 0; i < 8; i += 1) { last = await POST(scanRequest("invalid-image")); statuses.push(last.status); }
    expect(statuses.slice(0, 6).every((status) => status === 400)).toBe(true);
    expect(statuses.slice(6)).toEqual([429, 429]);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
    await expect(last!.json()).resolves.toEqual({ error: "RATE_LIMITED" });
  });

  it("never persists or logs the image: the only outbound call is the Anthropic request", async () => {
    caregiverSession("careful");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ content: [{ type: "text", text: "{\"brand\":\"Advil\"}" }] }));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = await POST(scanRequest(jpegImage));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.anthropic.com/v1/messages");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(log).not.toHaveBeenCalled();
    fetchMock.mockRestore(); log.mockRestore();
  });
});
