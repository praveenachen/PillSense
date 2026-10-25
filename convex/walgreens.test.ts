/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const weekdays = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

async function setup(token: string) {
  vi.stubEnv("WALGREENS_MODE", "mock");
  const root = convexTest(schema, modules);
  const actor = root.withIdentity({ tokenIdentifier: token, name: "Refill caregiver" });
  await actor.mutation(api.demo.ensureCareTeam, {});
  const team = await actor.query(api.caregiver.setup, {});
  if (team.status !== "ready") throw new Error("Care team unavailable");
  await actor.mutation(api.medications.createWithAssignment, {
    patientId: team.patient.id, name: "Demo", instructions: "Synthetic only", slot: 6,
    localTime: "09:00", weekdays: [...weekdays], timezone: "America/Toronto", demoInventory: 1,
  });
  const assignment = await root.run(async (ctx) => (await ctx.db.query("compartmentAssignments").take(1))[0]);
  await actor.mutation(api.refills.adjustVerifiedSupply, { assignmentId: assignment._id, count: 2 });
  const listed = await actor.query(api.refills.listForCaregiver, {});
  if (listed.status !== "ready" || !listed.cases[0]?.refillCase) throw new Error("Case missing");
  return { root, actor, team, assignment, refillCaseId: listed.cases[0].refillCase._id };
}

afterEach(() => vi.unstubAllEnvs());

