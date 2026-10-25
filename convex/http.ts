import { httpRouter } from "convex/server";
import { env, httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const MAX_BODY_BYTES = 32 * 1024;
const LEASE_MS = 10 * 60 * 1000;
const operations = new Set([
  "claimRun",
  "getRunContext",
  "getDoseEvidence",
  "getDispenseHistory",
  "getDeviceEvidence",
  "getInventoryEvidence",
  "getPatientReports",
  "getTrayObservations",
  "getSupplyEstimate",
  "getConsumptionForecast",
  "getRefillCaseHistory",
  "getRefillCheckoutStatus",
  "submitInvestigation",
  "failRun",
  "acceptAgentverseRequest",
  "syncAgentverseRequest",
  "markAgentverseResponseSubmitted",
  "failAgentverseRequest",
]);

const categories = new Set([
  "NO_RECORDED_RESPONSE",
  "DEVICE_CONNECTIVITY",
  "DEVICE_FAULT",
  "POSSIBLE_SUPPLY_ISSUE",
  "PILL_UNCOLLECTED",
  "INSUFFICIENT_EVIDENCE",
] as const);
const uncertainties = new Set(["LOW", "MEDIUM", "HIGH"] as const);
const followUps = new Set([
  "CONTACT_PATIENT",
  "REVIEW_DEVICE",
  "CHECK_PHYSICAL_SUPPLY",
  "DOCUMENT_NO_RESPONSE",
  "NO_ACTION",
] as const);

type Category = typeof categories extends Set<infer T> ? T : never;
type Uncertainty = typeof uncertainties extends Set<infer T> ? T : never;
type FollowUp = typeof followUps extends Set<infer T> ? T : never;
type Findings = {
  items: Array<{
    category: Category;
    evidenceReferences: string[];
    uncertainty: Uncertainty;
    explanation: string;
  }>;
  overallSummary: string;
  proposedFollowUp: { actionType: FollowUp; explanation: string };
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function stringField(value: Record<string, unknown>, name: string, max = 200) {
  const field = value[name];
  return typeof field === "string" && field.length > 0 && field.length <= max
    ? field
    : null;
}

function stringArray(value: unknown, max: number) {
  return Array.isArray(value) &&
    value.length <= max &&
    value.every((entry) => typeof entry === "string" && entry.length <= 200)
    ? value as string[]
    : null;
}

function parseFindings(value: unknown): Findings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.items) || record.items.length < 1 || record.items.length > 6) {
    return null;
  }
  const items: Findings["items"] = [];
  for (const item of record.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const category = row.category;
    const uncertainty = row.uncertainty;
    const explanation = row.explanation;
    const evidenceReferences = stringArray(row.evidenceReferences, 20);
    if (
      typeof category !== "string" ||
      !categories.has(category as Category) ||
      typeof uncertainty !== "string" ||
      !uncertainties.has(uncertainty as Uncertainty) ||
      typeof explanation !== "string" ||
      explanation.length < 1 ||
      explanation.length > 600 ||
      !evidenceReferences ||
      evidenceReferences.length < 1
    ) return null;
    items.push({
      category: category as Category,
      uncertainty: uncertainty as Uncertainty,
      explanation,
      evidenceReferences,
    });
  }
  const overallSummary = record.overallSummary;
  const proposed = record.proposedFollowUp;
  if (
    typeof overallSummary !== "string" ||
    overallSummary.length < 1 ||
    overallSummary.length > 800 ||
    !proposed ||
    typeof proposed !== "object" ||
    Array.isArray(proposed)
  ) return null;
  const proposedRecord = proposed as Record<string, unknown>;
  const actionType = proposedRecord.actionType;
  const explanation = proposedRecord.explanation;
  if (
    typeof actionType !== "string" ||
    !followUps.has(actionType as FollowUp) ||
    typeof explanation !== "string" ||
    explanation.length < 1 ||
    explanation.length > 500
  ) return null;
  return {
    items,
    overallSummary,
    proposedFollowUp: { actionType: actionType as FollowUp, explanation },
  };
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function runToken(secret: string, idempotencyKey: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`pillsense-agent-run:${idempotencyKey}`),
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

