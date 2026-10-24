import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation } from "./_generated/server";
import { resolveDashboardPatient } from "./lib/authorization";
import { WEEKDAYS, validateSchedule } from "./lib/medicationValidation";
import { occurrenceTimesForWindow } from "./lib/scheduleTime";
import { requireIdentity } from "./lib/requireIdentity";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const showcaseMedications = [
  { name: "Vitamin D", instructions: "1 tablet · Eat with breakfast", slot: 1, localTime: "08:00", report: "TAKEN" as const },
  { name: "Omega-3", instructions: "1 capsule · Eat with lunch", slot: 3, localTime: "13:00", report: "NOT_TAKEN" as const },
  { name: "Magnesium", instructions: "1 tablet · Eat with dinner", slot: 5, localTime: "20:00", report: "UNREPORTED" as const },
] as const;

const seededInstructions: Record<string, string> = {
  "iron pills": "1 tablet · Eat with breakfast",
  "vitamin d": "1 tablet · Eat with breakfast",
  "iron supplement": "1 tablet · Drink with water",
  "omega-3": "1 capsule · Eat with lunch",
  magnesium: "1 tablet · Eat with dinner",
};
// Older wording that the seeded phrases above replace.
// Demo pill counts so the dispenser shows a mix of healthy and low supply.
const seededCounts: Record<string, number> = {
  "vitamin d": 28,
  "iron supplement": 6,
  "omega-3": 17,
  magnesium: 3,
  "iron pills": 12,
};
const legacyInstructions = new Set([
  "", "synthetic demo only", "1 tablet · with breakfast", "1 tablet · with water",
  "1 capsule · with lunch", "1 tablet · with evening meal", "1 tablet · eat with dinner",
]);

/** Care cases left open in the demo so the Care tab shows a couple of real follow-ups. */
const KEEP_OPEN_CASES = 2;

const careActivityShowcase = [
  {
    key: "needs-attention",
    medicationName: "Omega-3",
    minutesAgo: 38,
    report: "NOT_TAKEN" as const,
    triggerReason: "PATIENT_REPORTED_NOT_TAKEN" as const,
    status: "OPEN" as const,
    note: null,
    outcome: null,
  },
  {
    key: "in-progress",
    medicationName: "Magnesium",
    minutesAgo: 150,
    report: "UNREPORTED" as const,
    triggerReason: "NO_PATIENT_RESPONSE" as const,
    status: "ACKNOWLEDGED" as const,
    note: "Caregiver follow-up is underway.",
    outcome: "FOLLOW_UP_REQUIRED" as const,
  },
  {
    key: "resolved",
    medicationName: "Vitamin D",
    minutesAgo: 24 * 60,
    report: "TAKEN" as const,
    triggerReason: "NO_PATIENT_RESPONSE" as const,
    status: "RESOLVED" as const,
    note: "Patient later reported the dose taken.",
    outcome: "NO_FURTHER_ACTION" as const,
  },
  {
    key: "resolved-2",
    medicationName: "Omega-3",
    minutesAgo: 2 * 24 * 60,
    report: "TAKEN" as const,
    triggerReason: "NO_PATIENT_RESPONSE" as const,
    status: "RESOLVED" as const,
    note: "Patient later reported the dose taken.",
    outcome: "NO_FURTHER_ACTION" as const,
  },
  {
    key: "resolved-3",
    medicationName: "Magnesium",
    minutesAgo: 3 * 24 * 60,
    report: "TAKEN" as const,
    triggerReason: "NO_PATIENT_RESPONSE" as const,
    status: "RESOLVED" as const,
    note: "Patient later reported the dose taken.",
    outcome: "NO_FURTHER_ACTION" as const,
  },
  {
    key: "resolved-4",
    medicationName: "Vitamin D",
    minutesAgo: 4 * 24 * 60,
    report: "TAKEN" as const,
    triggerReason: "NO_PATIENT_RESPONSE" as const,
    status: "RESOLVED" as const,
    note: "Patient later reported the dose taken.",
    outcome: "NO_FURTHER_ACTION" as const,
  },
  {
    key: "resolved-5",
    medicationName: "Iron Pills",
    minutesAgo: 5 * 24 * 60,
    report: "TAKEN" as const,
    triggerReason: "NO_PATIENT_RESPONSE" as const,
    status: "RESOLVED" as const,
    note: "Patient later reported the dose taken.",
    outcome: "NO_FURTHER_ACTION" as const,
  },
] as const;

