import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { env, mutation, query } from "./_generated/server";
import { createOrReuseAdherenceRun } from "./lib/agentRunCreation";
import { WEEKDAYS } from "./lib/medicationValidation";
import { reconcileOccurrence, resolveDemoOccurrence } from "./lib/reminderReconciliation";
import { reconcilePatientRefills } from "./refills";
import { requireIdentity } from "./lib/requireIdentity";

const MINUTE = 60_000;
const CLI_SOURCE = "pillsense-demo-cli";

async function requireCli(ctx: QueryCtx | MutationCtx) {
  if (env.PILLSENSE_DEMO_ENVIRONMENT !== "development") {
    throw new ConvexError("Demo CLI is disabled: PILLSENSE_DEMO_ENVIRONMENT must be development");
  }
  const expected = env.PILLSENSE_DEMO_OPERATOR_TOKEN_IDENTIFIER?.trim();
  if (!expected) throw new ConvexError("Demo CLI operator identity is not configured");
  const identity = await requireIdentity(ctx);
  if (identity.tokenIdentifier !== expected) throw new ConvexError("Demo CLI operator is not authorized");
  return identity;
}

async function ensureTeam(ctx: MutationCtx) {
  const identity = await requireCli(ctx);
  const now = Date.now();
  let caregiver = await ctx.db.query("appUsers")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
  if (caregiver && caregiver.role !== "caregiver") throw new ConvexError("Configured demo operator is not a caregiver");
  if (!caregiver) {
    const id = await ctx.db.insert("appUsers", {
      tokenIdentifier: identity.tokenIdentifier,
      displayName: "Demo Caregiver",
      role: "caregiver",
      isSynthetic: false,
      createdAt: now,
    });
    caregiver = await ctx.db.get("appUsers", id);
  }
  if (!caregiver) throw new ConvexError("Unable to prepare demo caregiver");
  let relationship = await ctx.db.query("careRelationships")
    .withIndex("by_caregiver", (q) => q.eq("caregiverId", caregiver!._id)).first();
  let patient = relationship ? await ctx.db.get("appUsers", relationship.patientId) : null;
  if (!patient) {
    const patientId = await ctx.db.insert("appUsers", {
      displayName: "Demo Patient", role: "patient", isSynthetic: true, createdAt: now,
    });
    await ctx.db.insert("careRelationships", {
      caregiverId: caregiver._id, patientId, status: "active", createdAt: now,
    });
    relationship = await ctx.db.query("careRelationships")
      .withIndex("by_caregiver_and_patient", (q) => q.eq("caregiverId", caregiver!._id).eq("patientId", patientId)).unique();
    patient = await ctx.db.get("appUsers", patientId);
  }
  if (!patient?.isSynthetic || !relationship) throw new ConvexError("Demo CLI refuses to operate on a non-synthetic patient");
  let device = await ctx.db.query("devices").withIndex("by_patient", (q) => q.eq("patientId", patient!._id)).first();
  if (!device) {
    const deviceId = await ctx.db.insert("devices", {
      patientId: patient._id, label: "PillSense Demo Dispenser",
      hardwareModel: "ARDUINO_UNO_R4_WIFI", physicalPositions: 8, createdAt: now,
    });
    device = await ctx.db.get("devices", deviceId);
  }
  if (!device) throw new ConvexError("Unable to prepare synthetic dispenser");
  return { caregiver, patient, device };
}

