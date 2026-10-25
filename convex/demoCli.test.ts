/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const tokenIdentifier = "issuer|h6c-cli";

/** The baseline's Magnesium is intentionally low. Raise it so a low-supply scenario test sees only its own Advil case. */
async function raiseMagnesiumSupply(root: ReturnType<typeof convexTest>) {
  await root.run(async (ctx) => {
    const magnesium = (await ctx.db.query("medications").take(50)).find((row) => row.name === "Magnesium")!;
    const assignment = (await ctx.db.query("compartmentAssignments").take(50)).find((row) => row.medicationId === magnesium._id)!;
    await ctx.db.patch("compartmentAssignments", assignment._id, { estimatedSupplyCount: 30 });
  });
}

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
    expect(rows.medications).toHaveLength(5);
    expect(rows.assignments).toHaveLength(5);
    expect(rows.schedules).toHaveLength(5);
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

  it("seeds one currently due Iron Pills reminder for Home without arming or dispatching hardware", async () => {
    const root = convexTest(schema, modules);
    const actor = root.withIdentity({ tokenIdentifier, name: "Demo Caregiver" });
    const first = await actor.mutation(api.demoCli.seed, { prepareVoiceReminder: true });
    const second = await actor.mutation(api.demoCli.seed, { prepareVoiceReminder: true });
    expect(first.voiceReminder).toMatchObject({ status: "READY", slot: 6 });
    expect(second.voiceReminder?.occurrenceId).toBe(first.voiceReminder?.occurrenceId);
    const listed = await actor.query(api.occurrences.listForPatient, { now: Date.now() });
    const dose = listed.occurrences.find((row) => row.id === first.voiceReminder?.occurrenceId);
    expect(dose).toMatchObject({ medicationName: "Iron Pills", slot: 6, attemptStatus: "NONE", ingestionReport: "UNREPORTED" });
    expect(dose!.eligibleFrom).toBeLessThanOrEqual(Date.now());
    expect(dose!.expiresAt).toBeGreaterThan(Date.now());
    const evidence = await root.run(async (ctx) => ({
      runs: await ctx.db.query("demoScenarioRuns").take(10),
      commands: await ctx.db.query("dispenseCommands").take(10),
      arms: await ctx.db.query("hardwareDemoArms").take(10),
    }));
    expect(evidence.runs).toHaveLength(1);
    expect(evidence.commands).toHaveLength(0);
    expect(evidence.arms).toHaveLength(0);
  });

  it("refreshes only an expired unattempted seeded reminder while retaining its audit history", async () => {
    const root = convexTest(schema, modules);
    const actor = root.withIdentity({ tokenIdentifier, name: "Demo Caregiver" });
    const first = await actor.mutation(api.demoCli.seed, { prepareVoiceReminder: true });
    const oldId = first.voiceReminder!.occurrenceId!;
    await root.run((ctx) => ctx.db.patch("doseOccurrences", oldId, { expiresAt: Date.now() - 1 }));
    const refreshed = await actor.mutation(api.demoCli.seed, { prepareVoiceReminder: true });
    expect(refreshed.voiceReminder?.status).toBe("READY");
    expect(refreshed.voiceReminder?.occurrenceId).not.toBe(oldId);
    const old = await root.run((ctx) => ctx.db.get("doseOccurrences", oldId));
    expect(old?.reminderState).toBe("RESOLVED");
  });

  it.each(["COMPLETED", "UNKNOWN"] as const)("does not replace a %s hardware attempt when seeding the voice reminder", async (attemptStatus) => {
    const root = convexTest(schema, modules);
    const actor = root.withIdentity({ tokenIdentifier, name: "Demo Caregiver" });
    const first = await actor.mutation(api.demoCli.seed, { prepareVoiceReminder: true });
    const oldId = first.voiceReminder!.occurrenceId!;
    await root.run((ctx) => ctx.db.patch("doseOccurrences", oldId, { attemptStatus, expiresAt: Date.now() - 1 }));
    const repeated = await actor.mutation(api.demoCli.seed, { prepareVoiceReminder: true });
    expect(repeated.voiceReminder).toMatchObject({ status: "ALREADY_ATTEMPTED", occurrenceId: oldId });
    expect(await root.run((ctx) => ctx.db.query("demoScenarioRuns").take(10))).toHaveLength(1);
  });

  it("creates the successful-dose reminder for the fixed Slot 6 Iron Pills hardware fixture", async () => {
    const root = convexTest(schema, modules);
    const actor = root.withIdentity({ tokenIdentifier, name: "Demo Caregiver" });
    await actor.mutation(api.demoCli.seed, {});
    const previous = await actor.mutation(api.demoCli.prepareScenario, { scenario: "missed-dose" });
    const scenario = await actor.mutation(api.demoCli.prepareScenario, { scenario: "successful-dose" });
    expect(scenario).toMatchObject({ medication: "Iron Pills", slot: 6 });
    const context = await root.run(async (ctx) => {
      const occurrence = await ctx.db.get("doseOccurrences", scenario.occurrenceId!);
      const medication = occurrence ? await ctx.db.get("medications", occurrence.medicationId) : null;
      const assignments = medication
        ? await ctx.db.query("compartmentAssignments").withIndex("by_medication", (q) => q.eq("medicationId", medication._id)).take(10)
        : [];
      return { occurrence, medication, assignment: assignments.find((row) => row.active) };
    });
    expect(context.medication?.name).toBe("Iron Pills");
    expect(context.assignment?.slot).toBe(6);
    expect(context.occurrence?.attemptStatus).toBe("NONE");
    const listed = await actor.query(api.occurrences.listForPatient, { now: Date.now() });
    expect(listed.occurrences.find((row) => row.id === previous.occurrenceId)).toBeUndefined();
    expect(listed.occurrences.find((row) => row.id === scenario.occurrenceId)).toMatchObject({
      medicationName: "Iron Pills",
      slot: 6,
    });
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
    await raiseMagnesiumSupply(root);
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
    await raiseMagnesiumSupply(root);
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

describe("final CalHacks demo configuration", () => {
  beforeEach(() => {
    vi.stubEnv("PILLSENSE_DEMO_ENVIRONMENT", "development");
    vi.stubEnv("PILLSENSE_DEMO_OPERATOR_TOKEN_IDENTIFIER", tokenIdentifier);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const setup = async () => {
    const root = convexTest(schema, modules);
    const actor = root.withIdentity({ tokenIdentifier, name: "Demo Caregiver" });
    await actor.mutation(api.demoCli.seed, {});
    return { root, actor };
  };
  type Root = Awaited<ReturnType<typeof setup>>["root"];
  const activeSlots = (root: Root) => root.run(async (ctx) => {
    const out: Record<number, string> = {};
    for (const row of (await ctx.db.query("compartmentAssignments").take(50)).filter((assignment) => assignment.active)) {
      out[row.slot] = (await ctx.db.get("medications", row.medicationId))!.name;
    }
    return out;
  });
  const assignmentIdForSlot = (root: Root, slot: number) => root.run(async (ctx) =>
    (await ctx.db.query("compartmentAssignments").take(50)).find((row) => row.active && row.slot === slot)!._id);
  /** Simulates an earlier camera scan saved by the caregiver: no demoSeedKey, with scanned product details. */
  const addScanned = (root: Root, slot: number, name: string) => root.run(async (ctx) => {
    const patient = (await ctx.db.query("appUsers").take(10)).find((row) => row.isSynthetic)!;
    const device = (await ctx.db.query("devices").take(5))[0];
    const medicationId = await ctx.db.insert("medications", {
      patientId: patient._id, name, instructions: "", active: true, createdBy: patient._id, createdAt: Date.now(),
      productDetails: { brand: "Tylenol", activeIngredient: "acetaminophen", strength: "500 mg", otherVisibleDetails: [] },
    });
    const assignmentId = await ctx.db.insert("compartmentAssignments", {
      deviceId: device._id, patientId: patient._id, medicationId, slot, demoInventory: 0, active: true,
      assignedBy: patient._id, createdAt: Date.now(),
    });
    return { medicationId, assignmentId };
  });

  it("seeds Advil/ibuprofen in Slot 2, leaves Slots 4 and 7 empty, and contains no Tylenol", async () => {
    const { root, actor } = await setup();
    expect(await activeSlots(root)).toEqual({ 1: "Vitamin D", 2: "Ibuprofen", 3: "Omega-3", 5: "Magnesium", 6: "Iron Pills" });
    const rows = await root.run(async (ctx) => ctx.db.query("medications").take(50));
    const advil = rows.find((row) => row.demoSeedKey === "h6c-advil")!;
    expect(advil.productDetails).toMatchObject({
      brand: "Advil", activeIngredient: "ibuprofen", strength: "200 mg", dosageForm: "tablet", otherVisibleDetails: ["SYNTHETIC DEMO LABEL"],
    });
    expect(JSON.stringify(rows).toLowerCase()).not.toMatch(/tylenol|acetaminophen/);
    expect(await actor.query(api.demoCli.finalStatus, {})).toMatchObject({ ready: true });
  });

  it("renames the existing synthetic Advil record in place without duplicating it or losing details", async () => {
    const { root, actor } = await setup();
    const ids = await root.run(async (ctx) => {
      const medication = (await ctx.db.query("medications").take(50)).find((row) => row.demoSeedKey === "h6c-advil")!;
      const assignment = (await ctx.db.query("compartmentAssignments").take(50)).find((row) => row.medicationId === medication._id)!;
      const schedule = (await ctx.db.query("medicationSchedules").take(50)).find((row) => row.medicationId === medication._id)!;
      // The record as it exists in an already-seeded deployment, with a caregiver-adjusted supply.
      await ctx.db.patch("medications", medication._id, { name: "Advil 200 mg" });
      await ctx.db.patch("compartmentAssignments", assignment._id, { estimatedSupplyCount: 9 });
      return { medicationId: medication._id, assignmentId: assignment._id, scheduleId: schedule._id, revision: schedule.revision, scheduledTime: schedule.localTime };
    });
    await actor.mutation(api.demoCli.seed, {});
    await actor.mutation(api.demoCli.seed, {});
    const after = await root.run(async (ctx) => ({
      medications: await ctx.db.query("medications").take(50),
      medication: await ctx.db.get("medications", ids.medicationId),
      assignment: await ctx.db.get("compartmentAssignments", ids.assignmentId),
      schedule: await ctx.db.get("medicationSchedules", ids.scheduleId),
    }));
    expect(after.medications).toHaveLength(5);
    expect(after.medication).toMatchObject({
      name: "Ibuprofen", active: true,
      productDetails: { brand: "Advil", activeIngredient: "ibuprofen", strength: "200 mg", dosageForm: "tablet", quantity: "24 tablets" },
    });
    expect(after.assignment).toMatchObject({ active: true, slot: 2, estimatedSupplyCount: 9 });
    expect(after.schedule).toMatchObject({ revision: ids.revision, localTime: ids.scheduledTime, active: true });
    expect(await actor.query(api.demoCli.finalStatus, {})).toMatchObject({ ready: true, slots: { "2": "Ibuprofen" } });
  });

  it("is idempotent and never resets a caregiver-adjusted supply", async () => {
    const { root, actor } = await setup();
    await root.run(async (ctx) => {
      const advil = (await ctx.db.query("medications").take(50)).find((row) => row.demoSeedKey === "h6c-advil")!;
      const assignment = (await ctx.db.query("compartmentAssignments").withIndex("by_medication", (q) => q.eq("medicationId", advil._id)).take(5))[0];
      await ctx.db.patch("compartmentAssignments", assignment._id, { estimatedSupplyCount: 7 });
    });
    await actor.mutation(api.demoCli.seed, {});
    await actor.mutation(api.demoCli.seed, {});
    const rows = await root.run(async (ctx) => ({
      medications: await ctx.db.query("medications").take(50),
      assignments: await ctx.db.query("compartmentAssignments").take(50),
      schedules: await ctx.db.query("medicationSchedules").take(50),
    }));
    expect(rows.medications).toHaveLength(5);
    expect(rows.assignments.filter((row) => row.active)).toHaveLength(5);
    expect(rows.schedules).toHaveLength(5);
    expect(rows.assignments.find((row) => row.slot === 2)?.estimatedSupplyCount).toBe(7);
  });

  it("adopts existing plain showcase supplements instead of duplicating them", async () => {
    const { root, actor } = await setup();
    await root.run(async (ctx) => {
      const keyed = (await ctx.db.query("medications").take(50)).find((row) => row.demoSeedKey === "h6c-omega-3")!;
      await ctx.db.patch("medications", keyed._id, { demoSeedKey: undefined });
    });
    await actor.mutation(api.demoCli.seed, {});
    const medications = await root.run(async (ctx) => ctx.db.query("medications").take(50));
    expect(medications.filter((row) => row.name === "Omega-3")).toHaveLength(1);
    expect(medications.find((row) => row.name === "Omega-3")?.demoSeedKey).toBe("h6c-omega-3");
  });

  it("reports a scanned medication occupying Slot 2 without touching or relocating anything", async () => {
    const { root, actor } = await setup();
    await actor.mutation(api.demoCli.releaseSlot, { slot: 2, assignmentId: await assignmentIdForSlot(root, 2), confirm: "RELEASE SLOT 2" });
    const scanned2 = await addScanned(root, 2, "TYLENOL 500 mg each Tablet");
    const scanned4 = await addScanned(root, 4, "TYLENOL 500 mg each Tablet");
    const result = await actor.mutation(api.demoCli.seed, {});
    expect(result.seeded).toBe(false);
    expect(result.slotConflicts).toEqual([{ slot: 2, medication: "TYLENOL 500 mg each Tablet", scannedOrUserEntered: true }]);
    const after = await root.run(async (ctx) => ({
      s2: await ctx.db.get("compartmentAssignments", scanned2.assignmentId),
      s4: await ctx.db.get("compartmentAssignments", scanned4.assignmentId),
      med2: await ctx.db.get("medications", scanned2.medicationId),
    }));
    expect(after.s2?.active).toBe(true);
    expect(after.s4?.active).toBe(true);
    expect(after.med2?.active).toBe(true);
    // Advil is not parked in a different slot to dodge the conflict.
    expect(Object.values(await activeSlots(root)).filter((name) => name === "Ibuprofen")).toHaveLength(0);
    expect(await actor.query(api.demoCli.finalStatus, {})).toMatchObject({ ready: false });
  });

  it("releases a slot only with exact confirmation, keeping history", async () => {
    const { root, actor } = await setup();
    const scanned = await addScanned(root, 4, "TYLENOL 500 mg each Tablet");
    const described = await actor.query(api.demoCli.describeSlot, { slot: 4 });
    expect(described.assignment).toMatchObject({ medication: "TYLENOL 500 mg each Tablet", scannedOrUserEntered: true, synthetic: false, activeIngredient: "acetaminophen" });
    expect(await actor.query(api.demoCli.finalStatus, {})).toMatchObject({ ready: false });
    await expect(actor.mutation(api.demoCli.releaseSlot, { slot: 4, assignmentId: scanned.assignmentId, confirm: "yes" })).rejects.toThrow("Confirmation must be exactly");
    await expect(actor.mutation(api.demoCli.releaseSlot, { slot: 5, assignmentId: scanned.assignmentId, confirm: "RELEASE SLOT 5" })).rejects.toThrow("not the active synthetic assignment");
    expect((await root.run(async (ctx) => ctx.db.get("compartmentAssignments", scanned.assignmentId)))?.active).toBe(true);

    const released = await actor.mutation(api.demoCli.releaseSlot, { slot: 4, assignmentId: scanned.assignmentId, confirm: "RELEASE SLOT 4" });
    expect(released).toMatchObject({ released: true, historyPreserved: true, deviceCommandIssued: false });
    const after = await root.run(async (ctx) => ({
      assignment: await ctx.db.get("compartmentAssignments", scanned.assignmentId),
      medication: await ctx.db.get("medications", scanned.medicationId),
      commands: await ctx.db.query("dispenseCommands").take(5),
      events: await ctx.db.query("deviceEvents").take(5),
    }));
    expect(after.assignment).toMatchObject({ active: false, slot: 4 });
    expect(after.medication).toMatchObject({ active: false, name: "TYLENOL 500 mg each Tablet" });
    expect(after.commands).toHaveLength(0);
    expect(after.events).toHaveLength(0);
    expect((await activeSlots(root))[4]).toBeUndefined();
    expect(await actor.query(api.demoCli.finalStatus, {})).toMatchObject({ ready: true });
  });

  it("places Advil in Slot 2 after the scanned occupant is released", async () => {
    const { root, actor } = await setup();
    const advilSlot = await assignmentIdForSlot(root, 2);
    await actor.mutation(api.demoCli.releaseSlot, { slot: 2, assignmentId: advilSlot, confirm: "RELEASE SLOT 2" });
    const scanned = await addScanned(root, 2, "TYLENOL 500 mg each Tablet");
    await actor.mutation(api.demoCli.releaseSlot, { slot: 2, assignmentId: scanned.assignmentId, confirm: "RELEASE SLOT 2" });
    const result = await actor.mutation(api.demoCli.seed, {});
    expect(result.seeded).toBe(true);
    const slots = await activeSlots(root);
    expect(slots[2]).toBe("Ibuprofen");
    const history = await root.run(async (ctx) => ctx.db.query("compartmentAssignments").take(50));
    expect(history.filter((row) => row.slot === 2 && row.active)).toHaveLength(1);
    expect(history.length).toBeGreaterThanOrEqual(6);
  });

  it("migrates the earlier layout (Advil in Slot 6, scanned Tylenol in Slot 2) in one re-seed after release", async () => {
    const { root, actor } = await setup();
    // Recreate the pre-correction state: Advil in Slot 6, no Iron Pills, scanned Tylenol in Slot 2.
    await actor.mutation(api.demoCli.releaseSlot, { slot: 6, assignmentId: await assignmentIdForSlot(root, 6), confirm: "RELEASE SLOT 6" });
    await actor.mutation(api.demoCli.releaseSlot, { slot: 2, assignmentId: await assignmentIdForSlot(root, 2), confirm: "RELEASE SLOT 2" });
    await root.run(async (ctx) => {
      const advil = (await ctx.db.query("medications").take(50)).find((row) => row.demoSeedKey === "h6c-advil")!;
      await ctx.db.patch("medications", advil._id, { active: true });
      const assignment = (await ctx.db.query("compartmentAssignments").take(50)).find((row) => row.medicationId === advil._id)!;
      await ctx.db.patch("compartmentAssignments", assignment._id, { active: true, slot: 6 });
    });
    const tylenol = await addScanned(root, 2, "TYLENOL 500 mg each Tablet");
    const first = await actor.mutation(api.demoCli.seed, {});
    expect(first.slotConflicts.map((row) => row.slot).sort()).toEqual([2, 6]);
    expect(first.slotConflicts.find((row) => row.slot === 6)?.scannedOrUserEntered).toBe(false);
    await actor.mutation(api.demoCli.releaseSlot, { slot: 2, assignmentId: tylenol.assignmentId, confirm: "RELEASE SLOT 2" });
    const second = await actor.mutation(api.demoCli.seed, {});
    expect(second.seeded).toBe(true);
    expect(await activeSlots(root)).toEqual({ 1: "Vitamin D", 2: "Ibuprofen", 3: "Omega-3", 5: "Magnesium", 6: "Iron Pills" });
  });

  it("retires only keyed obsolete synthetic Tylenol fixtures and keeps their history", async () => {
    const { root, actor } = await setup();
    const fixture = await addScanned(root, 4, "Tylenol 500 mg");
    await root.run(async (ctx) => ctx.db.patch("medications", fixture.medicationId, { demoSeedKey: "h6c-tylenol" }));
    const scanned = await addScanned(root, 7, "Scanned Tylenol");
    const result = await actor.mutation(api.demoCli.seed, {});
    expect(result.retiredObsoleteFixtures).toEqual(["h6c-tylenol"]);
    const after = await root.run(async (ctx) => ({
      medication: await ctx.db.get("medications", fixture.medicationId),
      assignment: await ctx.db.get("compartmentAssignments", fixture.assignmentId),
      scanned: await ctx.db.get("compartmentAssignments", scanned.assignmentId),
    }));
    expect(after.medication?.active).toBe(false);
    expect(after.assignment?.active).toBe(false);
    expect(after.scanned?.active).toBe(true);
  });

  it("refuses to release a slot with an unsettled dispense", async () => {
    const { root, actor } = await setup();
    const scanned = await addScanned(root, 4, "TYLENOL 500 mg each Tablet");
    await root.run(async (ctx) => {
      const patient = (await ctx.db.query("appUsers").take(10)).find((row) => row.isSynthetic)!;
      const device = (await ctx.db.query("devices").take(5))[0];
      const scheduleId = await ctx.db.insert("medicationSchedules", {
        patientId: patient._id, medicationId: scanned.medicationId, localTime: "09:00", weekdays: ["MON"], timezone: "America/Toronto", active: true, createdAt: 1,
      });
      const occurrenceId = await ctx.db.insert("doseOccurrences", {
        occurrenceKey: "k", patientId: patient._id, medicationId: scanned.medicationId, scheduleId, scheduleRevision: 1, mode: "demo",
        scheduledFor: 1, eligibleFrom: 0, expiresAt: 2, attemptStatus: "NONE", ingestionReport: "UNREPORTED", createdAt: 1,
      });
      await ctx.db.insert("dispenseCommands", {
        commandId: "c", occurrenceId, patientId: patient._id, medicationId: scanned.medicationId, scheduleId, deviceId: device._id,
        assignmentId: scanned.assignmentId, slot: 4, status: "DISPATCHED", motorCompletion: "NOT_STARTED",
        pillRelease: "UNKNOWN", pillCollection: "UNKNOWN", expiresAt: 2, createdAt: 1, updatedAt: 1,
      });
    });
    await expect(actor.mutation(api.demoCli.releaseSlot, { slot: 4, assignmentId: scanned.assignmentId, confirm: "RELEASE SLOT 4" })).rejects.toThrow("not settled");
    expect((await root.run(async (ctx) => ctx.db.get("compartmentAssignments", scanned.assignmentId)))?.active).toBe(true);
  });

  it("refuses a stranger, production, and a non-synthetic patient", async () => {
    const { root, actor } = await setup();
    const scanned = await addScanned(root, 4, "TYLENOL 500 mg each Tablet");
    const release = { slot: 4, assignmentId: scanned.assignmentId, confirm: "RELEASE SLOT 4" };
    const stranger = root.withIdentity({ tokenIdentifier: "issuer|other", name: "Other" });
    await expect(stranger.mutation(api.demoCli.releaseSlot, release)).rejects.toThrow("not authorized");
    vi.stubEnv("PILLSENSE_DEMO_ENVIRONMENT", "production");
    await expect(actor.mutation(api.demoCli.releaseSlot, release)).rejects.toThrow("disabled");
    vi.stubEnv("PILLSENSE_DEMO_ENVIRONMENT", "development");
    await root.run(async (ctx) => {
      const patient = (await ctx.db.query("appUsers").take(10)).find((row) => row.isSynthetic)!;
      await ctx.db.patch("appUsers", patient._id, { isSynthetic: false });
    });
    await expect(actor.query(api.demoCli.describeSlot, { slot: 4 })).rejects.toThrow("synthetic");
    await expect(actor.mutation(api.demoCli.releaseSlot, release)).rejects.toThrow("synthetic");
    expect((await root.run(async (ctx) => ctx.db.get("compartmentAssignments", scanned.assignmentId)))?.active).toBe(true);
  });

  it("makes no external API call while seeding or releasing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { root, actor } = await setup();
    const scanned = await addScanned(root, 4, "TYLENOL 500 mg each Tablet");
    await actor.mutation(api.demoCli.releaseSlot, { slot: 4, assignmentId: scanned.assignmentId, confirm: "RELEASE SLOT 4" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
