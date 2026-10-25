import { describe, expect, it, vi } from "vitest";
import { obtainRefillLandingUrl, validateCallbackBase, validateLandingUrl, WALGREENS_SANDBOX_ENDPOINT } from "./walgreensAdapter";

const callbackUrl = "https://demo.convex.site/walgreens/refill/callback/opaque";

describe("Walgreens sandbox adapter", () => {
  it("uses the documented sandbox request and lowercase apikey", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ landingUrl: "https://rx.walgreens.com/checkout?token=abc" }), { status: 200 }));
    const landingUrl = await obtainRefillLandingUrl({
      mode: "SANDBOX", apiKey: "test-key", affiliateId: "test-affiliate",
      callbackUrl, rxNumber: "0459772-59382", fetcher,
    });
    expect(landingUrl).toBe("https://rx.walgreens.com/checkout?token=abc");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(WALGREENS_SANDBOX_ENDPOINT);
    expect(JSON.parse(String(init.body))).toEqual({
      apikey: "test-key", affId: "test-affiliate", transaction: "refill",
      rxNumber: "0459772-59382", callbackURL: callbackUrl,
    });
  });

  it("rejects missing credentials and credential failures", async () => {
    await expect(obtainRefillLandingUrl({ mode: "SANDBOX", callbackUrl, rxNumber: "0459772-59382" }))
      .rejects.toMatchObject({ code: "CREDENTIALS_NOT_CONFIGURED" });
    await expect(obtainRefillLandingUrl({
      mode: "SANDBOX", apiKey: "bad", affiliateId: "bad", callbackUrl,
      rxNumber: "0459772-59382",
      fetcher: async () => new Response(JSON.stringify({ errCode: "AUTH_403", errMsg: "private detail" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    })).rejects.toMatchObject({
      code: "WALGREENS_CREDENTIALS_REJECTED",
      diagnostics: { httpStatus: 403, upstreamCode: "AUTH_403" },
    });
  });

  it("retains only sanitized HTTP and Walgreens error diagnostics", async () => {
    const request = obtainRefillLandingUrl({
      mode: "SANDBOX", apiKey: "secret-key", affiliateId: "secret-affiliate", callbackUrl,
      rxNumber: "0459772-59382",
      fetcher: async () => new Response(JSON.stringify({
        errCode: "WAG_RX_42",
        errMsg: "contains private upstream detail",
        landingUrl: "https://rx.walgreens.com/checkout?token=private",
      }), { status: 422, headers: { "content-type": "application/json" } }),
    });
    const error = await request.catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "WALGREENS_API_ERROR",
      diagnostics: { httpStatus: 422, upstreamCode: "WAG_RX_42" },
    });
    expect(JSON.stringify((error as { diagnostics: unknown }).diagnostics)).not.toContain("private");
    expect(JSON.stringify((error as { diagnostics: unknown }).diagnostics)).not.toContain("secret");
  });

  it("does not expose malformed upstream error fields", async () => {
    await expect(obtainRefillLandingUrl({
      mode: "SANDBOX", apiKey: "key", affiliateId: "aff", callbackUrl,
      rxNumber: "0459772-59382",
      fetcher: async () => new Response(JSON.stringify({ errCode: "unsafe code with spaces and patient data" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    })).rejects.toMatchObject({
      code: "WALGREENS_API_ERROR",
      diagnostics: { httpStatus: 500, upstreamCode: undefined },
    });
  });

  it("keeps documented 200 error responses fail-closed with the upstream code", async () => {
    await expect(obtainRefillLandingUrl({
      mode: "SANDBOX", apiKey: "key", affiliateId: "aff", callbackUrl,
      rxNumber: "0459772-59382",
      fetcher: async () => new Response(JSON.stringify({ errCode: "1007", errMsg: "not logged" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    })).rejects.toMatchObject({
      code: "WALGREENS_API_ERROR",
      diagnostics: { httpStatus: 200, upstreamCode: "1007" },
    });
  });

  it("reports network failures safely and rejects an untrusted landing URL", async () => {
    await expect(obtainRefillLandingUrl({
      mode: "SANDBOX", apiKey: "key", affiliateId: "aff", callbackUrl,
      rxNumber: "0459772-59382", fetcher: async () => { throw new Error("secret network detail"); },
    })).rejects.toMatchObject({ code: "WALGREENS_NETWORK_ERROR" });
    expect(() => validateLandingUrl("https://walgreens.com.evil.example/checkout"))
      .toThrow("INVALID_LANDING_URL");
    expect(() => validateCallbackBase("http://demo.convex.site/walgreens/refill/callback"))
      .toThrow("INVALID_CALLBACK_URL");
  });

  it("reports the HTTP status when a successful response has no valid landing URL", async () => {
    await expect(obtainRefillLandingUrl({
      mode: "SANDBOX", apiKey: "key", affiliateId: "aff", callbackUrl,
      rxNumber: "0459772-59382",
      fetcher: async () => new Response(JSON.stringify({ errCode: "0" }), { status: 200 }),
    })).rejects.toMatchObject({
      code: "INVALID_LANDING_URL",
      diagnostics: { httpStatus: 200, upstreamCode: "0" },
    });
  });

  it("classifies a timeout without exposing transport details", async () => {
    await expect(obtainRefillLandingUrl({
      mode: "SANDBOX", apiKey: "key", affiliateId: "aff", callbackUrl,
      rxNumber: "0459772-59382",
      fetcher: async () => { throw new DOMException("private transport detail", "TimeoutError"); },
    })).rejects.toMatchObject({ code: "WALGREENS_TIMEOUT" });
  });

  it("marks mock sessions with a local callback return", async () => {
    expect(await obtainRefillLandingUrl({ mode: "MOCK", callbackUrl, rxNumber: "0459772-59382" }))
      .toContain("status=DONE");
  });
});
