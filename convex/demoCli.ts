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

type SeedSpec = {
  key: string; name: string; instructions: string; slot: number; localTime: string; count: number;
  /** Explicitly synthetic package label. Omitted for plain supplements, which carry no package details. */
  label?: { brand: string; ingredient: string; strength: string; dosageForm: string; quantity: string };
};

const ADVIL: SeedSpec = {
  key: "h6c-advil", name: "Ibuprofen", instructions: "1 tablet · Follow the caregiver-approved package instructions",
  slot: 2, localTime: "09:00", count: 12,
  label: { brand: "Advil", ingredient: "ibuprofen", strength: "200 mg", dosageForm: "tablet", quantity: "24 tablets" },
};

const IRON_PILLS: SeedSpec = {
  key: "h6c-iron-pills", name: "Iron Pills", instructions: "1 tablet · Eat with breakfast",
  slot: 6, localTime: "08:00", count: 12,
};

/** Final CalHacks configuration. Slots 4 and 7 stay empty: Slot 4 is filled live by the camera scan. */
export const DEMO_BASELINE: SeedSpec[] = [
  { key: "h6c-vitamin-d", name: "Vitamin D", instructions: "1 tablet · Eat with breakfast", slot: 1, localTime: "08:00", count: 28 },
  ADVIL,
  { key: "h6c-omega-3", name: "Omega-3", instructions: "1 capsule · Eat with lunch", slot: 3, localTime: "13:00", count: 17 },
  { key: "h6c-magnesium", name: "Magnesium", instructions: "1 tablet · Eat with dinner", slot: 5, localTime: "20:00", count: 3 },
  IRON_PILLS,
];
const RESERVED_EMPTY_SLOTS = [4, 7];
/** Earlier synthetic fixtures that the final configuration no longer includes. Only keyed rows are ever retired. */
const OBSOLETE_SYNTHETIC_KEYS = new Set(["h6c-tylenol"]);

type SlotConflict = { slot: number; assignmentId: Id<"compartmentAssignments">; medicationName: string; scannedOrUserEntered: boolean };

/** Created by a person or the camera scanner rather than by this CLI's synthetic fixtures. */
function isUserOrScanned(medication: Doc<"medications">) {
  return !medication.demoSeedKey;
}

