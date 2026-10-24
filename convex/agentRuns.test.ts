/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const medication = {
  name: "Iron Pills",
  instructions: "Synthetic demo only",
  slot: 6,
  localTime: "09:00",
  weekdays: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as (
    | "SUN" | "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT"
  )[],
  timezone: "America/Toronto",
  demoInventory: 1,
};

async function setup(tokenIdentifier: string) {
  const root = convexTest(schema, modules);
  const actor = root.withIdentity({ tokenIdentifier, name: "Demo Caregiver" });
  await actor.mutation(api.demo.ensureCareTeam, {});
  const careTeam = await actor.query(api.caregiver.setup, {});
  if (careTeam.status !== "ready") throw new Error("Care team was not ready");
  await actor.mutation(api.medications.createWithAssignment, {
    ...medication,
    patientId: careTeam.patient.id,
  });
  await actor.mutation(api.reminders.runDemoScenario, { scenario: "OVERDUE_ESCALATION" });
  const cases = await actor.query(api.careCases.listForCaregiver, {});
  if (cases.status !== "ready" || !cases.cases[0]) throw new Error("Case missing");
  return { root, actor, careCase: cases.cases[0] };
}

async function claim(data: Awaited<ReturnType<typeof setup>>) {
  await data.actor.mutation(api.agentRuns.requestInvestigation, {
    careCaseId: data.careCase.id,
  });
  const claimed = await data.root.mutation(internal.agentService.claimNext, {
    tokenHash: "token-hash",
    idempotencyKey: "claim-key",
    now: Date.now(),
    leaseExpiresAt: Date.now() + 60_000,
  });
  if (!claimed) throw new Error("Run was not claimed");
  return claimed;
}

function validFindings(occurrenceId: string) {
  return {
    items: [{
      category: "NO_RECORDED_RESPONSE" as const,
      evidenceReferences: [`occurrence:${occurrenceId}`],
      uncertainty: "LOW" as const,
      explanation: "No response recorded.",
    }],
    overallSummary: "Synthetic finding.",
    proposedFollowUp: {
      actionType: "CONTACT_PATIENT" as const,
      explanation: "Use the established human follow-up process.",
    },
  };
}

