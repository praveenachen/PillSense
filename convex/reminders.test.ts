/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
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
  return { root, actor, patientId: careTeam.patient.id };
}

describe("M3 deterministic reminders", () => {
  it("reconciles seven-day occurrences repeatedly without duplication", async () => {
    const data = await setup("issuer|m3-recurring");
    const first = await data.actor.mutation(api.reminders.reconcileMine, {});
    const second = await data.actor.mutation(api.reminders.reconcileMine, {});
    expect(first.created).toBeGreaterThan(0);
    expect(second.created).toBe(0);
    const counts = await data.root.run(async (ctx) => ({
      occurrences: (await ctx.db.query("doseOccurrences").take(100)).length,
      occurrenceKeys: (await ctx.db.query("doseOccurrences").take(100)).map((row) => row.occurrenceKey),
      reminderEvents: (await ctx.db.query("reminderEvents").take(100)).length,
    }));
    expect(new Set(counts.occurrenceKeys).size).toBe(counts.occurrences);
    expect(counts.reminderEvents).toBeLessThanOrEqual(counts.occurrences);
  });

  it("transitions controlled synthetic routines to due and overdue", async () => {
    const data = await setup("issuer|m3-transitions");
    const due = await data.actor.mutation(api.reminders.runDemoScenario, {
      scenario: "DUE_REMINDER",
    });
    expect(due.reminderState).toBe("DUE");
    const overdue = await data.actor.mutation(api.reminders.runDemoScenario, {
      scenario: "OVERDUE_ESCALATION",
    });
    expect(overdue.reminderState).toBe("OVERDUE");
    const patient = await data.actor.query(api.reminders.forPatient, {});
    expect(patient.reminders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ occurrenceId: due.occurrenceId, state: "DUE" }),
        expect.objectContaining({ occurrenceId: overdue.occurrenceId, state: "OVERDUE" }),
      ]),
    );
  });

  it("does not duplicate reminder events or cases on repeated scheduled checks", async () => {
    const data = await setup("issuer|m3-idempotent-alert");
    const scenario = await data.actor.mutation(api.reminders.runDemoScenario, {
      scenario: "OVERDUE_ESCALATION",
    });
    await data.actor.mutation(api.reminders.reconcileMine, {});
    await data.actor.mutation(api.reminders.reconcileMine, {});
    const counts = await data.root.run(async (ctx) => ({
      cases: (await ctx.db
        .query("careCases")
        .withIndex("by_occurrence", (q) => q.eq("occurrenceId", scenario.occurrenceId))
        .take(5)).length,
      overdueEvents: (await ctx.db
        .query("reminderEvents")
        .withIndex("by_occurrence", (q) => q.eq("occurrenceId", scenario.occurrenceId))
        .take(10)).filter((event) => event.state === "OVERDUE").length,
    }));
    expect(counts).toEqual({ cases: 1, overdueEvents: 1 });
  });

  it("preserves explicit TAKEN and NOT_TAKEN reports", async () => {
    const taken = await setup("issuer|m3-taken");
    const takenScenario = await taken.actor.mutation(api.reminders.runDemoScenario, {
      scenario: "OVERDUE_ESCALATION",
    });
    await taken.actor.mutation(api.dispensing.reportIngestion, {
      occurrenceId: takenScenario.occurrenceId,
      report: "TAKEN",
    });
    const takenRecord = await taken.root.run((ctx) =>
      ctx.db.get("doseOccurrences", takenScenario.occurrenceId),
    );
    expect(takenRecord).toMatchObject({ ingestionReport: "TAKEN", reminderState: "RESOLVED" });

    const notTaken = await setup("issuer|m3-not-taken");
    const notTakenScenario = await notTaken.actor.mutation(api.reminders.runDemoScenario, {
      scenario: "OVERDUE_ESCALATION",
    });
    await notTaken.actor.mutation(api.dispensing.reportIngestion, {
      occurrenceId: notTakenScenario.occurrenceId,
      report: "NOT_TAKEN",
    });
    const alerts = await notTaken.actor.query(api.careCases.listForCaregiver, {});
    expect(alerts.status).toBe("ready");
    expect(alerts.cases[0]).toMatchObject({
      triggerReason: "PATIENT_REPORTED_NOT_TAKEN",
      evidenceReferences: { patientReport: "NOT_TAKEN" },
    });
  });

  it("treats motor completion as evidence, never confirmed ingestion", async () => {
    const data = await setup("issuer|m3-motor-only");
    const scenario = await data.actor.mutation(api.reminders.runDemoScenario, {
      scenario: "OVERDUE_ESCALATION",
    });
    await data.actor.mutation(api.device.connectMock, {});
    await data.actor.mutation(api.device.confirmMockHome, {});
    const command = await data.actor.mutation(api.dispensing.authorize, {
      occurrenceId: scenario.occurrenceId,
    });
    await data.actor.mutation(api.dispensing.markDispatched, { commandId: command.commandId });
    await data.actor.mutation(api.dispensing.ingestMockEvent, {
      eventId: `${command.commandId}:MOTOR_COMPLETED`,
      commandId: command.commandId,
      type: "MOTOR_COMPLETED",
      occurredAt: Date.now(),
    });
    const occurrence = await data.root.run((ctx) =>
      ctx.db.get("doseOccurrences", scenario.occurrenceId),
    );
    expect(occurrence?.ingestionReport).toBe("UNREPORTED");
    const alerts = await data.actor.query(api.careCases.listForCaregiver, {});
    expect(alerts.status).toBe("ready");
    expect(alerts.cases[0]?.triggerReason).toBe("MOTOR_COMPLETED_INGESTION_UNCONFIRMED");
  });
});

