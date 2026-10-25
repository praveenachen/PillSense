import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, env, internalMutation, mutation, query } from "./_generated/server";
import { requireCaregiverAccess } from "./lib/authorization";
import { obtainRefillLandingUrl, validateCallbackBase, WalgreensAdapterError } from "./walgreensAdapter";

const CALLBACK_TTL_MS = 30 * 60 * 1000;
const TEST_RX_NUMBERS = new Set([
  "0459772-59382", "0459773-59382", "0459774-59382",
  "0425212-59107", "0425213-59107", "0425214-59107",
  "0425215-59107", "0425216-59107", "0425217-59107",
  "0425218-59107", "0425219-59107", "0425220-59107",
  "0000000-00000", "0132832-59381", "0211810-59400", "0245578-59393",
]);

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function currentMode(): "SANDBOX" | "MOCK" {
  if (env.WALGREENS_MODE === "sandbox") return "SANDBOX";
  if (env.WALGREENS_MODE === "mock" || (!env.WALGREENS_MODE && !env.WALGREENS_REFILL_API_KEY)) return "MOCK";
  throw new ConvexError("WALGREENS_MODE must be sandbox or mock");
}

const activeStatuses = new Set([
  "APPROVED", "REQUESTING", "CHECKOUT_READY", "CHECKOUT_RETURNED_UNVERIFIED", "ERROR",
]);
const safeRetryableErrors = new Set(["CREDENTIALS_NOT_CONFIGURED", "WALGREENS_CREDENTIALS_REJECTED"]);

export const listForCase = query({
  args: { refillCaseId: v.id("refillCases") },
  handler: async (ctx, args) => {
    const refillCase = await ctx.db.get("refillCases", args.refillCaseId);
    if (!refillCase) throw new ConvexError("Refill case unavailable");
    await requireCaregiverAccess(ctx, refillCase.patientId);
    const rows = await ctx.db.query("walgreensCheckouts")
      .withIndex("by_case", (q) => q.eq("refillCaseId", args.refillCaseId))
      .order("desc").take(10);
    return rows.map((row) => ({
      id: row._id, status: row.status, provider: row.provider, environment: row.environment,
      correlationId: row.correlationId ?? null, approvedAt: row.approvedAt,
      requestedAt: row.requestedAt ?? null, returnedAt: row.returnedAt ?? null,
      errorCode: row.errorCode ?? null, landingUrl: row.landingUrl ?? null,
      checkoutReturnIsUnverified: true,
    }));
  },
});

export const approve = mutation({
  args: { refillCaseId: v.id("refillCases") },
  handler: async (ctx, args) => {
    const refillCase = await ctx.db.get("refillCases", args.refillCaseId);
    if (!refillCase) throw new ConvexError("Refill case unavailable");
    const { caregiver } = await requireCaregiverAccess(ctx, refillCase.patientId);
    if (refillCase.status !== "REFILL_REQUESTED" || refillCase.investigationStatus !== "COMPLETED" ||
        refillCase.triggerReason !== "LOW_SUPPLY" || refillCase.estimatedSupplyCount === null) {
      throw new ConvexError("Caregiver review, refill request, and coordinator investigation are required");
    }
    const prior = await ctx.db.query("walgreensCheckouts")
      .withIndex("by_case", (q) => q.eq("refillCaseId", args.refillCaseId))
      .order("desc").take(10);
    const active = prior.find((row) => activeStatuses.has(row.status) &&
      !(row.status === "ERROR" && safeRetryableErrors.has(row.errorCode ?? "")));
    if (active) return { checkoutId: active._id, status: active.status, duplicate: true };
    const now = Date.now();
    const checkoutId = await ctx.db.insert("walgreensCheckouts", {
      refillCaseId: args.refillCaseId, patientId: refillCase.patientId,
      caregiverId: caregiver._id, provider: "WALGREENS", environment: currentMode(),
      status: "APPROVED", approvedAt: now, updatedAt: now,
    });
    await ctx.db.insert("walgreensCheckoutEvents", { checkoutId, type: "APPROVED", actorId: caregiver._id, occurredAt: now });
    return { checkoutId, status: "APPROVED" as const, duplicate: false };
  },
});

export const reserveSession = internalMutation({
  args: {
    checkoutId: v.id("walgreensCheckouts"), idempotencyKey: v.string(),
    correlationId: v.string(), callbackTokenHash: v.string(), now: v.number(),
  },
  handler: async (ctx, args) => {
    const checkout = await ctx.db.get("walgreensCheckouts", args.checkoutId);
    if (!checkout) throw new ConvexError("Checkout unavailable");
    const { caregiver } = await requireCaregiverAccess(ctx, checkout.patientId);
    if (checkout.caregiverId !== caregiver._id) throw new ConvexError("Checkout access denied");
    const refillCase = await ctx.db.get("refillCases", checkout.refillCaseId);
    if (refillCase?.status !== "REFILL_REQUESTED") throw new ConvexError("Refill case no longer approved");
    if (checkout.status !== "APPROVED") {
      if (checkout.idempotencyKey === args.idempotencyKey) {
        return { reserved: false as const, status: checkout.status, landingUrl: checkout.landingUrl ?? null };
      }
      throw new ConvexError("Checkout session already requested");
    }
    if (!args.idempotencyKey.trim() || args.idempotencyKey.length > 160) throw new ConvexError("Invalid idempotency key");
    const existingKey = await ctx.db.query("walgreensCheckouts")
      .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", args.idempotencyKey)).unique();
    if (existingKey) throw new ConvexError("Idempotency key already used");
    await ctx.db.patch("walgreensCheckouts", checkout._id, {
      status: "REQUESTING", idempotencyKey: args.idempotencyKey,
      correlationId: args.correlationId, callbackTokenHash: args.callbackTokenHash,
      callbackExpiresAt: args.now + CALLBACK_TTL_MS,
      requestedAt: args.now, updatedAt: args.now,
    });
    await ctx.db.insert("walgreensCheckoutEvents", { checkoutId: checkout._id, type: "REQUESTING", actorId: caregiver._id, occurredAt: args.now });
    return { reserved: true as const, status: "REQUESTING" as const, landingUrl: null };
  },
});

