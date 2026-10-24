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
});