async function seedMedication(
  ctx: MutationCtx,
  team: Awaited<ReturnType<typeof ensureTeam>>,
  spec: SeedSpec,
  onConflict: "throw" | "report" = "throw",
): Promise<{ medication: Doc<"medications">; schedule: Doc<"medicationSchedules">; assignment: Doc<"compartmentAssignments"> } | { conflict: SlotConflict }> {
  const now = Date.now();
  const medications = await ctx.db.query("medications")
    .withIndex("by_patient", (q) => q.eq("patientId", team.patient._id)).take(100);
  // Adopt an existing plain supplement of the same name (older showcase data) instead of creating a duplicate.
  // Scanned medications carry productDetails and are never adopted.
  let medication: Doc<"medications"> | null | undefined = medications.find((row) => row.demoSeedKey === spec.key)
    ?? medications.find((row) => row.active && !row.demoSeedKey && !row.productDetails && row.name.toLocaleLowerCase() === spec.name.toLocaleLowerCase());
  const productDetails = spec.label ? {
    brand: spec.label.brand, activeIngredient: spec.label.ingredient, strength: spec.label.strength,
    dosageForm: spec.label.dosageForm, quantity: spec.label.quantity, otherVisibleDetails: ["SYNTHETIC DEMO LABEL"],
  } : undefined;
  if (!medication) {
    const id = await ctx.db.insert("medications", {
      patientId: team.patient._id, name: spec.name, instructions: spec.instructions, productDetails,
      active: true, createdBy: team.caregiver._id, demoSeedKey: spec.key, createdAt: now,
    });
    medication = await ctx.db.get("medications", id);
  } else {
    const patch: Partial<Doc<"medications">> = {};
    if (!medication.demoSeedKey) patch.demoSeedKey = spec.key;
    if (!medication.active) patch.active = true;
    // Synthetic fixtures are corrected in place; adopted supplements keep whatever the caregiver already has.
    if (medication.demoSeedKey === spec.key && spec.label) {
      if (medication.name !== spec.name) patch.name = spec.name;
      if (JSON.stringify(medication.productDetails) !== JSON.stringify(productDetails)) patch.productDetails = productDetails;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch("medications", medication._id, patch);
      medication = { ...medication, ...patch };
    }
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
    .withIndex("by_patient", (q) => q.eq("patientId", team.patient._id)).take(100);
  let assignment: Doc<"compartmentAssignments"> | null | undefined = assignments.find((row) => row.medicationId === medication!._id && row.active)
    ?? assignments.find((row) => row.medicationId === medication!._id);
  const occupant = assignments.find((row) => row.active && row.slot === spec.slot && row.medicationId !== medication!._id);
  if (occupant) {
    // Never relocate a fixture into another slot: the final layout is fixed, and the occupant is not ours to move.
    const occupantMedication = await ctx.db.get("medications", occupant.medicationId);
    const conflict: SlotConflict = {
      slot: spec.slot, assignmentId: occupant._id, medicationName: occupantMedication?.name ?? "Unknown",
      scannedOrUserEntered: occupantMedication ? isUserOrScanned(occupantMedication) : true,
    };
    if (onConflict === "report") return { conflict };
    throw new ConvexError(`Slot ${spec.slot} is occupied by "${conflict.medicationName}". Run npm run demo:prepare-final to review it.`);
  }
  if (!assignment) {
    const id = await ctx.db.insert("compartmentAssignments", {
      deviceId: team.device._id, patientId: team.patient._id, medicationId: medication._id,
      slot: spec.slot, demoInventory: 1, estimatedSupplyCount: spec.count,
      supplyEstimateSource: "SYNTHETIC_DEMO", supplyEstimateUpdatedAt: now, supplyRevision: 1,
      active: true, assignedBy: team.caregiver._id, createdAt: now,
    });
    assignment = await ctx.db.get("compartmentAssignments", id);
  } else if (!assignment.active || assignment.slot !== spec.slot) {
    await ctx.db.patch("compartmentAssignments", assignment._id, {
      slot: spec.slot, demoInventory: 1, estimatedSupplyCount: spec.count,
      supplyEstimateSource: "SYNTHETIC_DEMO", supplyEstimateUpdatedAt: now,
      supplyRevision: (assignment.supplyRevision ?? 0) + 1, active: true,
    });
    assignment = await ctx.db.get("compartmentAssignments", assignment._id);
  }
  // An already-correct assignment is left alone, so repeated seeding never resets a caregiver-adjusted supply.
  if (!schedule || !assignment) throw new ConvexError("Unable to seed medication schedule and assignment");
  return { medication, schedule, assignment };
}

async function deactivateMedication(ctx: MutationCtx, medication: Doc<"medications">) {
  await ctx.db.patch("medications", medication._id, { active: false });
  const schedules = await ctx.db.query("medicationSchedules").withIndex("by_medication", (q) => q.eq("medicationId", medication._id)).take(10);
  for (const schedule of schedules) if (schedule.active) await ctx.db.patch("medicationSchedules", schedule._id, { active: false });
  const assignments = await ctx.db.query("compartmentAssignments").withIndex("by_medication", (q) => q.eq("medicationId", medication._id)).take(10);
  for (const assignment of assignments) if (assignment.active) await ctx.db.patch("compartmentAssignments", assignment._id, { active: false });
}

/** Deactivates obsolete synthetic fixtures (keyed rows only). History rows are kept. */
async function retireObsoleteFixtures(ctx: MutationCtx, patientId: Id<"appUsers">) {
  const medications = await ctx.db.query("medications").withIndex("by_patient", (q) => q.eq("patientId", patientId)).take(100);
  const retired: string[] = [];
  for (const medication of medications) {
    if (!medication.demoSeedKey || !OBSOLETE_SYNTHETIC_KEYS.has(medication.demoSeedKey) || !medication.active) continue;
    await deactivateMedication(ctx, medication);
    retired.push(medication.demoSeedKey);
  }
  return retired;
}

async function seedBaseline(ctx: MutationCtx, team: Awaited<ReturnType<typeof ensureTeam>>) {
  const retired = await retireObsoleteFixtures(ctx, team.patient._id);
  const conflicts: SlotConflict[] = [];
  for (const spec of DEMO_BASELINE) {
    const result = await seedMedication(ctx, team, spec, "report");
    if ("conflict" in result) conflicts.push(result.conflict);
  }
  return { retired, conflicts };
}

async function seedRequired(ctx: MutationCtx, team: Awaited<ReturnType<typeof ensureTeam>>, spec: SeedSpec) {
  const result = await seedMedication(ctx, team, spec, "throw");
  if ("conflict" in result) throw new ConvexError("Demo slot is occupied");
  return result;
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
  // The successful-dose path is the only scenario that can enter the verified
  // voice-to-hardware flow, so it must target the fixed Slot 6 fixture. Missed
  // dose remains the non-hardware Ibuprofen care-escalation demonstration.
  const seeded = await seedRequired(ctx, team, scenario === "DUE_REMINDER" ? IRON_PILLS : ADVIL);
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
  return {
    runId,
    occurrenceId,
    medication: seeded.medication.name,
    slot: seeded.assignment.slot,
  };
}

async function ensureSeededVoiceReminder(ctx: MutationCtx, team: Awaited<ReturnType<typeof ensureTeam>>) {
  const now = Date.now();
  const runs = await ctx.db.query("demoScenarioRuns")
    .withIndex("by_patient_and_status", (q) => q.eq("patientId", team.patient._id).eq("status", "ACTIVE"))
    .order("desc").take(50);
  for (const run of runs) {
    if (run.scenario !== "DUE_REMINDER" || !run.occurrenceId) continue;
    const occurrence = await ctx.db.get("doseOccurrences", run.occurrenceId);
    if (!occurrence) continue;
    const medication = await ctx.db.get("medications", occurrence.medicationId);
    if (medication?.demoSeedKey !== IRON_PILLS.key) continue;
    const command = await ctx.db.query("dispenseCommands")
      .withIndex("by_occurrence", (q) => q.eq("occurrenceId", occurrence._id)).unique();
    // Re-seeding must never manufacture a new attempt after movement or a report.
    if (command || occurrence.commandId || occurrence.attemptStatus !== "NONE" || occurrence.ingestionReport !== "UNREPORTED") {
      return { status: "ALREADY_ATTEMPTED" as const, occurrenceId: occurrence._id, slot: 6 };
    }
    if (occurrence.expiresAt > now && occurrence.reminderState !== "RESOLVED") {
      return { status: "READY" as const, occurrenceId: occurrence._id, slot: 6 };
    }
    await resolveDemoOccurrence(ctx, occurrence, now);
    await ctx.db.patch("demoScenarioRuns", run._id, { status: "RESET", resetAt: now });
  }
  const dose = await createDoseScenario(ctx, team, "DUE_REMINDER");
  return { status: "READY" as const, occurrenceId: dose.occurrenceId, slot: 6 };
}

export const seed = mutation({
  args: { prepareVoiceReminder: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const team = await ensureTeam(ctx);
    const { retired, conflicts } = await seedBaseline(ctx, team);
    const settings = await ctx.db.query("reminderSettings").withIndex("by_patient", (q) => q.eq("patientId", team.patient._id)).unique();
    const value = { upcomingWindowMinutes: 60, followUpWindowMinutes: 5, updatedBy: team.caregiver._id, updatedAt: Date.now() };
    if (settings) await ctx.db.patch("reminderSettings", settings._id, value);
    else await ctx.db.insert("reminderSettings", { patientId: team.patient._id, ...value });
    const voiceReminder = args.prepareVoiceReminder
      ? conflicts.some((row) => row.slot === 6)
        ? { status: "SLOT_CONFLICT" as const, occurrenceId: null, slot: 6 }
        : await ensureSeededVoiceReminder(ctx, team)
      : null;
    return {
      seeded: conflicts.length === 0, patientReady: true, caregiverReady: true, primarySlot: ADVIL.slot,
      retiredObsoleteFixtures: retired,
      voiceReminder,
      // Occupied slots are reported, never overwritten. Resolve them with npm run demo:prepare-final.
      slotConflicts: conflicts.map((row) => ({ slot: row.slot, medication: row.medicationName, scannedOrUserEntered: row.scannedOrUserEntered })),
    };
  },
});

/** Read-only lookup of the configured operator's synthetic team. Returns null instead of creating anything. */
async function findSyntheticTeam(ctx: QueryCtx) {
  const identity = await requireCli(ctx);
  const caregiver = await ctx.db.query("appUsers").withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
  if (!caregiver) return null;
  const relationship = await ctx.db.query("careRelationships").withIndex("by_caregiver", (q) => q.eq("caregiverId", caregiver._id)).first();
  const patient = relationship ? await ctx.db.get("appUsers", relationship.patientId) : null;
  if (!patient?.isSynthetic) return null;
  const device = await ctx.db.query("devices").withIndex("by_patient", (q) => q.eq("patientId", patient._id)).first();
  return device ? { caregiver, patient, device } : null;
}

async function describeActiveSlot(ctx: QueryCtx, team: NonNullable<Awaited<ReturnType<typeof findSyntheticTeam>>>, slot: number) {
  const assignments = await ctx.db.query("compartmentAssignments").withIndex("by_device_and_slot", (q) => q.eq("deviceId", team.device._id).eq("slot", slot)).take(20);
  const assignment = assignments.find((row) => row.active && row.patientId === team.patient._id);
  if (!assignment) return null;
  const medication = await ctx.db.get("medications", assignment.medicationId);
  return {
    assignmentId: assignment._id, medicationId: assignment.medicationId,
    medication: medication?.name ?? "Unknown", synthetic: !!medication?.demoSeedKey,
    scannedOrUserEntered: medication ? isUserOrScanned(medication) : true,
    activeIngredient: medication?.productDetails?.activeIngredient ?? null,
    strength: medication?.productDetails?.strength ?? null,
    estimatedSupplyCount: assignment.estimatedSupplyCount ?? null,
  };
}

const releasableSlot = v.number();

/** Step 1 of releasing a slot: shows exactly what would be deactivated. Read-only. */
export const describeSlot = query({
  args: { slot: releasableSlot },
  handler: async (ctx, args) => {
    const team = await findSyntheticTeam(ctx);
    if (!team) throw new ConvexError("Demo CLI refuses to operate without a synthetic patient and dispenser");
    if (!Number.isInteger(args.slot) || args.slot < 1 || args.slot > 7) throw new ConvexError("Slot must be 1 through 7");
    return { slot: args.slot, assignment: await describeActiveSlot(ctx, team, args.slot) };
  },
});

/**
 * Step 2: deactivates one slot's active assignment on the synthetic dispenser only. The medication, schedule, and
 * every historical row are kept (set inactive, never deleted). No device command, motor, or inventory write happens.
 */
export const releaseSlot = mutation({
  args: { slot: v.number(), assignmentId: v.id("compartmentAssignments"), confirm: v.string() },
  handler: async (ctx, args) => {
    const team = await findSyntheticTeam(ctx);
    if (!team) throw new ConvexError("Demo CLI refuses to operate without a synthetic patient and dispenser");
    if (!Number.isInteger(args.slot) || args.slot < 1 || args.slot > 7) throw new ConvexError("Slot must be 1 through 7");
    if (args.confirm !== `RELEASE SLOT ${args.slot}`) throw new ConvexError(`Confirmation must be exactly "RELEASE SLOT ${args.slot}"`);
    const assignment = await ctx.db.get("compartmentAssignments", args.assignmentId);
    if (!assignment || !assignment.active || assignment.slot !== args.slot ||
        assignment.patientId !== team.patient._id || assignment.deviceId !== team.device._id) {
      throw new ConvexError("That assignment is not the active synthetic assignment for this slot; nothing was changed");
    }
    const commands = await ctx.db.query("dispenseCommands").withIndex("by_patient", (q) => q.eq("patientId", team.patient._id)).order("desc").take(50);
    if (commands.some((row) => row.assignmentId === assignment._id && row.status !== "COMPLETED")) {
      throw new ConvexError("A dispense for this slot is not settled; resolve it in the Hardware Lab before releasing the slot");
    }
    const medication = await ctx.db.get("medications", assignment.medicationId);
    await ctx.db.patch("compartmentAssignments", assignment._id, { active: false });
    if (medication) {
      const others = await ctx.db.query("compartmentAssignments").withIndex("by_medication", (q) => q.eq("medicationId", medication._id)).take(10);
      if (!others.some((row) => row.active && row._id !== assignment._id)) await deactivateMedication(ctx, medication);
    }
    return { released: true, slot: args.slot, medication: medication?.name ?? null, historyPreserved: true, deviceCommandIssued: false };
  },
});

/** Compares the synthetic dispenser with the final CalHacks layout. Read-only. */
export const finalStatus = query({
  args: {},
  handler: async (ctx) => {
    const team = await findSyntheticTeam(ctx);
    if (!team) return { ready: false, reason: "No synthetic patient and dispenser yet. Run npm run demo:seed." };
    const slots: Record<string, string | null> = {};
    for (let slot = 1; slot <= 7; slot += 1) slots[String(slot)] = (await describeActiveSlot(ctx, team, slot))?.medication ?? null;
    const medications = await ctx.db.query("medications").withIndex("by_patient", (q) => q.eq("patientId", team.patient._id)).take(100);
    const activeNames = medications.filter((row) => row.active).map((row) => row.name.toLocaleLowerCase());
    const mismatches = [
      ...DEMO_BASELINE.filter((spec) => slots[String(spec.slot)]?.toLocaleLowerCase() !== spec.name.toLocaleLowerCase())
        .map((spec) => ({ slot: spec.slot, expected: spec.name, actual: slots[String(spec.slot)] })),
      ...RESERVED_EMPTY_SLOTS.filter((slot) => slots[String(slot)] !== null)
        .map((slot) => ({ slot, expected: null, actual: slots[String(slot)] })),
    ];
    return {
      ready: mismatches.length === 0,
      slots,
      mismatches,
      duplicateActiveNames: activeNames.filter((name, index) => activeNames.indexOf(name) !== index),
    };
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
      return {
        scenario: args.scenario,
        ready: true,
        runId: dose.runId,
        occurrenceId: dose.occurrenceId,
        medication: dose.medication,
        slot: dose.slot,
      };
    }
    const seeded = await seedRequired(ctx, team, ADVIL);
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