export const finishSession = internalMutation({
  args: {
    checkoutId: v.id("walgreensCheckouts"), idempotencyKey: v.string(),
    landingUrl: v.optional(v.string()), errorCode: v.optional(v.string()), now: v.number(),
  },
  handler: async (ctx, args) => {
    const checkout = await ctx.db.get("walgreensCheckouts", args.checkoutId);
    if (!checkout || checkout.idempotencyKey !== args.idempotencyKey || checkout.status !== "REQUESTING") {
      return { updated: false, status: checkout?.status ?? "ERROR" };
    }
    const type = args.landingUrl ? "CHECKOUT_READY" as const : "ERROR" as const;
    await ctx.db.patch("walgreensCheckouts", checkout._id, {
      status: type, landingUrl: args.landingUrl, errorCode: args.errorCode, updatedAt: args.now,
    });
    await ctx.db.insert("walgreensCheckoutEvents", { checkoutId: checkout._id, type, occurredAt: args.now });
    return { updated: true, status: type };
  },
});

export const createSession = action({
  args: { checkoutId: v.id("walgreensCheckouts"), idempotencyKey: v.string(), rxNumber: v.string() },
  handler: async (ctx, args): Promise<{ status: string; landingUrl: string | null; environment: "SANDBOX" | "MOCK"; errorCode?: string }> => {
    const environment = currentMode();
    if (!TEST_RX_NUMBERS.has(args.rxNumber)) throw new ConvexError("Only official sandbox test prescription numbers are allowed");
    const callbackBase = validateCallbackBase(env.WALGREENS_CALLBACK_URL ?? `${env.CONVEX_SITE_URL}/walgreens/refill/callback`);
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
    const callbackUrl = new URL(callbackBase);
    callbackUrl.pathname = `${callbackBase.pathname}/${token}`;
    const idempotencyKey = args.idempotencyKey.trim();
    const reserved = await ctx.runMutation(internal.walgreens.reserveSession, {
      checkoutId: args.checkoutId, idempotencyKey,
      correlationId: crypto.randomUUID(), callbackTokenHash: await sha256(token), now: Date.now(),
    });
    if (!reserved.reserved) return { status: reserved.status, landingUrl: reserved.landingUrl, environment };
    try {
      const landingUrl = await obtainRefillLandingUrl({
        mode: environment, apiKey: env.WALGREENS_REFILL_API_KEY,
        affiliateId: env.WALGREENS_REFILL_AFF_ID,
        callbackUrl: callbackUrl.toString(), rxNumber: args.rxNumber,
      });
      const finished = await ctx.runMutation(internal.walgreens.finishSession, {
        checkoutId: args.checkoutId, idempotencyKey, landingUrl, now: Date.now(),
      });
      return finished.updated
        ? { status: "CHECKOUT_READY", landingUrl, environment }
        : { status: finished.status, landingUrl: null, environment };
    } catch (error) {
      const errorCode = error instanceof WalgreensAdapterError ? error.code : "WALGREENS_API_ERROR";
      const finished = await ctx.runMutation(internal.walgreens.finishSession, {
        checkoutId: args.checkoutId, idempotencyKey, errorCode, now: Date.now(),
      });
      return { status: finished.status, landingUrl: null, environment, errorCode };
    }
  },
});

export const recordCallback = internalMutation({
  args: { tokenHash: v.string(), status: v.string(), affiliateId: v.optional(v.string()), now: v.number() },
  handler: async (ctx, args) => {
    const checkout = await ctx.db.query("walgreensCheckouts")
      .withIndex("by_callback_token_hash", (q) => q.eq("callbackTokenHash", args.tokenHash)).unique();
    if (!checkout || checkout.callbackConsumedAt || !checkout.callbackExpiresAt ||
        args.now > checkout.callbackExpiresAt ||
        (checkout.status !== "CHECKOUT_READY" && checkout.status !== "REQUESTING")) {
      return { accepted: false as const };
    }
    if (checkout.environment === "SANDBOX" && args.affiliateId && args.affiliateId !== env.WALGREENS_REFILL_AFF_ID) {
      return { accepted: false as const };
    }
    const status = args.status === "DONE" ? "CHECKOUT_RETURNED_UNVERIFIED" as const
      : args.status === "CANCEL" ? "CANCELLED" as const
      : args.status === "BACK" ? "BACK" as const : "ERROR" as const;
    await ctx.db.patch("walgreensCheckouts", checkout._id, {
      status, callbackConsumedAt: args.now, returnedAt: args.now, updatedAt: args.now,
      errorCode: status === "ERROR" ? "WALGREENS_CHECKOUT_ERROR" : undefined,
    });
    await ctx.db.insert("walgreensCheckoutEvents", { checkoutId: checkout._id, type: status, occurredAt: args.now });
    return { accepted: true as const, status };
  },
});
