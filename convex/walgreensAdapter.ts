export const WALGREENS_SANDBOX_ENDPOINT = "https://services-qa.walgreens.com/api/pharmacy/fetch/v1";
const TIMEOUT_MS = 8_000;

export type WalgreensMode = "SANDBOX" | "MOCK";

export class WalgreensAdapterError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function validateCallbackBase(value: string | undefined): URL {
  if (!value) throw new WalgreensAdapterError("CALLBACK_NOT_CONFIGURED");
  let url: URL;
  try { url = new URL(value); } catch { throw new WalgreensAdapterError("INVALID_CALLBACK_URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/walgreens/refill/callback") {
    throw new WalgreensAdapterError("INVALID_CALLBACK_URL");
  }
  return url;
}

export function validateLandingUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) {
    throw new WalgreensAdapterError("INVALID_LANDING_URL");
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new WalgreensAdapterError("INVALID_LANDING_URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      !/^(?:[a-z0-9-]+\.)*walgreens\.com$/i.test(url.hostname)) {
    throw new WalgreensAdapterError("INVALID_LANDING_URL");
  }
  return url.toString();
}

export async function obtainRefillLandingUrl(input: {
  mode: WalgreensMode;
  apiKey?: string;
  affiliateId?: string;
  callbackUrl: string;
  rxNumber: string;
  fetcher?: typeof fetch;
}): Promise<string> {
  if (input.mode === "MOCK") {
    const url = new URL(input.callbackUrl);
    url.searchParams.set("action", "refill");
    url.searchParams.set("status", "DONE");
    return url.toString();
  }
  if (!input.apiKey?.trim() || !input.affiliateId?.trim()) {
    throw new WalgreensAdapterError("CREDENTIALS_NOT_CONFIGURED");
  }
  if (!/^\d{7}-\d{5}$/.test(input.rxNumber)) {
    throw new WalgreensAdapterError("INVALID_TEST_RX_NUMBER");
  }
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(WALGREENS_SANDBOX_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({
        apikey: input.apiKey,
        affId: input.affiliateId,
        transaction: "refill",
        rxNumber: input.rxNumber,
        callbackURL: input.callbackUrl,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new WalgreensAdapterError(error instanceof Error && error.name === "TimeoutError"
      ? "WALGREENS_TIMEOUT" : "WALGREENS_NETWORK_ERROR");
  }
  if (response.status === 403 || response.status === 401) {
    throw new WalgreensAdapterError("WALGREENS_CREDENTIALS_REJECTED");
  }
  if (!response.ok) throw new WalgreensAdapterError("WALGREENS_API_ERROR");
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new WalgreensAdapterError("WALGREENS_INVALID_RESPONSE"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new WalgreensAdapterError("WALGREENS_INVALID_RESPONSE");
  }
  const result = payload as Record<string, unknown>;
  if (result.errCode && result.errCode !== "0" && result.errCode !== 0) {
    throw new WalgreensAdapterError("WALGREENS_API_ERROR");
  }
  return validateLandingUrl(result.landingUrl);
}