async function seedMedication(
  ctx: MutationCtx,
  team: Awaited<ReturnType<typeof ensureTeam>>,
  spec: { key: string; name: string; ingredient: string; strength: string; slot: number; localTime: string; count: number },
) {
  const now = Date.now();
  const medications = await ctx.db.query("medications")
    .withIndex("by_patient", (q) => q.eq("patientId", team.patient._id)).take(50);
  let medication: Doc<"medications"> | null | undefined = medications.find((row) => row.demoSeedKey === spec.key);
  if (!medication) {
    const id = await ctx.db.insert("medications", {
      patientId: team.patient._id, name: spec.name,
      instructions: "1 tablet · Follow the caregiver-approved package instructions",
      productDetails: {
        brand: spec.name.split(" ")[0], activeIngredient: spec.ingredient,
        strength: spec.strength, dosageForm: "tablet", quantity: "24 tablets",
        otherVisibleDetails: ["SYNTHETIC DEMO LABEL"],
      },
      active: true, createdBy: team.caregiver._id, demoSeedKey: spec.key, createdAt: now,
    });
    medication = await ctx.db.get("medications", id);
  } else if (!medication.active) {
    await ctx.db.patch("medications", medication._id, { active: true });
    medication = { ...medication, active: true };
  }
  if (!medication) throw new ConvexError("Unable to seed medication");
  let schedule = await ctx.db.query("medicationSchedules")
    .withIndex("by_medication", (q) => q.eq("medicationId", medication!._id)).first();
  if (!schedule) {
    const id = await ctx.db.insert("medicationSchedules", {
      patientId: team.patient._id, medicationId: medication._id,
      localTime: spec.localTime, weekdays: [...WEEKDAYS], timezone: "America/Toronto",
      active: true, revision: 1, createdAt: now,
    });
    schedule = await ctx.db.get("medicationSchedules", id);
  } else if (!schedule.active) {
    await ctx.db.patch("medicationSchedules", schedule._id, { active: true, revision: (schedule.revision ?? 1) + 1 });
    schedule = await ctx.db.get("medicationSchedules", schedule._id);
  }
  const assignments = await ctx.db.query("compartmentAssignments")
    .withIndex("by_patient", (q) => q.eq("patientId", team.patient._id)).take(20);
  let assignment: Doc<"compartmentAssignments"> | null | undefined = assignments.find((row) => row.medicationId === medication!._id);
  const slotConflict = assignments.find((row) => row.active && row.slot === spec.slot && row.medicationId !== medication!._id);
  const freeSlot = [spec.slot, 1, 2, 3, 4, 5, 6, 7].find((slot) => !assignments.some((row) => row.active && row.slot === slot));
  const slot = slotConflict ? freeSlot : spec.slot;
  if (slot === undefined) throw new ConvexError("No synthetic demo slot is available");
  if (!assignment) {
    const id = await ctx.db.insert("compartmentAssignments", {
      deviceId: team.device._id, patientId: team.patient._id, medicationId: medication._id,
      slot, demoInventory: 1, estimatedSupplyCount: spec.count,
      supplyEstimateSource: "SYNTHETIC_DEMO", supplyEstimateUpdatedAt: now, supplyRevision: 1,
      active: true, assignedBy: team.caregiver._id, createdAt: now,
    });
    assignment = await ctx.db.get("compartmentAssignments", id);
  } else {
    await ctx.db.patch("compartmentAssignments", assignment._id, {
      slot, demoInventory: 1, estimatedSupplyCount: spec.count,
      supplyEstimateSource: "SYNTHETIC_DEMO", supplyEstimateUpdatedAt: now,
      supplyRevision: (assignment.supplyRevision ?? 0) + 1, active: true,
    });
    assignment = await ctx.db.get("compartmentAssignments", assignment._id);
  }
  if (!schedule || !assignment) throw new ConvexError("Unable to seed medication schedule and assignment");
  return { medication, schedule, assignment };
}

async function archiveActiveScenarios(ctx: MutationCtx, patientId: Id<"appUsers">, now: number) {
  const runs = await ctx.db.query("demoScenarioRuns")
    .withIndex("by_patient_and_status", (q) => q.eq("patientId", patientId).eq("status", "ACTIVE")).take(50);
  for (const run of runs) {
    if (run.occurrenceId) {
      const occurrence = await ctx.db.get("doseOccurrences", run.occurrenceId);
      if (occurrence) await resolveDemoOccurrence(ctx, occurrence, now);
    }
    await ctx.db.patch("demoScenarioRuns", run._id, { status: "RESET", resetAt: now });
  }
  return runs.length;
}

