export const WALGREENS_SANDBOX_ENDPOINT = "https://services-qa.walgreens.com/api/pharmacy/fetch/v1";
const TIMEOUT_MS = 8_000;

export type WalgreensMode = "SANDBOX" | "MOCK";

export type WalgreensSafeDiagnostics = {
  httpStatus?: number;
  upstreamCode?: string;
};

export class WalgreensAdapterError extends Error {
  constructor(
    readonly code: string,
    readonly diagnostics: WalgreensSafeDiagnostics = {},
  ) {
    super(code);
  }
}

function safeUpstreamCode(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const code = String(value).trim();
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(code) ? code : undefined;
}

async function readJsonObject(response: Response): Promise<Record<string, unknown> | undefined> {
  try {
    const payload: unknown = await response.json();
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
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
  const payload = await readJsonObject(response);
  const diagnostics: WalgreensSafeDiagnostics = {
    httpStatus: response.status,
    upstreamCode: safeUpstreamCode(payload?.errCode),
  };
  if (response.status === 403 || response.status === 401) {
    throw new WalgreensAdapterError("WALGREENS_CREDENTIALS_REJECTED", diagnostics);
  }
  if (!response.ok) throw new WalgreensAdapterError("WALGREENS_API_ERROR", diagnostics);
  if (!payload) {
    throw new WalgreensAdapterError("WALGREENS_INVALID_RESPONSE", diagnostics);
  }
  if (payload.errCode && payload.errCode !== "0" && payload.errCode !== 0) {
    throw new WalgreensAdapterError("WALGREENS_API_ERROR", diagnostics);
  }
  try {
    return validateLandingUrl(payload.landingUrl);
  } catch (error) {
    if (error instanceof WalgreensAdapterError) {
      throw new WalgreensAdapterError(error.code, diagnostics);
    }
    throw error;
  }
}