async function removeCareCase(ctx: MutationCtx, careCase: Doc<"careCases">) {
  const transitions = await ctx.db.query("careCaseTransitions").withIndex("by_case", (q) => q.eq("caseId", careCase._id)).take(30);
  for (const transition of transitions) await ctx.db.delete("careCaseTransitions", transition._id);
  await ctx.db.delete("careCases", careCase._id);
}

async function cleanLegacyCareShowcase(ctx: MutationCtx, patientId: Id<"appUsers">) {
  const occurrences = await ctx.db
    .query("doseOccurrences")
    .withIndex("by_patient_and_scheduledFor", (q) => q.eq("patientId", patientId))
    .order("desc")
    .take(100);
  let removed = 0;
  for (const occurrence of occurrences) {
    const isLegacyReminder = occurrence.occurrenceKey.startsWith("reminder-demo:");
    const isOldDashboardCase = occurrence.occurrenceKey.startsWith("dashboard-showcase:");
    if (!isLegacyReminder && !isOldDashboardCase) continue;
    const careCase = await ctx.db.query("careCases").withIndex("by_occurrence", (q) => q.eq("occurrenceId", occurrence._id)).unique();
    if (!careCase) continue;
    const [agentRuns, agentverseScopes, commands] = await Promise.all([
      ctx.db.query("agentRuns").withIndex("by_case", (q) => q.eq("careCaseId", careCase._id)).take(1),
      ctx.db.query("agentverseScopes").withIndex("by_case", (q) => q.eq("careCaseId", careCase._id)).take(1),
      ctx.db.query("dispenseCommands").withIndex("by_occurrence", (q) => q.eq("occurrenceId", occurrence._id)).take(1),
    ]);
    if (agentRuns.length > 0 || agentverseScopes.length > 0 || commands.length > 0) continue;
    await removeCareCase(ctx, careCase);
    removed += 1;

    // Old dashboard occurrences still power the Today screen. Only standalone reminder-demo records are removable.
    if (!isLegacyReminder) continue;
    const reminders = await ctx.db.query("reminderEvents").withIndex("by_occurrence", (q) => q.eq("occurrenceId", occurrence._id)).take(20);
    for (const reminder of reminders) await ctx.db.delete("reminderEvents", reminder._id);
    if (occurrence.demoScenarioRunId) {
      const run = await ctx.db.get("demoScenarioRuns", occurrence.demoScenarioRunId);
      if (run) await ctx.db.delete("demoScenarioRuns", run._id);
    }
    await ctx.db.delete("doseOccurrences", occurrence._id);
  }
  return removed;
}