async function archiveActiveRefillDemos(
  ctx: MutationCtx,
  team: Awaited<ReturnType<typeof ensureTeam>>,
  now: number,
) {
  const runs = await ctx.db.query("refillDemoRuns")
    .withIndex("by_patient_and_status", (q) => q.eq("patientId", team.patient._id).eq("status", "ACTIVE")).take(20);
  for (const run of runs) {
    const assignment = await ctx.db.get("compartmentAssignments", run.assignmentId);
    if (assignment) await ctx.db.patch("compartmentAssignments", assignment._id, {
      estimatedSupplyCount: run.previousSupplyCount ?? undefined,
      supplyEstimateSource: run.previousSource ?? undefined,
      supplyEstimateUpdatedAt: run.previousUpdatedAt ?? undefined,
      supplyRevision: run.previousRevision,
    });
    if (run.refillCaseId) {
      const refillCase = await ctx.db.get("refillCases", run.refillCaseId);
      if (refillCase && refillCase.status !== "CLOSED" && refillCase.status !== "REFILL_RECEIVED") {
        await ctx.db.patch("refillCases", refillCase._id, { status: "CLOSED", caseVersion: refillCase.caseVersion + 1, updatedAt: now });
        await ctx.db.insert("refillCaseTransitions", {
          caseId: refillCase._id, patientId: team.patient._id, type: "DEMO_RESET",
          fromStatus: refillCase.status, toStatus: "CLOSED", actorId: team.caregiver._id,
          note: "Synthetic CLI reset; audit history retained.", occurredAt: now,
        });
      }
    }
    await ctx.db.patch("refillDemoRuns", run._id, { status: "RESET", resetAt: now });
  }
  return runs.length;
}

async function createDoseScenario(
  ctx: MutationCtx,
  team: Awaited<ReturnType<typeof ensureTeam>>,
  scenario: "DUE_REMINDER" | "UNANSWERED_ROUTINE",
) {
  const seeded = await seedMedication(ctx, team, {
    key: "h6c-advil", name: "Advil 200 mg", ingredient: "ibuprofen", strength: "200 mg",
    slot: 6, localTime: "09:00", count: 12,
  });
  const now = Date.now();
  const runId = `${CLI_SOURCE}:${scenario.toLocaleLowerCase()}:${crypto.randomUUID()}`;
  const runDocId = await ctx.db.insert("demoScenarioRuns", {
    runId, patientId: team.patient._id, scenario, status: "ACTIVE",
    simulatedNow: now, initiatedBy: team.caregiver._id, createdAt: now,
  });
  const occurrenceId = await ctx.db.insert("doseOccurrences", {
    occurrenceKey: runId, patientId: team.patient._id, medicationId: seeded.medication._id,
    scheduleId: seeded.schedule._id, scheduleRevision: seeded.schedule.revision ?? 1,
    mode: "demo", scheduledFor: now, eligibleFrom: now - 15 * MINUTE,
    expiresAt: now + 30 * MINUTE, attemptStatus: "NONE", ingestionReport: "UNREPORTED",
    demoScenarioRunId: runDocId, createdAt: now,
  });
  await ctx.db.patch("demoScenarioRuns", runDocId, { occurrenceId });
  const occurrence = await ctx.db.get("doseOccurrences", occurrenceId);
  if (!occurrence) throw new ConvexError("Unable to create synthetic dose occurrence");
  await reconcileOccurrence(ctx, occurrence, now, "DEMO_SIMULATION", { upcomingWindowMinutes: 60, followUpWindowMinutes: 5 });
  return { runId, occurrenceId };
}

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const team = await ensureTeam(ctx);
    const first = await seedMedication(ctx, team, {
      key: "h6c-advil", name: "Advil 200 mg", ingredient: "ibuprofen", strength: "200 mg",
      slot: 6, localTime: "09:00", count: 12,
    });
    await seedMedication(ctx, team, {
      key: "h6c-vitamin-d", name: "Vitamin D", ingredient: "vitamin D3", strength: "1000 IU",
      slot: 1, localTime: "08:00", count: 28,
    });
    const settings = await ctx.db.query("reminderSettings").withIndex("by_patient", (q) => q.eq("patientId", team.patient._id)).unique();
    const value = { upcomingWindowMinutes: 60, followUpWindowMinutes: 5, updatedBy: team.caregiver._id, updatedAt: Date.now() };
    if (settings) await ctx.db.patch("reminderSettings", settings._id, value);
    else await ctx.db.insert("reminderSettings", { patientId: team.patient._id, ...value });
    return { seeded: true, patientReady: true, caregiverReady: true, primarySlot: first.assignment.slot };
  },
});

