/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ALLOWED = `agent1${"a".repeat(60)}`;

async function setup(tokenIdentifier: string) {
  const root = convexTest(schema, modules);
  const actor = root.withIdentity({ tokenIdentifier, name: "Demo Caregiver" });
  await actor.mutation(api.demo.ensureCareTeam, {});
  const careTeam = await actor.query(api.caregiver.setup, {});
  if (careTeam.status !== "ready") throw new Error("Care team was not ready");
  await actor.mutation(api.medications.createWithAssignment, {
    name: "Iron Pills",
    instructions: "Synthetic demo only",
    slot: 6,
    localTime: "09:00",
    weekdays: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
    timezone: "America/Toronto",
    demoInventory: 1,
    patientId: careTeam.patient.id,
  });
  await actor.mutation(api.reminders.runDemoScenario, { scenario: "OVERDUE_ESCALATION" });
  const cases = await actor.query(api.careCases.listForCaregiver, {});
  if (cases.status !== "ready" || !cases.cases[0]) throw new Error("Case missing");
  const authorization = await actor.mutation(api.agentverse.preauthorizeDemoCase, {
    careCaseId: cases.cases[0].id,
  });
  return { root, actor, careCase: cases.cases[0], alias: authorization.alias };
}

function requestArgs(alias: string, requestId = "018f47a8-9abc-7def-8123-123456789abc") {
  const now = Date.now();
  return {
    expectedSender: ALLOWED,
    sourceAgentAddress: ALLOWED,
    transport: "UAGENT_A2A" as const,
    protocolVersion: "1.0",
    requestId,
    requestType: "DEMO_ADHERENCE_INVESTIGATION",
    caseAlias: alias,
    sentAt: now,
    now,
  };
}

