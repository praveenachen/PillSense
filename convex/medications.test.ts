/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Weekday } from "./lib/medicationValidation";

const modules = import.meta.glob("./**/*.ts");
const baseMedication = {
  name: "Iron Pills",
  instructions: "Synthetic demo record only",
  slot: 6,
  localTime: "09:00",
  weekdays: ["MON", "TUE", "WED", "THU", "FRI"] as Weekday[],
  timezone: "America/Toronto",
  demoInventory: 1,
};

async function createCareTeam(tokenIdentifier: string) {
  const root = convexTest(schema, modules);
  const actor = root.withIdentity({ tokenIdentifier, name: "Demo Caregiver" });
  await actor.mutation(api.demo.ensureCareTeam, {});
  const setup = await actor.query(api.caregiver.setup, {});
  if (setup.status !== "ready") {
    throw new Error("Expected a ready care team");
  }
  return {
    root,
    actor,
    patientId: setup.patient.id,
    deviceId: setup.device.id,
  };
}

describe("medication assignment security and validation", () => {
  it("saves scanned OTC details in the existing medication and slot without creating a schedule", async () => {
    const { root, actor, patientId } = await createCareTeam("issuer|unscheduled-otc");
    const saved = await actor.mutation(api.medications.createWithAssignment, {
      ...baseMedication, patientId, name: "Advil 200 mg tablet", instructions: "", scheduled: false,
      productDetails: { brand: "Advil", activeIngredient: "ibuprofen", strength: "200 mg", dosageForm: "tablet", otherVisibleDetails: [] },
    });
    const schedules = await root.run((ctx) => ctx.db.query("medicationSchedules").withIndex("by_medication", (q) => q.eq("medicationId", saved.medicationId)).take(2));
    expect(schedules).toHaveLength(0);
    const setup = await actor.query(api.caregiver.setup, {});
    const dashboard = await actor.query(api.patient.dashboard, {});
    expect(setup.status === "ready" && setup.medications[0]).toMatchObject({ name: "Advil 200 mg tablet", localTime: null, productDetails: { activeIngredient: "ibuprofen" } });
    expect(dashboard.status === "ready" && dashboard.medications[0]).toMatchObject({ name: "Advil 200 mg tablet", localTime: null });
    const forecast = await actor.query(api.refills.listForCaregiver, {});
    expect(forecast.status === "ready" && forecast.cases[0]?.forecast.triggerReason).toBeNull();
  });

  it("renders a new active unscheduled Slot 4 assignment despite older inactive history", async () => {
    const { root, actor, patientId, deviceId } = await createCareTeam(
      "issuer|slot-four-history",
    );

    await root.run(async (ctx) => {
      const caregiver = await ctx.db
        .query("appUsers")
        .withIndex("by_tokenIdentifier", (q) =>
          q.eq("tokenIdentifier", "issuer|slot-four-history"),
        )
        .unique();
      if (!caregiver) throw new Error("Expected caregiver");

      const oldMedicationId = await ctx.db.insert("medications", {
        patientId,
        name: "Inactive historical medication",
        instructions: "",
        active: false,
        createdBy: caregiver._id,
        createdAt: 1,
      });
      for (let index = 0; index < 7; index += 1) {
        await ctx.db.insert("compartmentAssignments", {
          deviceId,
          patientId,
          medicationId: oldMedicationId,
          slot: index === 0 ? 4 : (index % 7) + 1,
          demoInventory: 0,
          active: false,
          assignedBy: caregiver._id,
          createdAt: index + 1,
        });
      }
    });

    const saved = await actor.mutation(api.medications.createWithAssignment, {
      ...baseMedication,
      patientId,
      name: "Magnesium",
      slot: 4,
      instructions: "",
      scheduled: false,
      supplyCount: 50,
    });
    expect(saved.slot).toBe(4);

    const afterSave = await actor.query(api.patient.dashboard, {});
    const afterRefresh = await actor.query(api.patient.dashboard, {});
    const setup = await actor.query(api.caregiver.setup, {});

    expect(afterSave.status).toBe("ready");
    expect(afterSave.status === "ready" ? afterSave.medications : []).toEqual([
      expect.objectContaining({
        name: "Magnesium",
        slot: 4,
        supplyCount: 50,
        localTime: null,
      }),
    ]);
    expect(afterRefresh).toEqual(afterSave);
    expect(setup.status === "ready" ? setup.medications : []).toEqual([
      expect.objectContaining({ name: "Magnesium", slot: 4, localTime: null }),
    ]);
  });

  it("rejects reserved position 0", async () => {
    const { actor, patientId } = await createCareTeam("issuer|slot-zero");

    await expect(
      actor.mutation(api.medications.createWithAssignment, {
        ...baseMedication,
        patientId,
        slot: 0,
      }),
    ).rejects.toThrow("position 0 is reserved for home");
  });

  it("rejects a duplicate active slot assignment", async () => {
    const { root, actor, patientId } = await createCareTeam("issuer|duplicate");
    await actor.mutation(api.medications.createWithAssignment, {
      ...baseMedication,
      patientId,
    });

    await expect(
      actor.mutation(api.medications.createWithAssignment, {
        ...baseMedication,
        patientId,
        name: "Second medication",
      }),
    ).rejects.toThrow("Slot 6 already has an active medication assignment");

    const medications = await root.run((ctx) =>
      ctx.db
        .query("medications")
        .withIndex("by_patient", (q) => q.eq("patientId", patientId))
        .collect(),
    );
    expect(medications.filter((medication) => medication.active)).toHaveLength(1);
  });

  it("denies signed-out reads and writes", async () => {
    const { root, patientId } = await createCareTeam("issuer|auth-owner");

    await expect(root.query(api.patient.dashboard, {})).rejects.toThrow(
      "Authentication required",
    );
    await expect(
      root.mutation(api.medications.createWithAssignment, {
        ...baseMedication,
        patientId,
      }),
    ).rejects.toThrow("Authentication required");
  });

  it("enforces the caregiver-patient relationship", async () => {
    const root = convexTest(schema, modules);
    const caregiverA = root.withIdentity({ tokenIdentifier: "issuer|caregiver-a" });
    const caregiverB = root.withIdentity({ tokenIdentifier: "issuer|caregiver-b" });
    await caregiverA.mutation(api.demo.ensureCareTeam, {});
    await caregiverB.mutation(api.demo.ensureCareTeam, {});
    const setupA = await caregiverA.query(api.caregiver.setup, {});
    if (setupA.status !== "ready") {
      throw new Error("Expected caregiver A to have a patient");
    }

    await expect(
      caregiverA.query(api.caregiver.canAccessPatient, { patientId: setupA.patient.id }),
    ).resolves.toBe(true);
    await expect(
      caregiverB.query(api.caregiver.canAccessPatient, { patientId: setupA.patient.id }),
    ).resolves.toBe(false);
    await expect(
      caregiverB.mutation(api.medications.createWithAssignment, {
        ...baseMedication,
        patientId: setupA.patient.id,
      }),
    ).rejects.toThrow("Patient access denied");
  });

  it("validates local time, weekdays, and IANA timezone", async () => {
    const { actor, patientId } = await createCareTeam("issuer|schedule");

    await expect(
      actor.mutation(api.medications.createWithAssignment, {
        ...baseMedication,
        patientId,
        localTime: "25:00",
      }),
    ).rejects.toThrow("valid local time");
    await expect(
      actor.mutation(api.medications.createWithAssignment, {
        ...baseMedication,
        patientId,
        weekdays: [],
      }),
    ).rejects.toThrow("Select at least one weekday");
    await expect(
      actor.mutation(api.medications.createWithAssignment, {
        ...baseMedication,
        patientId,
        timezone: "Not/A_Timezone",
      }),
    ).rejects.toThrow("valid IANA timezone");
  });
});
