/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const tokenIdentifier = "issuer|h6c-cli";

describe("H6C development demo CLI backend", () => {
  beforeEach(() => {
    vi.stubEnv("PILLSENSE_DEMO_ENVIRONMENT", "development");
    vi.stubEnv("PILLSENSE_DEMO_OPERATOR_TOKEN_IDENTIFIER", tokenIdentifier);
    vi.stubEnv("WALGREENS_MODE", "mock");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("seeds idempotently and never uses slot zero", async () => {
    const root = convexTest(schema, modules);
    const actor = root.withIdentity({ tokenIdentifier, name: "Demo Caregiver" });
    await actor.mutation(api.demoCli.seed, {});
    await actor.mutation(api.demoCli.seed, {});
    const rows = await root.run(async (ctx) => ({
      medications: (await ctx.db.query("medications").take(20)).filter((row) => row.demoSeedKey),
      assignments: await ctx.db.query("compartmentAssignments").take(20),
      schedules: await ctx.db.query("medicationSchedules").take(20),
    }));
    expect(rows.medications).toHaveLength(2);
    expect(rows.assignments).toHaveLength(2);
    expect(rows.schedules).toHaveLength(2);
    expect(rows.assignments.every((row) => row.slot >= 1 && row.slot <= 7)).toBe(true);
  });

  it("creates repeatable missed-dose scenarios and preserves reset audit history", async () => {
    const root = convexTest(schema, modules);
    const actor = root.withIdentity({ tokenIdentifier, name: "Demo Caregiver" });
    await actor.mutation(api.demoCli.seed, {});
    const first = await actor.mutation(api.demoCli.prepareScenario, { scenario: "missed-dose" });
    const second = await actor.mutation(api.demoCli.prepareScenario, { scenario: "missed-dose" });
    expect(first.runId).not.toBe(second.runId);
    await actor.mutation(api.demoCli.reset, {});
    const audit = await root.run(async (ctx) => ctx.db.query("demoScenarioRuns").take(20));
    expect(audit).toHaveLength(2);
    expect(audit.every((run) => run.status === "RESET")).toBe(true);
  });

  it("advances missed-dose logic without hardware or pharmacy side effects", async () => {
    const root = convexTest(schema, modules);
    const actor = root.withIdentity({ tokenIdentifier, name: "Demo Caregiver" });
    await actor.mutation(api.demoCli.seed, {});
    const scenario = await actor.mutation(api.demoCli.prepareScenario, { scenario: "missed-dose" });
    expect(scenario.runId).toBeTruthy();
    const advanced = await actor.mutation(api.demoCli.advanceMissedDose, {});
    expect(advanced).toMatchObject({ state: "OVERDUE", syntheticAdvanceMinutes: 6 });
    const rows = await root.run(async (ctx) => ({
      cases: await ctx.db.query("careCases").take(10),
      runs: await ctx.db.query("agentRuns").take(10),
      commands: await ctx.db.query("dispenseCommands").take(10),
      checkouts: await ctx.db.query("walgreensCheckouts").take(10),
    }));
    expect(rows.cases).toHaveLength(1);
    expect(rows.runs).toHaveLength(1);
    expect(rows.commands).toHaveLength(0);
    expect(rows.checkouts).toHaveLength(0);
  });

  it("creates a fresh low-supply case, auto-queues one run, and falls back when the worker is offline", async () => {
    const root = convexTest(schema, modules);
    const actor = root.withIdentity({ tokenIdentifier, name: "Demo Caregiver" });
    await actor.mutation(api.demoCli.seed, {});
    const prepared = await actor.mutation(api.demoCli.prepareScenario, { scenario: "low-supply" });
    expect(prepared).toMatchObject({ ready: true, checkoutCreated: false });
    const before = await root.run(async (ctx) => ({
      cases: await ctx.db.query("refillCases").take(20),
      runs: await ctx.db.query("agentRuns").take(20),
      checkouts: await ctx.db.query("walgreensCheckouts").take(20),
    }));
    expect(before.cases).toHaveLength(1);
    expect(before.runs).toHaveLength(1);
    expect(before.runs[0]).toMatchObject({ workflowType: "REFILL_INVESTIGATION", status: "PENDING", source: "AUTOMATION" });
    expect(before.checkouts).toHaveLength(0);
    await root.mutation(internal.agentService.completePendingFallbacks, { now: Date.now() + 2 * 60_000 });
    const after = await root.run(async (ctx) => ctx.db.query("agentRuns").take(20));
    expect(after[0]).toMatchObject({ status: "COMPLETED", provider: "DETERMINISTIC_FALLBACK", model: "NON_LLM_FALLBACK" });
  });

  it("repeats low-supply preparation with a fresh case and retains the prior audit record", async () => {
    const root = convexTest(schema, modules);
    const actor = root.withIdentity({ tokenIdentifier, name: "Demo Caregiver" });
    await actor.mutation(api.demoCli.seed, {});
    const first = await actor.mutation(api.demoCli.prepareScenario, { scenario: "low-supply" });
    const second = await actor.mutation(api.demoCli.prepareScenario, { scenario: "low-supply" });
    expect(second.refillCaseId).not.toBe(first.refillCaseId);
    const rows = await root.run(async (ctx) => ({
      cases: await ctx.db.query("refillCases").take(20),
      runs: await ctx.db.query("refillDemoRuns").take(20),
      checkouts: await ctx.db.query("walgreensCheckouts").take(20),
    }));
    expect(rows.cases.map((row) => row.status).sort()).toEqual(["CLOSED", "OPEN"]);
    expect(rows.runs.filter((run) => run.status === "ACTIVE")).toHaveLength(1);
    expect(rows.runs.filter((run) => run.status === "RESET")).toHaveLength(1);
    expect(rows.checkouts).toHaveLength(0);
  });

  it("rejects production and a different authenticated identity", async () => {
    const root = convexTest(schema, modules);
    const actor = root.withIdentity({ tokenIdentifier, name: "Demo Caregiver" });
    vi.stubEnv("PILLSENSE_DEMO_ENVIRONMENT", "production");
    await expect(actor.mutation(api.demoCli.seed, {})).rejects.toThrow("disabled");
    vi.stubEnv("PILLSENSE_DEMO_ENVIRONMENT", "development");
    const stranger = root.withIdentity({ tokenIdentifier: "issuer|other", name: "Other" });
    await expect(stranger.mutation(api.demoCli.seed, {})).rejects.toThrow("not authorized");
  });
});