async function seedCareActivityShowcase(
  ctx: MutationCtx,
  patientId: Id<"appUsers">,
  caregiverId: Id<"appUsers">,
  medications: Doc<"medications">[],
  now: number,
) {
  let created = 0;
  for (const seed of careActivityShowcase) {
    const medication = medications.find((item) => item.active && item.name.toLocaleLowerCase() === seed.medicationName.toLocaleLowerCase());
    if (!medication) continue;
    const schedule = await ctx.db.query("medicationSchedules").withIndex("by_medication", (q) => q.eq("medicationId", medication._id)).unique();
    if (!schedule?.active) continue;
    const occurrenceKey = `care-activity-showcase:v1:${patientId}:${seed.key}`;
    let occurrence = await ctx.db.query("doseOccurrences").withIndex("by_occurrenceKey", (q) => q.eq("occurrenceKey", occurrenceKey)).unique();
    if (!occurrence) {
      const scheduledFor = now - seed.minutesAgo * MINUTE;
      const occurrenceId = await ctx.db.insert("doseOccurrences", {
        occurrenceKey,
        patientId,
        medicationId: medication._id,
        scheduleId: schedule._id,
        scheduleRevision: schedule.revision ?? 1,
        mode: "demo",
        scheduledFor,
        eligibleFrom: scheduledFor - 15 * MINUTE,
        expiresAt: scheduledFor + 30 * MINUTE,
        attemptStatus: "NONE",
        ingestionReport: seed.report,
        reminderState: seed.status === "RESOLVED" ? "RESOLVED" : "OVERDUE",
        reminderUpdatedAt: now,
        createdAt: now,
      });
      occurrence = await ctx.db.get("doseOccurrences", occurrenceId);
    }
    if (!occurrence) continue;
    const existing = await ctx.db.query("careCases").withIndex("by_occurrence", (q) => q.eq("occurrenceId", occurrence._id)).unique();
    if (existing) continue;
    const evidenceFingerprint = seed.status === "RESOLVED"
      ? "PATIENT_REPORTED_TAKEN"
      : JSON.stringify({
          triggerReason: seed.triggerReason,
          patientReport: seed.report,
          commandId: null,
          commandStatus: null,
          deviceEventIds: [],
        });
    const careCaseId = await ctx.db.insert("careCases", {
      caseId: `dashboard-care-showcase:v1:${patientId}:${seed.key}`,
      patientId,
      occurrenceId: occurrence._id,
      caseVersion: 1,
      triggerReason: seed.triggerReason,
      status: seed.status,
      evidenceFingerprint,
      evidenceReferences: {
        commandId: null,
        demoScenarioRunId: null,
        reminderEventIds: [],
        deviceEventIds: [],
        patientReport: seed.report,
      },
      investigationStatus: "NOT_REQUESTED",
      acknowledgedBy: seed.status === "OPEN" ? null : caregiverId,
      acknowledgedAt: seed.status === "OPEN" ? null : now,
      resolutionNote: seed.note,
      resolutionOutcome: seed.outcome,
      createdAt: occurrence.createdAt,
      updatedAt: occurrence.createdAt,
    });
    await ctx.db.insert("careCaseTransitions", {
      caseId: careCaseId,
      patientId,
      type: seed.status === "OPEN" ? "OPENED" : seed.status === "ACKNOWLEDGED" ? "ACKNOWLEDGED" : "RESOLVED",
      fromStatus: seed.status === "OPEN" ? null : "OPEN",
      toStatus: seed.status,
      ...(seed.status === "OPEN" ? {} : { actorId: caregiverId }),
      ...(seed.note ? { note: seed.note } : {}),
      ...(seed.outcome ? { outcome: seed.outcome } : {}),
      occurredAt: occurrence.createdAt,
    });
    created += 1;
  }
  return created;
}

function localDateKey(epochMs: number, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(epochMs);
}

export const ensureCareTeam = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const now = Date.now();
    let caregiver = await ctx.db
      .query("appUsers")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (caregiver && caregiver.role !== "caregiver") {
      throw new ConvexError("This account is not a caregiver account");
    }

    if (!caregiver) {
      const caregiverId = await ctx.db.insert("appUsers", {
        tokenIdentifier: identity.tokenIdentifier,
        displayName:
          identity.name ?? identity.givenName ?? identity.email ?? "Demo Caregiver",
        role: "caregiver",
        isSynthetic: false,
        createdAt: now,
      });
      caregiver = await ctx.db.get("appUsers", caregiverId);
    }

    if (!caregiver) {
      throw new ConvexError("Unable to create caregiver profile");
    }

    const existingRelationship = await ctx.db
      .query("careRelationships")
      .withIndex("by_caregiver", (q) => q.eq("caregiverId", caregiver._id))
      .first();

    if (existingRelationship) {
      return {
        caregiverId: caregiver._id,
        patientId: existingRelationship.patientId,
        created: false,
      };
    }

    const patientId = await ctx.db.insert("appUsers", {
      displayName: "Demo Patient",
      role: "patient",
      isSynthetic: true,
      createdAt: now,
    });
    await ctx.db.insert("careRelationships", {
      caregiverId: caregiver._id,
      patientId,
      status: "active",
      createdAt: now,
    });
    await ctx.db.insert("devices", {
      patientId,
      label: "PillSense Demo Dispenser",
      hardwareModel: "ARDUINO_UNO_R4_WIFI",
      physicalPositions: 8,
      createdAt: now,
    });

    return { caregiverId: caregiver._id, patientId, created: true };
  },
});