describe("M4 persistent investigation runs", () => {
  it("prevents duplicate active runs and cross-caregiver access", async () => {
    const data = await setup("issuer|m4-owner");
    const first = await data.actor.mutation(api.agentRuns.requestInvestigation, {
      careCaseId: data.careCase.id,
    });
    const second = await data.actor.mutation(api.agentRuns.requestInvestigation, {
      careCaseId: data.careCase.id,
    });
    expect(second).toMatchObject({ runId: first.runId, created: false });

    const other = data.root.withIdentity({ tokenIdentifier: "issuer|m4-other" });
    await other.mutation(api.demo.ensureCareTeam, {});
    await expect(other.mutation(api.agentRuns.requestInvestigation, {
      careCaseId: data.careCase.id,
    })).rejects.toThrow("Patient access denied");
    const otherRuns = await other.query(api.agentRuns.listForCaregiver, {});
    expect(otherRuns.status).toBe("ready");
    expect(otherRuns.runs).toEqual([]);
  });

  it("enforces the five-call tool budget and action idempotency", async () => {
    const data = await setup("issuer|m4-budget");
    const run = await claim(data);
    const tools = [
      "get_dose_context",
      "get_dispense_history",
      "get_device_status",
      "get_inventory_context",
      "get_patient_reports",
    ] as const;
    for (const [index, toolName] of tools.entries()) {
      const result = await data.root.mutation(internal.agentService.consumeTool, {
        runId: run.runId,
        tokenHash: "token-hash",
        now: Date.now(),
        actionId: `action-${index}`,
        toolName,
      });
      expect(result.ok).toBe(true);
    }
    const duplicate = await data.root.mutation(internal.agentService.consumeTool, {
      runId: run.runId,
      tokenHash: "token-hash",
      now: Date.now(),
      actionId: "action-0",
      toolName: "get_dose_context",
    });
    expect(duplicate).toMatchObject({ ok: true, duplicate: true });
    const overBudget = await data.root.mutation(internal.agentService.consumeTool, {
      runId: run.runId,
      tokenHash: "token-hash",
      now: Date.now(),
      actionId: "action-6",
      toolName: "get_tray_observations",
    });
    expect(overBudget).toEqual({ ok: false, code: "TOOL_BUDGET_EXCEEDED" });
  });

  it("rejects stale case submissions without overwriting newer findings", async () => {
    const data = await setup("issuer|m4-stale");
    const run = await claim(data);
    await data.root.run(async (ctx) => {
      const careCase = await ctx.db.get("careCases", data.careCase.id);
      if (!careCase) throw new Error("Case missing");
      await ctx.db.patch("careCases", careCase._id, { caseVersion: careCase.caseVersion + 1 });
    });
    const result = await data.root.mutation(internal.agentService.submitInvestigation, {
      runId: run.runId,
      tokenHash: "token-hash",
      now: Date.now(),
      idempotencyKey: "stale-submit",
      provider: "DETERMINISTIC_FALLBACK",
      model: null,
      findings: {
        items: [{
          category: "NO_RECORDED_RESPONSE",
          evidenceReferences: [`occurrence:${data.careCase.occurrenceId}`],
          uncertainty: "LOW",
          explanation: "No response recorded.",
        }],
        overallSummary: "Synthetic finding.",
        proposedFollowUp: {
          actionType: "CONTACT_PATIENT",
          explanation: "Use the established human follow-up process.",
        },
      },
    });
    expect(result).toEqual({ ok: false, code: "STALE_CASE_VERSION" });
    const stored = await data.root.run((ctx) =>
      ctx.db.query("agentRuns").withIndex("by_runId", (q) => q.eq("runId", run.runId)).unique(),
    );
    expect(stored).toMatchObject({ status: "FAILED", findings: null });
  });

  it("rejects evidence references outside the authorized run scope", async () => {
    const data = await setup("issuer|m4-evidence");
    const run = await claim(data);
    const result = await data.root.mutation(internal.agentService.submitInvestigation, {
      runId: run.runId,
      tokenHash: "token-hash",
      now: Date.now(),
      idempotencyKey: "invalid-evidence",
      provider: "DETERMINISTIC_FALLBACK",
      model: null,
      findings: {
        items: [{
          category: "INSUFFICIENT_EVIDENCE",
          evidenceReferences: ["occurrence:another-patient"],
          uncertainty: "HIGH",
          explanation: "Invalid cross-scope reference.",
        }],
        overallSummary: "Must be rejected.",
        proposedFollowUp: { actionType: "NO_ACTION", explanation: "No action." },
      },
    });
    expect(result).toEqual({ ok: false, code: "INVALID_EVIDENCE_REFERENCE" });
  });

  it("deduplicates final submission without changing dose, inventory, or case status", async () => {
    const data = await setup("issuer|m4-submit-idempotency");
    const run = await claim(data);
    const before = await data.root.run(async (ctx) => {
      const occurrence = await ctx.db.get("doseOccurrences", data.careCase.occurrenceId);
      const assignment = (await ctx.db.query("compartmentAssignments").take(5))[0];
      const careCase = await ctx.db.get("careCases", data.careCase.id);
      return {
        report: occurrence?.ingestionReport,
        inventory: assignment.demoInventory,
        caseStatus: careCase?.status,
      };
    });
    const args = {
      runId: run.runId,
      tokenHash: "token-hash",
      now: Date.now(),
      idempotencyKey: "final-result",
      provider: "DETERMINISTIC_FALLBACK" as const,
      model: null,
      findings: validFindings(data.careCase.occurrenceId),
    };
    const first = await data.root.mutation(internal.agentService.submitInvestigation, args);
    const second = await data.root.mutation(internal.agentService.submitInvestigation, args);
    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(second).toMatchObject({ ok: true, duplicate: true });
    const after = await data.root.run(async (ctx) => {
      const occurrence = await ctx.db.get("doseOccurrences", data.careCase.occurrenceId);
      const assignment = (await ctx.db.query("compartmentAssignments").take(5))[0];
      const careCase = await ctx.db.get("careCases", data.careCase.id);
      const actions = await ctx.db.query("agentActions").take(10);
      return {
        report: occurrence?.ingestionReport,
        inventory: assignment.demoInventory,
        caseStatus: careCase?.status,
        submitActions: actions.filter((action) => action.toolName === "submit_investigation").length,
      };
    });
    expect(after).toEqual({ ...before, submitActions: 1 });
  });

  it("rejects prohibited agent action types at the Convex boundary", async () => {
    const data = await setup("issuer|m4-prohibited-action");
    const run = await claim(data);
    await expect(data.root.mutation(internal.agentService.submitInvestigation, {
      runId: run.runId,
      tokenHash: "token-hash",
      now: Date.now(),
      idempotencyKey: "prohibited-action",
      provider: "DETERMINISTIC_FALLBACK",
      model: null,
      findings: {
        ...validFindings(data.careCase.occurrenceId),
        proposedFollowUp: {
          actionType: "AUTO_DISPENSE",
          explanation: "Must be rejected.",
        },
      },
    } as never)).rejects.toThrow();
  });
});

describe("M4 service endpoint authentication", () => {
  beforeEach(() => vi.stubEnv("PILLSENSE_AGENT_SERVICE_SECRET", "test-service-secret"));
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a request with the wrong server-only secret", async () => {
    const root = convexTest(schema, modules);
    const response = await root.fetch("/agent/service", {
      method: "POST",
      headers: { authorization: "Bearer wrong-secret", "content-type": "application/json" },
      body: JSON.stringify({ operation: "claimRun", idempotencyKey: "claim" }),
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "SERVICE_AUTHENTICATION_FAILED" });
  });
});