describe("M7 Agentverse care-request boundary", () => {
  it("routes a caregiver-scoped refill request through the existing coordinator run", async () => {
    const data = await setup("issuer|agentverse-refill");
    const assignment = await data.root.run(async (ctx) => (await ctx.db.query("compartmentAssignments").take(1))[0]);
    await data.actor.mutation(api.refills.adjustVerifiedSupply, { assignmentId: assignment._id, count: 2 });
    const listed = await data.actor.query(api.refills.listForCaregiver, {});
    if (listed.status !== "ready" || !listed.cases[0]?.refillCase) throw new Error("Refill case missing");
    const refillCaseId = listed.cases[0].refillCase._id;
    const authorization = await data.actor.mutation(api.agentverse.preauthorizeRefillCase, { refillCaseId });
    const args = { ...requestArgs(authorization.alias, "018f47a8-9abc-7def-8123-123456789acf"), requestType: "DEMO_REFILL_STATUS" };
    expect(await data.root.mutation(internal.agentverseService.acceptRequest, {
      ...args, sourceAgentAddress: `agent1${"x".repeat(60)}`,
    })).toMatchObject({ ok: false, code: "SENDER_NOT_ALLOWED" });
    const accepted = await data.root.mutation(internal.agentverseService.acceptRequest, args);
    expect(accepted).toMatchObject({ ok: true, status: "ACK" });
    if (!accepted.ok) throw new Error("Refill request not accepted");
    const run = await data.root.run((ctx) => ctx.db.get("agentRuns", accepted.linkedRunId));
    expect(run).toMatchObject({ refillCaseId, workflowType: "REFILL_INVESTIGATION", source: "AUTOMATION" });
    await data.root.run((ctx) => ctx.db.patch("agentRuns", accepted.linkedRunId, {
      status: "COMPLETED", provider: "DETERMINISTIC_FALLBACK", completedAt: Date.now(),
    }));
    const syncArgs = { expectedSender: ALLOWED, sourceAgentAddress: ALLOWED,
      transport: "UAGENT_A2A" as const, requestId: args.requestId, now: Date.now() };
    expect(await data.root.mutation(internal.agentverseService.syncRequest, syncArgs))
      .toMatchObject({ status: "COMPLETED", outcomeCode: "REFILL_RECOMMENDED" });
    await data.root.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("walgreensCheckouts", {
        refillCaseId, patientId: run!.patientId, caregiverId: run!.requestedBy,
        provider: "WALGREENS", environment: "MOCK", status: "CHECKOUT_READY",
        approvedAt: now, updatedAt: now,
      });
    });
    expect(await data.root.mutation(internal.agentverseService.syncRequest, syncArgs))
      .toMatchObject({ status: "COMPLETED", outcomeCode: "CHECKOUT_READY" });
    const scope = await data.root.run((ctx) => ctx.db.query("agentverseScopes")
      .withIndex("by_alias", (q) => q.eq("alias", authorization.alias)).unique());
    if (!scope) throw new Error("Scope missing");
    await data.actor.mutation(api.agentverse.revokeDemoScope, { scopeId: scope._id });
    expect(await data.root.mutation(internal.agentverseService.syncRequest, syncArgs))
      .toMatchObject({ ok: false, code: "REQUEST_NOT_AUTHORIZED" });
  });
  it("does not reuse a completed refill run from an older case version", async () => {
    const data = await setup("issuer|agentverse-stale-run");
    const assignment = await data.root.run(async (ctx) => (await ctx.db.query("compartmentAssignments").take(1))[0]);
    await data.actor.mutation(api.refills.adjustVerifiedSupply, { assignmentId: assignment._id, count: 2 });
    const listed = await data.actor.query(api.refills.listForCaregiver, {});
    if (listed.status !== "ready" || !listed.cases[0]?.refillCase) throw new Error("Refill case missing");
    const refillCaseId = listed.cases[0].refillCase._id;
    const authorization = await data.actor.mutation(api.agentverse.preauthorizeRefillCase, { refillCaseId });
    const first = { ...requestArgs(authorization.alias, "018f47a8-9abc-7def-8123-123456789ad0"), requestType: "DEMO_REFILL_STATUS" };
    const accepted = await data.root.mutation(internal.agentverseService.acceptRequest, first);
    if (!accepted.ok) throw new Error("First request not accepted");
    await data.root.run((ctx) => ctx.db.patch("agentRuns", accepted.linkedRunId, { status: "COMPLETED", provider: "DETERMINISTIC_FALLBACK", completedAt: Date.now() }));

    // Same case at the same version: the completed run is reused.
    const sameVersion = await data.root.mutation(internal.agentverseService.acceptRequest, { ...first, requestId: "018f47a8-9abc-7def-8123-123456789ad1" });
    expect(sameVersion).toMatchObject({ ok: true, linkedRunId: accepted.linkedRunId });

    // The case changes (new version): the old completed run no longer describes it, so a fresh run is created.
    const version = await data.root.run(async (ctx) => {
      const current = await ctx.db.get("refillCases", refillCaseId);
      await ctx.db.patch("refillCases", refillCaseId, { caseVersion: current!.caseVersion + 1 });
      return current!.caseVersion + 1;
    });
    const newer = await data.root.mutation(internal.agentverseService.acceptRequest, { ...first, requestId: "018f47a8-9abc-7def-8123-123456789ad2" });
    if (!newer.ok) throw new Error("Newer request not accepted");
    expect(newer.linkedRunId).not.toBe(accepted.linkedRunId);
    const freshRun = await data.root.run((ctx) => ctx.db.get("agentRuns", newer.linkedRunId));
    expect(freshRun).toMatchObject({ caseVersion: version, status: "PENDING" });
  });
  it("requires an authenticated caregiver to pre-authorize a synthetic case", async () => {
    const data = await setup("issuer|agentverse-owner");
    const other = data.root.withIdentity({ tokenIdentifier: "issuer|agentverse-other" });
    await other.mutation(api.demo.ensureCareTeam, {});
    await expect(other.mutation(api.agentverse.preauthorizeDemoCase, {
      careCaseId: data.careCase.id,
    })).rejects.toThrow("Patient access denied");
    await expect(data.root.mutation(api.agentverse.preauthorizeDemoCase, {
      careCaseId: data.careCase.id,
    })).rejects.toThrow("Authentication required");
  });

  it("rejects an unallowlisted sender before creating a request or run", async () => {
    const data = await setup("issuer|agentverse-sender");
    const result = await data.root.mutation(internal.agentverseService.acceptRequest, {
      ...requestArgs(data.alias),
      sourceAgentAddress: `agent1${"x".repeat(60)}`,
    });
    expect(result).toEqual({ ok: false, code: "SENDER_NOT_ALLOWED" });
    const counts = await data.root.run(async (ctx) => ({
      requests: (await ctx.db.query("agentverseRequests").take(5)).length,
      runs: (await ctx.db.query("agentRuns").take(5)).length,
    }));
    expect(counts).toEqual({ requests: 0, runs: 1 });
  });

  it("resolves only a pre-authorized alias and hands off to one persisted run", async () => {
    const data = await setup("issuer|agentverse-handoff");
    const first = await data.root.mutation(
      internal.agentverseService.acceptRequest,
      requestArgs(data.alias),
    );
    expect(first).toMatchObject({ ok: true, status: "ACK", duplicate: false });
    const stored = await data.root.run(async (ctx) => {
      const requests = await ctx.db.query("agentverseRequests").take(5);
      const runs = await ctx.db.query("agentRuns").take(5);
      return { request: requests[0], run: runs[0] };
    });
    expect(stored.request).toMatchObject({
      sourceAgentAddress: ALLOWED,
      transport: "UAGENT_A2A",
      careCaseId: data.careCase.id,
      status: "ACK",
    });
    expect(stored.run).toMatchObject({
      careCaseId: data.careCase.id,
      source: "AUTOMATION",
      status: "PENDING",
    });
    expect(stored.request.agentRunId).toBe(stored.run._id);
  });

  it("accepts a signed ACP source only through the server bridge and the preauthorized alias", async () => {
    const data = await setup("issuer|asi-one-handoff");
    const asiSource = `agent1${"s".repeat(60)}`;
    const result = await data.root.mutation(internal.agentverseService.acceptRequest, {
      ...requestArgs(data.alias, "018f47a8-9abc-7def-8123-123456789abe"),
      expectedSender: asiSource,
      sourceAgentAddress: asiSource,
      transport: "ASI_ONE_ACP",
    });
    expect(result).toMatchObject({ ok: true, status: "ACK" });
    const stored = await data.root.run((ctx) =>
      ctx.db.query("agentverseRequests").withIndex("by_requestKey", (q) =>
        q.eq("requestKey", `${asiSource}:018f47a8-9abc-7def-8123-123456789abe`),
      ).unique(),
    );
    expect(stored).toMatchObject({
      transport: "ASI_ONE_ACP",
      caseAlias: data.alias,
      careCaseId: data.careCase.id,
    });
  });

  it("rejects replayed request IDs without creating a duplicate run", async () => {
    const data = await setup("issuer|agentverse-replay");
    const args = requestArgs(data.alias);
    await data.root.mutation(internal.agentverseService.acceptRequest, args);
    const replay = await data.root.mutation(internal.agentverseService.acceptRequest, args);
    expect(replay).toMatchObject({
      ok: false,
      code: "REPLAY_REJECTED",
      duplicate: true,
    });
    const counts = await data.root.run(async (ctx) => ({
      requests: (await ctx.db.query("agentverseRequests").take(5)).length,
      runs: (await ctx.db.query("agentRuns").take(5)).length,
    }));
    expect(counts).toEqual({ requests: 1, runs: 1 });
  });

  it("rejects an alias when the caregiver-authorized case is no longer open", async () => {
    const data = await setup("issuer|agentverse-stale-case");
    await data.root.run(async (ctx) => {
      await ctx.db.patch("careCases", data.careCase.id, { status: "RESOLVED" });
    });
    const result = await data.root.mutation(
      internal.agentverseService.acceptRequest,
      requestArgs(data.alias),
    );
    expect(result).toEqual({ ok: false, code: "AUTHORIZED_CASE_UNAVAILABLE" });
  });

  it("correlates completion to the linked coordinator run", async () => {
    const data = await setup("issuer|agentverse-completion");
    const requestId = "018f47a8-9abc-7def-8123-123456789abd";
    const accepted = await data.root.mutation(
      internal.agentverseService.acceptRequest,
      requestArgs(data.alias, requestId),
    );
    if (!accepted.ok) throw new Error("Request was not accepted");
    await data.root.run(async (ctx) => {
      await ctx.db.patch("agentRuns", accepted.linkedRunId, {
        status: "COMPLETED",
        provider: "DETERMINISTIC_FALLBACK",
        completedAt: Date.now(),
      });
    });
    const synced = await data.root.mutation(internal.agentverseService.syncRequest, {
      expectedSender: ALLOWED,
      sourceAgentAddress: ALLOWED,
      transport: "UAGENT_A2A",
      requestId,
      now: Date.now(),
    });
    expect(synced).toMatchObject({
      ok: true,
      status: "COMPLETED",
      outcomeCode: "INVESTIGATION_AVAILABLE",
      linkedRunStatus: "COMPLETED",
    });
  });
});
