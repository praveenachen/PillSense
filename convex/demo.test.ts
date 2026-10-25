/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("synthetic dashboard showcase seed", () => {
  it("creates a varied, idempotent day without using position zero", async () => {
    const root = convexTest(schema, modules);
    const actor = root.withIdentity({ tokenIdentifier: "issuer|showcase", name: "Demo Caregiver" });
    await actor.mutation(api.demo.ensureCareTeam, {});

    const first = await actor.mutation(api.demo.ensureDashboardShowcase, { timezone: "America/Toronto" });
    const second = await actor.mutation(api.demo.ensureDashboardShowcase, { timezone: "America/Toronto" });

    expect(first.medicationsCreated).toBe(3);
    expect(first.occurrencesCreated).toBe(3);
    // The Iron Pills entry is skipped here because that medication only exists in a hand-created setup.
    expect(first.careCasesCreated).toBe(6);
    expect(first.legacyCareCasesRemoved).toBe(0);
    expect(second).toEqual({ medicationsCreated: 0, occurrencesCreated: 0, careCasesCreated: 0, legacyCareCasesRemoved: 0 });

    const seeded = await root.run(async (ctx) => {
      const medications = await ctx.db.query("medications").take(10);
      const assignments = await ctx.db.query("compartmentAssignments").take(10);
      const occurrences = (await ctx.db.query("doseOccurrences").take(20))
        .filter((occurrence) => occurrence.occurrenceKey.startsWith("dashboard-showcase:"));
      const careCases = await ctx.db.query("careCases").take(20);
      return { medications, assignments, occurrences, careCases };
    });

    expect(seeded.medications.map((medication) => medication.name).sort()).toEqual([
      "Magnesium",
      "Omega-3",
      "Vitamin D",
    ]);
    expect(new Set(seeded.assignments.map((assignment) => assignment.slot)).size).toBe(3);
    expect(seeded.assignments.every((assignment) => assignment.slot >= 1 && assignment.slot <= 7)).toBe(true);
    expect(seeded.occurrences.map((occurrence) => occurrence.ingestionReport)).toEqual(
      expect.arrayContaining(["TAKEN", "NOT_TAKEN", "UNREPORTED"]),
    );
    expect(seeded.careCases.map((careCase) => careCase.status).sort()).toEqual(["ACKNOWLEDGED", "OPEN", "RESOLVED", "RESOLVED", "RESOLVED", "RESOLVED"]);
    expect(seeded.careCases.every((careCase) => careCase.caseId.startsWith("dashboard-care-showcase:"))).toBe(true);
  });

  it("removes repetitive legacy reminder-demo cases without deleting investigated cases", async () => {
    const root = convexTest(schema, modules);
    const actor = root.withIdentity({ tokenIdentifier: "issuer|activity-cleanup", name: "Demo Caregiver" });
    await actor.mutation(api.demo.ensureCareTeam, {});
    await actor.mutation(api.demo.ensureDashboardShowcase, { timezone: "America/Toronto" });
    await actor.mutation(api.reminders.runDemoScenario, { scenario: "OVERDUE_ESCALATION" });

    const result = await actor.mutation(api.demo.ensureDashboardShowcase, { timezone: "America/Toronto" });
    // H6C automatically queues an investigation for the case, so cleanup must retain
    // both the case and its source occurrence as immutable audit evidence.
    expect(result.legacyCareCasesRemoved).toBe(0);
    const legacy = await root.run(async (ctx) => (await ctx.db.query("doseOccurrences").take(30)).filter((row) => row.occurrenceKey.startsWith("reminder-demo:")));
    expect(legacy).toHaveLength(1);
  });

  it("retires the old Iron Supplement demo medication and duplicate medications with the same name", async () => {
    const root = convexTest(schema, modules);
    const actor = root.withIdentity({ tokenIdentifier: "issuer|cleanup", name: "Demo Caregiver" });
    await actor.mutation(api.demo.ensureCareTeam, {});
    await actor.mutation(api.demo.ensureDashboardShowcase, { timezone: "America/Toronto" });
    await root.run(async (ctx) => {
      const [template] = await ctx.db.query("medications").take(1);
      const schedule = (await ctx.db.query("medicationSchedules").take(1))[0];
      const assignment = (await ctx.db.query("compartmentAssignments").take(1))[0];
      for (const name of ["Iron Supplement", template.name]) {
        const medicationId = await ctx.db.insert("medications", { ...template, _id: undefined, _creationTime: undefined, name, createdAt: Date.now() + 1000 } as never);
        await ctx.db.insert("medicationSchedules", { ...schedule, _id: undefined, _creationTime: undefined, medicationId } as never);
        await ctx.db.insert("compartmentAssignments", { ...assignment, _id: undefined, _creationTime: undefined, medicationId, slot: name === "Iron Supplement" ? 6 : 7 } as never);
      }
    });
    await actor.mutation(api.demo.ensureDashboardShowcase, { timezone: "America/Toronto" });
    const active = await root.run(async (ctx) => (await ctx.db.query("medications").take(20)).filter((medication) => medication.active).map((medication) => medication.name).sort());
    expect(active).toEqual(["Magnesium", "Omega-3", "Vitamin D"]);
  });

  it("rejects showcase seeding for a non-synthetic patient account", async () => {
    const root = convexTest(schema, modules);
    const actor = root.withIdentity({ tokenIdentifier: "issuer|real", name: "Real Patient" });
    await root.run(async (ctx) => {
      await ctx.db.insert("appUsers", {
        tokenIdentifier: "issuer|real",
        displayName: "Real Patient",
        role: "patient",
        isSynthetic: false,
        createdAt: Date.now(),
      });
    });

    await expect(actor.mutation(api.demo.ensureDashboardShowcase, { timezone: "America/Toronto" }))
      .rejects.toThrow("limited to authenticated synthetic caregiver demos");
  });
});