const service = httpAction(async (ctx, request) => {
  const configuredSecret = env.PILLSENSE_AGENT_SERVICE_SECRET;
  if (!configuredSecret) return json(503, { error: "AGENT_SERVICE_NOT_CONFIGURED" });
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json(401, { error: "SERVICE_AUTHENTICATION_REQUIRED" });
  }
  const suppliedSecret = authorization.slice("Bearer ".length);
  const [configuredHash, suppliedHash] = await Promise.all([
    sha256(configuredSecret),
    sha256(suppliedSecret),
  ]);
  if (configuredHash !== suppliedHash) {
    return json(401, { error: "SERVICE_AUTHENTICATION_FAILED" });
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) return json(413, { error: "PAYLOAD_TOO_LARGE" });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) return json(413, { error: "PAYLOAD_TOO_LARGE" });
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json(400, { error: "INVALID_JSON" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(400, { error: "INVALID_PAYLOAD" });
  }
  const payload = body as Record<string, unknown>;
  const operation = stringField(payload, "operation", 50);
  if (!operation || !operations.has(operation)) {
    return json(400, { error: "OPERATION_NOT_ALLOWED" });
  }
  const now = Date.now();

  if (
    operation === "acceptAgentverseRequest" ||
    operation === "syncAgentverseRequest" ||
    operation === "markAgentverseResponseSubmitted" ||
    operation === "failAgentverseRequest"
  ) {
    const sourceAgentAddress = stringField(payload, "sourceAgentAddress", 120);
    const requestId = stringField(payload, "requestId", 80);
    const transport = payload.transport === "ASI_ONE_ACP"
      ? "ASI_ONE_ACP" as const
      : "UAGENT_A2A" as const;
    if (!sourceAgentAddress || !requestId) {
      return json(400, { error: "INVALID_AGENTVERSE_CORRELATION" });
    }
    const expectedSender = transport === "ASI_ONE_ACP"
      ? sourceAgentAddress
      : env.PILLSENSE_AGENTVERSE_ALLOWED_SENDER;
    if (!expectedSender) {
      return json(503, { error: "AGENTVERSE_ALLOWLIST_NOT_CONFIGURED" });
    }
    if (operation === "acceptAgentverseRequest") {
      const protocolVersion = stringField(payload, "protocolVersion", 20);
      const requestType = stringField(payload, "requestType", 80);
      const caseAlias = stringField(payload, "caseAlias", 80);
      const sentAt = payload.sentAt;
      if (
        !protocolVersion || !requestType || !caseAlias ||
        typeof sentAt !== "number" || !Number.isFinite(sentAt)
      ) return json(400, { error: "INVALID_AGENTVERSE_REQUEST" });
      const result: { ok: boolean; code?: string } & Record<string, unknown> =
        await ctx.runMutation(internal.agentverseService.acceptRequest, {
          expectedSender,
          sourceAgentAddress,
          transport,
          protocolVersion,
          requestId,
          requestType,
          caseAlias,
          sentAt,
          now,
        });
      return json(result.ok ? 200 : result.code === "REPLAY_REJECTED" ? 409 : 403, result);
    }
    if (operation === "syncAgentverseRequest") {
      const result: { ok: boolean; code?: string } & Record<string, unknown> =
        await ctx.runMutation(internal.agentverseService.syncRequest, {
          expectedSender,
          sourceAgentAddress,
          transport,
          requestId,
          now,
        });
      return json(result.ok ? 200 : 403, result);
    }
    if (operation === "failAgentverseRequest") {
      const outcomeCode = stringField(payload, "outcomeCode", 80);
      if (!outcomeCode) return json(400, { error: "INVALID_AGENTVERSE_FAILURE" });
      const result: { ok: boolean; code?: string } = await ctx.runMutation(
        internal.agentverseService.failRequest,
        { expectedSender, sourceAgentAddress, transport, requestId, outcomeCode, now },
      );
      return json(result.ok ? 200 : 403, result);
    }
    const responseStatus = payload.responseStatus;
    if (
      responseStatus !== "ACK" &&
      responseStatus !== "IN_PROGRESS" &&
      responseStatus !== "COMPLETED" &&
      responseStatus !== "FAILED"
    ) return json(400, { error: "INVALID_AGENTVERSE_RESPONSE_STATUS" });
    const result: { ok: boolean; code?: string } = await ctx.runMutation(
      internal.agentverseService.markResponseSubmitted,
      { expectedSender, sourceAgentAddress, transport, requestId, responseStatus, now },
    );
    return json(result.ok ? 200 : 403, result);
  }

  if (operation === "claimRun") {
    const idempotencyKey = stringField(payload, "idempotencyKey", 160);
    if (!idempotencyKey) return json(400, { error: "INVALID_IDEMPOTENCY_KEY" });
    const token = await runToken(configuredSecret, idempotencyKey);
    const tokenHash = await sha256(token);
    const claimed: {
      runId: string;
      careCaseId?: string;
      caseVersion: number;
    } | null = await ctx.runMutation(internal.agentService.claimNext, {
      tokenHash,
      idempotencyKey,
      now,
      leaseExpiresAt: now + LEASE_MS,
    });
    return json(200, claimed?.careCaseId ? { claimed: true, runToken: token, ...claimed } : { claimed: false });
  }

  const runId = stringField(payload, "runId", 200);
  const suppliedRunToken = request.headers.get("x-pillsense-run-token");
  if (!runId || !suppliedRunToken || suppliedRunToken.length > 200) {
    return json(401, { error: "RUN_AUTHENTICATION_REQUIRED" });
  }
  const tokenHash = await sha256(suppliedRunToken);

  if (operation === "getRunContext") {
    const scope = await ctx.runQuery(internal.agentService.getRunContextPayload, { runId, tokenHash, now });
    if (!scope.ok) return json(403, { error: scope.code ?? "RUN_AUTHORIZATION_FAILED" });
    return json(200, scope);
  }

  const toolByOperation = {
    getDoseEvidence: "get_dose_context",
    getDispenseHistory: "get_dispense_history",
    getDeviceEvidence: "get_device_status",
    getInventoryEvidence: "get_inventory_context",
    getPatientReports: "get_patient_reports",
    getTrayObservations: "get_tray_observations",
    getSupplyEstimate: "get_supply_estimate",
    getConsumptionForecast: "get_consumption_forecast",
    getRefillCaseHistory: "get_refill_case_history",
    getRefillCheckoutStatus: "get_refill_checkout_status",
  } as const;
  if (operation in toolByOperation) {
    const actionId = stringField(payload, "idempotencyKey", 160);
    if (!actionId) return json(400, { error: "INVALID_IDEMPOTENCY_KEY" });
    const result: { ok: boolean; code?: string } & Record<string, unknown> =
      await ctx.runMutation(internal.agentService.consumeTool, {
        runId,
        tokenHash,
        now,
        actionId,
        toolName: toolByOperation[operation as keyof typeof toolByOperation],
      });
    return json(result.ok ? 200 : result.code === "TOOL_BUDGET_EXCEEDED" ? 429 : 409, result);
  }

  if (operation === "submitInvestigation") {
    const idempotencyKey = stringField(payload, "idempotencyKey", 160);
    const provider = payload.provider;
    const model = payload.model;
    const findings = parseFindings(payload.findings);
    if (
      !idempotencyKey ||
      (provider !== "OPENAI" &&
        provider !== "ANTHROPIC" &&
        provider !== "DETERMINISTIC_FALLBACK") ||
      (model !== null && typeof model !== "string") ||
      !findings
    ) return json(400, { error: "INVALID_SUBMISSION" });
    const result: { ok: boolean; code?: string } = await ctx.runMutation(
      internal.agentService.submitInvestigation,
      { runId, tokenHash, now, idempotencyKey, provider, model, findings },
    );
    return json(result.ok ? 200 : 409, result);
  }

  const idempotencyKey = stringField(payload, "idempotencyKey", 160);
  const failureCode = stringField(payload, "failureCode", 100);
  if (!idempotencyKey || !failureCode) return json(400, { error: "INVALID_FAILURE" });
  const result: { ok: boolean; code?: string } = await ctx.runMutation(
    internal.agentService.failRun,
    { runId, tokenHash, now, idempotencyKey, failureCode },
  );
  return json(result.ok ? 200 : 409, result);
});