describe("M3 care case safety", () => {
  it("isolates cases between caregivers and rejects cross-patient updates", async () => {
    const owner = await setup("issuer|m3-owner");
    await owner.actor.mutation(api.reminders.runDemoScenario, {
      scenario: "DEVICE_UNRESOLVED",
    });
    const ownerCases = await owner.actor.query(api.careCases.listForCaregiver, {});
    if (ownerCases.status !== "ready" || !ownerCases.cases[0]) throw new Error("Case missing");

    const other = owner.root.withIdentity({ tokenIdentifier: "issuer|m3-other" });
    await other.mutation(api.demo.ensureCareTeam, {});
    const otherCases = await other.query(api.careCases.listForCaregiver, {});
    expect(otherCases.status).toBe("ready");
    expect(otherCases.cases).toEqual([]);
    await expect(other.mutation(api.careCases.updateStatus, {
      careCaseId: ownerCases.cases[0].id,
      action: "ACKNOWLEDGE",
      note: "Should not be accepted",
      outcome: "FOLLOW_UP_REQUIRED",
    })).rejects.toThrow("Patient access denied");
  });

  it("acknowledges a case without changing inventory or ingestion", async () => {
    const data = await setup("issuer|m3-ack");
    const scenario = await data.actor.mutation(api.reminders.runDemoScenario, {
      scenario: "OVERDUE_ESCALATION",
    });
    const alerts = await data.actor.query(api.careCases.listForCaregiver, {});
    if (alerts.status !== "ready" || !alerts.cases[0]) throw new Error("Case missing");
    const before = await data.root.run(async (ctx) => {
      const assignment = (await ctx.db.query("compartmentAssignments").take(10))[0];
      const occurrence = await ctx.db.get("doseOccurrences", scenario.occurrenceId);
      return { inventory: assignment.demoInventory, report: occurrence?.ingestionReport };
    });
    await data.actor.mutation(api.careCases.updateStatus, {
      careCaseId: alerts.cases[0].id,
      action: "ACKNOWLEDGE",
      note: "Calling the patient",
      outcome: "FOLLOW_UP_REQUIRED",
    });
    const after = await data.root.run(async (ctx) => {
      const assignment = (await ctx.db.query("compartmentAssignments").take(10))[0];
      const occurrence = await ctx.db.get("doseOccurrences", scenario.occurrenceId);
      return { inventory: assignment.demoInventory, report: occurrence?.ingestionReport };
    });
    expect(after).toEqual(before);
  });

  it("resolves stale schedule cases once and does not duplicate transitions", async () => {
    const data = await setup("issuer|m3-stale");
    const scenario = await data.actor.mutation(api.reminders.runDemoScenario, {
      scenario: "OVERDUE_ESCALATION",
    });
    await data.root.run(async (ctx) => {
      const occurrence = await ctx.db.get("doseOccurrences", scenario.occurrenceId);
      if (!occurrence) throw new Error("Occurrence missing");
      await ctx.db.patch("medicationSchedules", occurrence.scheduleId, {
        revision: occurrence.scheduleRevision + 1,
      });
    });
    await data.actor.mutation(api.reminders.reconcileMine, {});
    await data.actor.mutation(api.reminders.reconcileMine, {});
    const result = await data.root.run(async (ctx) => {
      const careCase = await ctx.db
        .query("careCases")
        .withIndex("by_occurrence", (q) => q.eq("occurrenceId", scenario.occurrenceId))
        .unique();
      if (!careCase) throw new Error("Case missing");
      const transitions = await ctx.db
        .query("careCaseTransitions")
        .withIndex("by_case", (q) => q.eq("caseId", careCase._id))
        .take(20);
      return { status: careCase.status, resolved: transitions.filter((row) => row.type === "RESOLVED").length };
    });
    expect(result).toEqual({ status: "RESOLVED", resolved: 1 });
  });

  it("resets only synthetic scenario state while retaining audit records", async () => {
    const data = await setup("issuer|m3-reset");
    await data.actor.mutation(api.reminders.runDemoScenario, {
      scenario: "OVERDUE_ESCALATION",
    });
    await expect(data.actor.mutation(api.reminders.resetDemoScenarios, {})).resolves.toEqual({ reset: 1 });
    const retained = await data.root.run(async (ctx) => ({
      runs: (await ctx.db.query("demoScenarioRuns").take(10)).length,
      occurrences: (await ctx.db.query("doseOccurrences").take(10)).length,
      cases: (await ctx.db.query("careCases").take(10)).length,
      activeRuns: (await ctx.db.query("demoScenarioRuns").take(10)).filter((run) => run.status === "ACTIVE").length,
    }));
    expect(retained).toMatchObject({ runs: 1, occurrences: 1, cases: 1, activeRuns: 0 });
  });
});