export const reset = mutation({
  args: {},
  handler: async (ctx) => {
    const team = await ensureTeam(ctx);
    const now = Date.now();
    const scenariosArchived = await archiveActiveScenarios(ctx, team.patient._id, now);
    const refillRunsArchived = await archiveActiveRefillDemos(ctx, team, now);
    return { reset: true, scenariosArchived, refillRunsArchived, auditHistoryPreserved: true };
  },
});

export const prepareScenario = mutation({
  args: { scenario: v.union(v.literal("onboarding"), v.literal("successful-dose"), v.literal("missed-dose"), v.literal("low-supply")) },
  handler: async (ctx, args) => {
    const team = await ensureTeam(ctx);
    const now = Date.now();
    await archiveActiveScenarios(ctx, team.patient._id, now);
    await archiveActiveRefillDemos(ctx, team, now);
    if (args.scenario === "onboarding") {
      const medications = await ctx.db.query("medications").withIndex("by_patient", (q) => q.eq("patientId", team.patient._id)).take(50);
      for (const medication of medications.filter((row) => row.demoSeedKey)) {
        await ctx.db.patch("medications", medication._id, { active: false });
        const schedules = await ctx.db.query("medicationSchedules").withIndex("by_medication", (q) => q.eq("medicationId", medication._id)).take(10);
        for (const schedule of schedules) if (schedule.active) await ctx.db.patch("medicationSchedules", schedule._id, { active: false });
        const assignments = await ctx.db.query("compartmentAssignments").withIndex("by_medication", (q) => q.eq("medicationId", medication._id)).take(10);
        for (const assignment of assignments) if (assignment.active) await ctx.db.patch("compartmentAssignments", assignment._id, { active: false });
      }
      return { scenario: args.scenario, ready: true, fixture: "/demo/synthetic-advil-label.svg" };
    }
    if (args.scenario === "successful-dose" || args.scenario === "missed-dose") {
      const dose = await createDoseScenario(ctx, team, args.scenario === "successful-dose" ? "DUE_REMINDER" : "UNANSWERED_ROUTINE");
      return { scenario: args.scenario, ready: true, runId: dose.runId, occurrenceId: dose.occurrenceId };
    }
    const seeded = await seedMedication(ctx, team, {
      key: "h6c-advil", name: "Advil 200 mg", ingredient: "ibuprofen", strength: "200 mg",
      slot: 6, localTime: "09:00", count: 12,
    });
    const prior = seeded.assignment;
    const demoRunId = await ctx.db.insert("refillDemoRuns", {
      patientId: team.patient._id, assignmentId: prior._id,
      previousSupplyCount: prior.estimatedSupplyCount ?? null, previousSource: prior.supplyEstimateSource ?? null,
      previousUpdatedAt: prior.supplyEstimateUpdatedAt ?? null, previousRevision: prior.supplyRevision ?? 0,
      status: "ACTIVE", initiatedBy: team.caregiver._id, createdAt: now,
    });
    await ctx.db.patch("compartmentAssignments", prior._id, {
      estimatedSupplyCount: 2, supplyEstimateSource: "SYNTHETIC_DEMO",
      supplyEstimateUpdatedAt: now, supplyRevision: (prior.supplyRevision ?? 0) + 1,
    });
    await reconcilePatientRefills(ctx, team.patient._id, now);
    const cases = await ctx.db.query("refillCases").withIndex("by_medication", (q) => q.eq("medicationId", seeded.medication._id)).order("desc").take(10);
    const refillCase = cases.find((row) => row.status === "OPEN");
    if (refillCase) await ctx.db.patch("refillDemoRuns", demoRunId, { refillCaseId: refillCase._id });
    return { scenario: args.scenario, ready: true, refillCaseId: refillCase?._id ?? null, checkoutCreated: false };
  },
});