const methodNotAllowed = httpAction(async () =>
  json(405, { error: "METHOD_NOT_ALLOWED" }),
);

const http = httpRouter();
http.route({ path: "/agent/service", method: "POST", handler: service });
http.route({ path: "/agent/service", method: "GET", handler: methodNotAllowed });

http.route({
  pathPrefix: "/walgreens/refill/callback/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const token = url.pathname.slice("/walgreens/refill/callback/".length);
    const action = url.searchParams.get("action");
    const status = url.searchParams.get("status")?.toUpperCase();
    const affiliateId = url.searchParams.get("affiliateID");
    if (url.searchParams.getAll("action").length !== 1 ||
        url.searchParams.getAll("status").length !== 1 ||
        !token || !/^[0-9a-f]{64}$/.test(token) || action?.toLowerCase() !== "refill" ||
        !status || !["DONE", "CANCEL", "BACK", "ERROR"].includes(status) ||
        url.searchParams.getAll("affiliateID").length > 1) {
      return new Response("Invalid checkout return", { status: 400, headers: { "cache-control": "no-store" } });
    }
    const result = await ctx.runMutation(internal.walgreens.recordCallback, {
      tokenHash: await sha256(token), status, affiliateId: affiliateId ?? undefined, now: Date.now(),
    });
    if (!result.accepted) return new Response("Checkout return unavailable", { status: 410, headers: { "cache-control": "no-store" } });
    const message = status === "DONE"
      ? "Checkout return recorded. Pharmacy fulfillment has not been verified."
      : "Checkout return recorded. Please review the refill status in PillSense.";
    return new Response(message, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }),
});
http.route({ pathPrefix: "/walgreens/refill/callback/", method: "POST", handler: methodNotAllowed });

export default http;
