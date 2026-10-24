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

    expect(first.medicationsCreated).toBe(4);
    expect(first.occurrencesCreated).toBe(4);
    expect(second).toEqual({ medicationsCreated: 0, occurrencesCreated: 0 });

    const seeded = await root.run(async (ctx) => {
      const medications = await ctx.db.query("medications").take(10);
      const assignments = await ctx.db.query("compartmentAssignments").take(10);
      const occurrences = (await ctx.db.query("doseOccurrences").take(20))
        .filter((occurrence) => occurrence.occurrenceKey.startsWith("dashboard-showcase:"));
      return { medications, assignments, occurrences };
    });

    expect(seeded.medications.map((medication) => medication.name).sort()).toEqual([
      "Iron Supplement",
      "Magnesium",
      "Omega-3",
      "Vitamin D",
    ]);
    expect(new Set(seeded.assignments.map((assignment) => assignment.slot)).size).toBe(4);
    expect(seeded.assignments.every((assignment) => assignment.slot >= 1 && assignment.slot <= 7)).toBe(true);
    expect(seeded.occurrences.map((occurrence) => occurrence.ingestionReport)).toEqual(
      expect.arrayContaining(["TAKEN", "NOT_TAKEN", "UNREPORTED"]),
    );
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