export const advanceMissedDose = mutation({
  args: {},
  handler: async (ctx) => {
    const team = await ensureTeam(ctx);
    const runs = await ctx.db.query("demoScenarioRuns")
      .withIndex("by_patient_and_status", (q) => q.eq("patientId", team.patient._id).eq("status", "ACTIVE")).order("desc").take(20);
    const run = runs.find((candidate) => candidate.scenario === "UNANSWERED_ROUTINE" && candidate.occurrenceId);
    if (!run?.occurrenceId) throw new ConvexError("Prepare a missed-dose scenario first");
    const occurrence = await ctx.db.get("doseOccurrences", run.occurrenceId);
    if (!occurrence) throw new ConvexError("Synthetic missed-dose occurrence is unavailable");
    const simulatedNow = occurrence.scheduledFor + 6 * MINUTE;
    const state = await reconcileOccurrence(ctx, occurrence, simulatedNow, "DEMO_SIMULATION", { upcomingWindowMinutes: 60, followUpWindowMinutes: 5 });
    await ctx.db.patch("demoScenarioRuns", run._id, { simulatedNow });
    const careCase = await ctx.db.query("careCases").withIndex("by_occurrence", (q) => q.eq("occurrenceId", occurrence._id)).unique();
    if (careCase?.investigationStatus === "NOT_REQUESTED") {
      await createOrReuseAdherenceRun(ctx, careCase, team.caregiver._id, simulatedNow, { source: "AUTOMATION" });
    }
    return { state, syntheticAdvanceMinutes: 6, careCaseId: careCase?._id ?? null, investigationQueued: !!careCase };
  },
});

export const status = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireCli(ctx);
    const caregiver = await ctx.db.query("appUsers").withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
    if (!caregiver) return { environment: "development", caregiverAvailable: false, patientAvailable: false, walgreensMode: env.WALGREENS_MODE ?? "mock" };
    const relationship = await ctx.db.query("careRelationships").withIndex("by_caregiver", (q) => q.eq("caregiverId", caregiver._id)).first();
    const patient = relationship ? await ctx.db.get("appUsers", relationship.patientId) : null;
    if (!patient?.isSynthetic) return { environment: "development", caregiverAvailable: true, patientAvailable: false, walgreensMode: env.WALGREENS_MODE ?? "mock" };
    const [devices, assignments, medications, occurrences, careCases, refillCases, runs] = await Promise.all([
      ctx.db.query("devices").withIndex("by_patient", (q) => q.eq("patientId", patient._id)).take(5),
      ctx.db.query("compartmentAssignments").withIndex("by_patient", (q) => q.eq("patientId", patient._id)).take(20),
      ctx.db.query("medications").withIndex("by_patient", (q) => q.eq("patientId", patient._id)).take(50),
      ctx.db.query("doseOccurrences").withIndex("by_patient_and_scheduledFor", (q) => q.eq("patientId", patient._id)).order("desc").take(20),
      Promise.all(["OPEN", "ACKNOWLEDGED"].map((value) => ctx.db.query("careCases").withIndex("by_patient_and_status", (q) => q.eq("patientId", patient._id).eq("status", value as "OPEN" | "ACKNOWLEDGED")).take(20))).then((groups) => groups.flat()),
      Promise.all(["OPEN", "REVIEWED", "REFILL_REQUESTED"].map((value) => ctx.db.query("refillCases").withIndex("by_patient_and_status", (q) => q.eq("patientId", patient._id).eq("status", value as "OPEN" | "REVIEWED" | "REFILL_REQUESTED")).take(20))).then((groups) => groups.flat()),
      ctx.db.query("agentRuns").withIndex("by_patient_and_createdAt", (q) => q.eq("patientId", patient._id)).order("desc").take(20),
    ]);
    return {
      environment: "development", caregiverAvailable: true, patientAvailable: true,
      deviceCount: devices.length,
      activeSlots: assignments.filter((row) => row.active).map((row) => row.slot).sort((a, b) => a - b),
      activeMedications: medications.filter((row) => row.active).map((row) => ({ key: row.demoSeedKey ?? "user-configured", scheduled: true })),
      activeOccurrences: occurrences.filter((row) => row.reminderState !== "RESOLVED").map((row) => ({ id: row._id, state: row.reminderState ?? null, synthetic: row.mode === "demo" })),
      careCases: careCases.map((row) => ({ id: row._id, status: row.status, investigation: row.investigationStatus })),
      refillCases: refillCases.map((row) => ({ id: row._id, status: row.status, investigation: row.investigationStatus, checkoutEligible: row.status === "REFILL_REQUESTED" && row.investigationStatus === "COMPLETED" })),
      agentRuns: runs.map((row) => ({ id: row._id, status: row.status, provider: row.provider })),
      walgreensMode: env.WALGREENS_MODE ?? "mock",
    };
  },
});