describe("Walgreens checkout guardrails", () => {
  it("requires caregiver access and completed review/investigation", async () => {
    const data = await setup("issuer|walgreens-roles");
    await expect(data.actor.mutation(api.walgreens.approve, { refillCaseId: data.refillCaseId }))
      .rejects.toThrow("Caregiver review");
    const other = data.root.withIdentity({ tokenIdentifier: "issuer|walgreens-other" });
    await other.mutation(api.demo.ensureCareTeam, {});
    await expect(other.mutation(api.walgreens.approve, { refillCaseId: data.refillCaseId }))
      .rejects.toThrow("Patient access denied");
    await data.root.run((ctx) => ctx.db.patch("refillCases", data.refillCaseId, {
      status: "REFILL_REQUESTED", investigationStatus: "COMPLETED",
    }));
    const approved = await data.actor.mutation(api.walgreens.approve, { refillCaseId: data.refillCaseId });
    expect(approved).toMatchObject({ status: "APPROVED", duplicate: false });
    expect(await data.actor.mutation(api.walgreens.approve, { refillCaseId: data.refillCaseId }))
      .toMatchObject({ checkoutId: approved.checkoutId, duplicate: true });
  });

  it("blocks unknown supply and permits a fresh approval after explicit credential rejection", async () => {
    const data = await setup("issuer|walgreens-retry");
    await data.root.run((ctx) => ctx.db.patch("refillCases", data.refillCaseId, {
      status: "REFILL_REQUESTED", investigationStatus: "COMPLETED", triggerReason: "UNKNOWN_SUPPLY",
    }));
    await expect(data.actor.mutation(api.walgreens.approve, { refillCaseId: data.refillCaseId }))
      .rejects.toThrow("Caregiver review");
    await data.root.run((ctx) => ctx.db.patch("refillCases", data.refillCaseId, { triggerReason: "LOW_SUPPLY" }));
    const first = await data.actor.mutation(api.walgreens.approve, { refillCaseId: data.refillCaseId });
    const now = Date.now();
    await data.actor.mutation(internal.walgreens.reserveSession, {
      checkoutId: first.checkoutId, idempotencyKey: "first", correlationId: "first",
      callbackTokenHash: "a".repeat(64), now,
    });
    await data.root.mutation(internal.walgreens.finishSession, {
      checkoutId: first.checkoutId, idempotencyKey: "first", errorCode: "WALGREENS_CREDENTIALS_REJECTED", now,
    });
    const second = await data.actor.mutation(api.walgreens.approve, { refillCaseId: data.refillCaseId });
    expect(second.checkoutId).not.toBe(first.checkoutId);
  });

  it("reserves one session, consumes a callback once, and leaves inventory untouched", async () => {
    const data = await setup("issuer|walgreens-callback");
    await data.root.run((ctx) => ctx.db.patch("refillCases", data.refillCaseId, {
      status: "REFILL_REQUESTED", investigationStatus: "COMPLETED",
    }));
    const { checkoutId } = await data.actor.mutation(api.walgreens.approve, { refillCaseId: data.refillCaseId });
    const tokenHash = "a".repeat(64);
    const now = Date.now();
    expect(await data.actor.mutation(internal.walgreens.reserveSession, {
      checkoutId, idempotencyKey: "checkout-1", correlationId: "correlation-1", callbackTokenHash: tokenHash, now,
    })).toMatchObject({ reserved: true });
    expect(await data.actor.mutation(internal.walgreens.reserveSession, {
      checkoutId, idempotencyKey: "checkout-1", correlationId: "correlation-2", callbackTokenHash: "b".repeat(64), now,
    })).toMatchObject({ reserved: false });
    await expect(data.actor.mutation(internal.walgreens.reserveSession, {
      checkoutId, idempotencyKey: "checkout-2", correlationId: "correlation-3", callbackTokenHash: "c".repeat(64), now,
    })).rejects.toThrow("already requested");
    await data.root.mutation(internal.walgreens.finishSession, {
      checkoutId, idempotencyKey: "checkout-1", landingUrl: "https://rx.walgreens.com/test", now,
    });
    expect(await data.root.mutation(internal.walgreens.recordCallback, {
      tokenHash, status: "DONE", now: now + 1,
    })).toMatchObject({ accepted: true, status: "CHECKOUT_RETURNED_UNVERIFIED" });
    expect(await data.root.mutation(internal.walgreens.recordCallback, {
      tokenHash, status: "CANCEL", now: now + 2,
    })).toMatchObject({ accepted: false });
    expect(await data.root.mutation(internal.walgreens.recordCallback, {
      tokenHash: "f".repeat(64), status: "DONE", now: now + 2,
    })).toMatchObject({ accepted: false });
    const stored = await data.root.run(async (ctx) => ({
      assignment: await ctx.db.get("compartmentAssignments", data.assignment._id),
      refillCase: await ctx.db.get("refillCases", data.refillCaseId),
      checkout: await ctx.db.get("walgreensCheckouts", checkoutId),
    }));
    expect(stored.assignment?.estimatedSupplyCount).toBe(2);
    expect(stored.refillCase?.status).toBe("REFILL_REQUESTED");
    expect(stored.checkout?.status).toBe("CHECKOUT_RETURNED_UNVERIFIED");
  });

  it.each(["CANCEL", "BACK", "ERROR"])("records %s without modifying supply", async (callbackStatus) => {
    const data = await setup(`issuer|walgreens-${callbackStatus}`);
    await data.root.run((ctx) => ctx.db.patch("refillCases", data.refillCaseId, {
      status: "REFILL_REQUESTED", investigationStatus: "COMPLETED",
    }));
    const { checkoutId } = await data.actor.mutation(api.walgreens.approve, { refillCaseId: data.refillCaseId });
    const now = Date.now();
    const tokenHash = callbackStatus.toLowerCase().repeat(16).slice(0, 64);
    await data.actor.mutation(internal.walgreens.reserveSession, {
      checkoutId, idempotencyKey: callbackStatus, correlationId: callbackStatus, callbackTokenHash: tokenHash, now,
    });
    const result = await data.root.mutation(internal.walgreens.recordCallback, {
      tokenHash, status: callbackStatus, now: now + 1,
    });
    expect(result).toMatchObject({ accepted: true });
    const assignment = await data.root.run((ctx) => ctx.db.get("compartmentAssignments", data.assignment._id));
    expect(assignment?.estimatedSupplyCount).toBe(2);
  });

  it("rejects an expired callback token", async () => {
    const data = await setup("issuer|walgreens-expiry");
    await data.root.run((ctx) => ctx.db.patch("refillCases", data.refillCaseId, {
      status: "REFILL_REQUESTED", investigationStatus: "COMPLETED",
    }));
    const { checkoutId } = await data.actor.mutation(api.walgreens.approve, { refillCaseId: data.refillCaseId });
    const now = Date.now();
    await data.actor.mutation(internal.walgreens.reserveSession, {
      checkoutId, idempotencyKey: "expiry", correlationId: "expiry",
      callbackTokenHash: "e".repeat(64), now,
    });
    expect(await data.root.mutation(internal.walgreens.recordCallback, {
      tokenHash: "e".repeat(64), status: "DONE", now: now + 31 * 60 * 1000,
    })).toMatchObject({ accepted: false });
  });

  it("accepts a valid public callback path once and rejects malformed returns", async () => {
    const data = await setup("issuer|walgreens-http-callback");
    await data.root.run((ctx) => ctx.db.patch("refillCases", data.refillCaseId, {
      status: "REFILL_REQUESTED", investigationStatus: "COMPLETED",
    }));
    const { checkoutId } = await data.actor.mutation(api.walgreens.approve, { refillCaseId: data.refillCaseId });
    const token = "a".repeat(64);
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))]
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    await data.actor.mutation(internal.walgreens.reserveSession, {
      checkoutId, idempotencyKey: "http", correlationId: "http", callbackTokenHash: hash, now: Date.now(),
    });
    vi.stubEnv("WALGREENS_REFILL_AFF_ID", "expected-affiliate");
    await data.root.run((ctx) => ctx.db.patch("walgreensCheckouts", checkoutId, { environment: "SANDBOX" }));
    expect((await data.root.fetch(`/walgreens/refill/callback/${token}?action=refill&status=INVALID`)).status).toBe(400);
    expect((await data.root.fetch(`/walgreens/refill/callback/${token}?action=refill&status=DONE&affiliateID=wrong`)).status).toBe(410);
    const first = await data.root.fetch(`/walgreens/refill/callback/${token}?action=refill&status=DONE&affiliateID=expected-affiliate`);
    expect(first.status).toBe(200);
    expect(await first.text()).toContain("not been verified");
    expect((await data.root.fetch(`/walgreens/refill/callback/${token}?action=refill&status=DONE`)).status).toBe(410);
  });

  it("runs the complete mock caregiver handoff through the public action and callback", async () => {
    const data = await setup("issuer|walgreens-mock-flow");
    vi.stubEnv("WALGREENS_CALLBACK_URL", "https://demo.convex.site/walgreens/refill/callback");
    await data.root.run((ctx) => ctx.db.patch("refillCases", data.refillCaseId, {
      status: "REFILL_REQUESTED", investigationStatus: "COMPLETED",
    }));
    const { checkoutId } = await data.actor.mutation(api.walgreens.approve, { refillCaseId: data.refillCaseId });
    const args = { checkoutId, idempotencyKey: "same-button-attempt", rxNumber: "0459772-59382" };
    const first = await data.actor.action(api.walgreens.createSession, args);
    expect(first).toMatchObject({ status: "CHECKOUT_READY", environment: "MOCK" });
    expect(await data.actor.action(api.walgreens.createSession, args))
      .toMatchObject({ status: "CHECKOUT_READY", landingUrl: first.landingUrl });
    if (!first.landingUrl) throw new Error("Mock URL missing");
    const callback = new URL(first.landingUrl);
    expect((await data.root.fetch(`${callback.pathname}${callback.search}`)).status).toBe(200);
    const visible = await data.actor.query(api.walgreens.listForCase, { refillCaseId: data.refillCaseId });
    expect(visible[0]).toMatchObject({ status: "CHECKOUT_RETURNED_UNVERIFIED", environment: "MOCK" });
    const assignment = await data.root.run((ctx) => ctx.db.get("compartmentAssignments", data.assignment._id));
    expect(assignment?.estimatedSupplyCount).toBe(2);
  });
});
