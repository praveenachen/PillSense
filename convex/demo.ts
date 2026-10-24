import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { resolveDashboardPatient } from "./lib/authorization";
import { WEEKDAYS, validateSchedule } from "./lib/medicationValidation";
import { occurrenceTimesForWindow } from "./lib/scheduleTime";
import { requireIdentity } from "./lib/requireIdentity";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const showcaseMedications = [
  { name: "Vitamin D", instructions: "1 tablet · With breakfast", slot: 1, localTime: "08:00", report: "TAKEN" as const },
  { name: "Iron Supplement", instructions: "1 tablet · With water", slot: 6, localTime: "09:00", report: "TAKEN" as const },
  { name: "Omega-3", instructions: "1 capsule · With lunch", slot: 3, localTime: "13:00", report: "NOT_TAKEN" as const },
  { name: "Magnesium", instructions: "1 tablet · With evening meal", slot: 5, localTime: "20:00", report: "UNREPORTED" as const },
] as const;

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

    const refreshedMedications = await ctx.db
      .query("medications")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .take(16);
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

    return { medicationsCreated, occurrencesCreated };
  },
});
