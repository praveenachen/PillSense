/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const weekdays = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

async function setup(token: string) {
  const root = convexTest(schema, modules);
  const actor = root.withIdentity({ tokenIdentifier: token, name: "Refill Caregiver" });
  await actor.mutation(api.demo.ensureCareTeam, {});
  const team = await actor.query(api.caregiver.setup, {});
  if (team.status !== "ready") throw new Error("Care team unavailable");
  await actor.mutation(api.medications.createWithAssignment, {
    patientId: team.patient.id, name: "Iron Pills", instructions: "Synthetic demo only",
    slot: 6, localTime: "09:00", weekdays: [...weekdays], timezone: "America/Toronto", demoInventory: 1,
  });
  const assignment = await root.run(async (ctx) => (await ctx.db.query("compartmentAssignments").take(10))[0]);
  return { root, actor, team, assignment };
}

describe("M5 refill forecasting and workflow", () => {
  it("reconciles unknown supply repeatedly without duplicate cases", async () => {
    const data = await setup("issuer|refill-idempotent");
    expect(await data.actor.mutation(api.refills.reconcileMine, {})).toMatchObject({ created: 1 });
    expect(await data.actor.mutation(api.refills.reconcileMine, {})).toMatchObject({ created: 0, updated: 0 });
    const cases = await data.root.run((ctx) => ctx.db.query("refillCases").take(20));
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ triggerReason: "UNKNOWN_SUPPLY", confidence: "UNKNOWN" });
  });

  it("isolates caregiver writes from another care team", async () => {
    const owner = await setup("issuer|refill-owner");
    const other = owner.root.withIdentity({ tokenIdentifier: "issuer|refill-other", name: "Other" });
    await other.mutation(api.demo.ensureCareTeam, {});
    await expect(other.mutation(api.refills.adjustVerifiedSupply, { assignmentId: owner.assignment._id, count: 4 })).rejects.toThrow("Patient access denied");
  });

  it("enforces reviewed, requested, received order and records verified receipt", async () => {
    const data = await setup("issuer|refill-transitions");
    await data.actor.mutation(api.refills.adjustVerifiedSupply, { assignmentId: data.assignment._id, count: 2 });
    const listed = await data.actor.query(api.refills.listForCaregiver, {});
    if (listed.status !== "ready" || !listed.cases[0]?.refillCase) throw new Error("Refill case missing");
    const id = listed.cases[0].refillCase._id;
    await expect(data.actor.mutation(api.refills.transition, { refillCaseId: id, action: "REQUEST_REFILL" })).rejects.toThrow("Review the case");
    await data.actor.mutation(api.refills.transition, { refillCaseId: id, action: "REVIEW" });
    await data.actor.mutation(api.refills.transition, { refillCaseId: id, action: "REQUEST_REFILL" });
    await data.actor.mutation(api.refills.transition, { refillCaseId: id, action: "RECEIVE_REFILL", receivedCount: 30 });
    const stored = await data.root.run(async (ctx) => ({ case: await ctx.db.get("refillCases", id), assignment: await ctx.db.get("compartmentAssignments", data.assignment._id), transitions: await ctx.db.query("refillCaseTransitions").withIndex("by_case", (q) => q.eq("caseId", id)).take(20) }));
    expect(stored.case?.status).toBe("REFILL_RECEIVED");
    expect(stored.assignment).toMatchObject({ estimatedSupplyCount: 30, supplyEstimateSource: "CAREGIVER_VERIFIED" });
    expect(stored.transitions.map((row) => row.type)).toEqual(expect.arrayContaining(["REVIEWED", "REFILL_REQUESTED", "REFILL_RECEIVED"]));
  });

  it("resets synthetic supply without deleting medication or audit history", async () => {
    const data = await setup("issuer|refill-reset");
    await data.actor.mutation(api.refills.adjustVerifiedSupply, { assignmentId: data.assignment._id, count: 12 });
    await data.actor.mutation(api.refills.runLowSupplyDemo, {});
    await expect(data.actor.mutation(api.refills.resetLowSupplyDemo, {})).resolves.toEqual({ reset: 1 });
    const state = await data.root.run(async (ctx) => ({ assignment: await ctx.db.get("compartmentAssignments", data.assignment._id), meds: await ctx.db.query("medications").take(20), runs: await ctx.db.query("refillDemoRuns").take(20), cases: await ctx.db.query("refillCases").take(20) }));
    expect(state.assignment).toMatchObject({ estimatedSupplyCount: 12, supplyEstimateSource: "CAREGIVER_VERIFIED" });
    expect(state.meds).toHaveLength(1);
    expect(state.runs[0].status).toBe("RESET");
    expect(state.cases.length).toBeGreaterThan(0);
  });

  it("rejects a stale refill investigation result", async () => {
    const data = await setup("issuer|refill-stale-agent");
    await data.actor.mutation(api.refills.adjustVerifiedSupply, { assignmentId: data.assignment._id, count: 2 });
    const listed = await data.actor.query(api.refills.listForCaregiver, {});
    if (listed.status !== "ready" || !listed.cases[0]?.refillCase) throw new Error("Refill case missing");
    const refillCase = listed.cases[0].refillCase;
    await data.actor.mutation(api.agentRuns.requestRefillInvestigation, { refillCaseId: refillCase._id });
    const run = await data.root.mutation(internal.agentService.claimNext, { tokenHash: "refill-token", idempotencyKey: "refill-claim", now: Date.now(), leaseExpiresAt: Date.now() + 60_000 });
    if (!run) throw new Error("Run missing");
    await data.root.run(async (ctx) => ctx.db.patch("refillCases", refillCase._id, { caseVersion: refillCase.caseVersion + 1 }));
    const submitted = await data.root.mutation(internal.agentService.submitInvestigation, {
      runId: run.runId, tokenHash: "refill-token", now: Date.now(), idempotencyKey: "stale-refill-result", provider: "DETERMINISTIC_FALLBACK", model: null,
      findings: { items: [{ category: "POSSIBLE_SUPPLY_ISSUE", evidenceReferences: [`refillCase:${refillCase._id}`], uncertainty: "MEDIUM", explanation: "Low supply estimate." }], overallSummary: "Review supply.", proposedFollowUp: { actionType: "CHECK_PHYSICAL_SUPPLY", explanation: "Verify physically." } },
    });
    expect(submitted).toEqual({ ok: false, code: "STALE_CASE_VERSION" });
  });
});