/**
 * Creates a stable, realistic-looking day for the authenticated synthetic demo only.
 * Every record is persisted and idempotent; the UI never invents a medication state.
 */
export const ensureDashboardShowcase = mutation({
  args: { timezone: v.string() },
  handler: async (ctx, args) => {
    validateSchedule("09:00", [...WEEKDAYS], args.timezone);
    const { viewer, patient } = await resolveDashboardPatient(ctx);
    if (!patient.isSynthetic || viewer.role !== "caregiver") {
      throw new ConvexError("Dashboard showcase data is limited to authenticated synthetic caregiver demos");
    }

    const now = Date.now();
    const device = await ctx.db
      .query("devices")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .unique();
    if (!device) throw new ConvexError("Synthetic demo device is unavailable");

    const assignments = await ctx.db
      .query("compartmentAssignments")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .take(7);
    const activeAssignments = assignments.filter((assignment) => assignment.active);
    const occupiedSlots = new Set(activeAssignments.map((assignment) => assignment.slot));
    const activeMedicationIds = new Set(activeAssignments.map((assignment) => assignment.medicationId));
    const medications = await ctx.db
      .query("medications")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .take(16);
    const activeNames = new Set(
      medications
        .filter((medication) => medication.active && activeMedicationIds.has(medication._id))
        .map((medication) => medication.name.toLocaleLowerCase()),
    );

    let medicationsCreated = 0;
    for (const item of showcaseMedications) {
      if (activeNames.has(item.name.toLocaleLowerCase())) continue;
      const slot = occupiedSlots.has(item.slot)
        ? [1, 2, 3, 4, 5, 6, 7].find((candidate) => !occupiedSlots.has(candidate))
        : item.slot;
      if (slot === undefined) break;
      const medicationId = await ctx.db.insert("medications", {
        patientId: patient._id,
        name: item.name,
        instructions: item.instructions,
        active: true,
        createdBy: viewer._id,
        createdAt: now,
      });
      await ctx.db.insert("medicationSchedules", {
        patientId: patient._id,
        medicationId,
        localTime: item.localTime,
        weekdays: [...WEEKDAYS],
        timezone: args.timezone,
        active: true,
        revision: 1,
        createdAt: now,
      });
      await ctx.db.insert("compartmentAssignments", {
        deviceId: device._id,
        patientId: patient._id,
        medicationId,
        slot,
        demoInventory: 1,
        active: true,
        assignedBy: viewer._id,
        createdAt: now,
      });
      occupiedSlots.add(slot);
      activeNames.add(item.name.toLocaleLowerCase());
      medicationsCreated += 1;
    }

    // Synthetic medications created without real instructions get a friendly seeded one.
    for (const medication of medications) {
      if (!medication.active) continue;
      const seeded = seededInstructions[medication.name.toLocaleLowerCase()];
      if (seeded && medication.instructions !== seeded && legacyInstructions.has(medication.instructions.trim().toLocaleLowerCase())) {
        await ctx.db.patch("medications", medication._id, { instructions: seeded });
      }
    }

    const refreshedMedications = await ctx.db
      .query("medications")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .take(16);
    // Keep the demo day uncluttered: retire demo medications that were seeded before and are no longer part of
    // the showcase, and keep only the oldest of any medications that share a name.
    const retiredShowcaseNames = new Set(["iron supplement"]);
    const seenNames = new Set<string>();
    for (const medication of [...refreshedMedications].sort((a, b) => a.createdAt - b.createdAt)) {
      if (!medication.active) continue;
      const key = medication.name.toLocaleLowerCase();
      if (!retiredShowcaseNames.has(key)) {
        if (!seenNames.has(key)) { seenNames.add(key); continue; }
      }
      await ctx.db.patch("medications", medication._id, { active: false });
      const schedules = await ctx.db.query("medicationSchedules").withIndex("by_medication", (q) => q.eq("medicationId", medication._id)).take(5);
      for (const schedule of schedules) if (schedule.active) await ctx.db.patch("medicationSchedules", schedule._id, { active: false });
      const retiredAssignments = await ctx.db.query("compartmentAssignments").withIndex("by_medication", (q) => q.eq("medicationId", medication._id)).take(5);
      for (const assignment of retiredAssignments) if (assignment.active) await ctx.db.patch("compartmentAssignments", assignment._id, { active: false });
    }

    const refreshedAssignments = (await ctx.db
      .query("compartmentAssignments")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .take(8)).filter((assignment) => assignment.active);
    for (const assignment of refreshedAssignments) {
      if (assignment.estimatedSupplyCount !== undefined) continue;
      const count = seededCounts[refreshedMedications.find((medication) => medication._id === assignment.medicationId)?.name.toLocaleLowerCase() ?? ""];
      if (count === undefined) continue;
      await ctx.db.patch("compartmentAssignments", assignment._id, {
        estimatedSupplyCount: count,
        supplyEstimateSource: "SYNTHETIC_DEMO",
        supplyEstimateUpdatedAt: now,
        supplyRevision: (assignment.supplyRevision ?? 0) + 1,
      });
    }
    const showcaseByName = new Map(showcaseMedications.map((item) => [item.name.toLocaleLowerCase(), item]));
    const todayKey = localDateKey(now, args.timezone);
    let occurrencesCreated = 0;

    for (const medication of refreshedMedications) {
      if (!medication.active) continue;
      const item = showcaseByName.get(medication.name.toLocaleLowerCase());
      if (!item) continue;
      const schedule = await ctx.db
        .query("medicationSchedules")
        .withIndex("by_medication", (q) => q.eq("medicationId", medication._id))
        .unique();
      if (!schedule?.active) continue;
      const scheduledFor = occurrenceTimesForWindow({
        now: now - DAY,
        windowEnd: now + DAY,
        localTime: schedule.localTime,
        weekdays: schedule.weekdays,
        timezone: schedule.timezone,
      }).find((epoch) => localDateKey(epoch, args.timezone) === todayKey);
      if (scheduledFor === undefined) continue;
      const occurrenceKey = `dashboard-showcase:${schedule._id}:${schedule.revision ?? 1}:${todayKey}`;
      const existing = await ctx.db
        .query("doseOccurrences")
        .withIndex("by_occurrenceKey", (q) => q.eq("occurrenceKey", occurrenceKey))
        .unique();
      if (existing) continue;
      await ctx.db.insert("doseOccurrences", {
        occurrenceKey,
        patientId: patient._id,
        medicationId: medication._id,
        scheduleId: schedule._id,
        scheduleRevision: schedule.revision ?? 1,
        mode: "demo",
        scheduledFor,
        eligibleFrom: scheduledFor - 15 * MINUTE,
        expiresAt: scheduledFor + 30 * MINUTE,
        attemptStatus: "NONE",
        ingestionReport: item.report,
        createdAt: now,
      });
      occurrencesCreated += 1;
    }

    const legacyCareCasesRemoved = await cleanLegacyCareShowcase(ctx, patient._id);
    const careCasesCreated = await seedCareActivityShowcase(ctx, patient._id, viewer._id, refreshedMedications, now);

    // Most demo follow-ups are done: of any other unresolved care cases, only the two most recent stay open.
    const unresolvedCases = (await Promise.all((["OPEN", "ACKNOWLEDGED"] as const).map((status) =>
      ctx.db.query("careCases").withIndex("by_patient_and_status", (q) => q.eq("patientId", patient._id).eq("status", status)).take(50),
    ))).flat().sort((a, b) => b.updatedAt - a.updatedAt);
    for (const careCase of unresolvedCases.slice(KEEP_OPEN_CASES)) {
      await ctx.db.patch("careCases", careCase._id, {
        status: "RESOLVED", acknowledgedBy: viewer._id, acknowledgedAt: now,
        resolutionNote: "Demo follow-up completed.", resolutionOutcome: "NO_FURTHER_ACTION", updatedAt: now,
      });
      await ctx.db.insert("careCaseTransitions", {
        caseId: careCase._id, patientId: patient._id, type: "RESOLVED", fromStatus: careCase.status, toStatus: "RESOLVED",
        actorId: viewer._id, note: "Demo follow-up completed.", outcome: "NO_FURTHER_ACTION", occurredAt: now,
      });
    }

    return { medicationsCreated, occurrencesCreated, careCasesCreated, legacyCareCasesRemoved };
  },
});
