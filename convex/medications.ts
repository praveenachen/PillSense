import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireCaregiverAccess } from "./lib/authorization";
import { reconcilePatientRefills } from "./refills";
import {
  validateDemoInventory,
  validateMedicationText,
  validateSchedule,
  validateSlot,
} from "./lib/medicationValidation";

const weekdayValidator = v.union(
  v.literal("SUN"),
  v.literal("MON"),
  v.literal("TUE"),
  v.literal("WED"),
  v.literal("THU"),
  v.literal("FRI"),
  v.literal("SAT"),
);

export const createWithAssignment = mutation({
  args: {
    patientId: v.id("appUsers"),
    name: v.string(),
    instructions: v.string(),
    slot: v.number(),
    localTime: v.string(),
    weekdays: v.array(weekdayValidator),
    timezone: v.string(),
    demoInventory: v.number(),
    /** Pills supplied for this slot; seeds the refill estimate. */
    supplyCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { caregiver } = await requireCaregiverAccess(ctx, args.patientId);
    if (args.supplyCount !== undefined && (!Number.isSafeInteger(args.supplyCount) || args.supplyCount < 0 || args.supplyCount > 10000)) {
      throw new ConvexError("Pill count must be a whole number from 0 to 10000");
    }
    validateSlot(args.slot);
    validateSchedule(args.localTime, args.weekdays, args.timezone);
    validateMedicationText(args.name, args.instructions);
    validateDemoInventory(args.demoInventory);

    const patient = await ctx.db.get("appUsers", args.patientId);
    if (!patient || patient.role !== "patient") {
      throw new ConvexError("Patient is unavailable");
    }

    const device = await ctx.db
      .query("devices")
      .withIndex("by_patient", (q) => q.eq("patientId", args.patientId))
      .unique();
    if (!device) {
      throw new ConvexError("Patient device is unavailable");
    }

    const slotAssignments = await ctx.db
      .query("compartmentAssignments")
      .withIndex("by_device_and_slot", (q) =>
        q.eq("deviceId", device._id).eq("slot", args.slot),
      )
      .take(2);
    if (slotAssignments.some((assignment) => assignment.active)) {
      throw new ConvexError(`Slot ${args.slot} already has an active medication assignment`);
    }

    const now = Date.now();
    const medicationId = await ctx.db.insert("medications", {
      patientId: args.patientId,
      name: args.name.trim(),
      instructions: args.instructions.trim(),
      active: true,
      createdBy: caregiver._id,
      createdAt: now,
    });
    await ctx.db.insert("medicationSchedules", {
      patientId: args.patientId,
      medicationId,
      localTime: args.localTime,
      weekdays: args.weekdays,
      timezone: args.timezone,
      active: true,
      revision: 1,
      createdAt: now,
    });
    const assignmentId = await ctx.db.insert("compartmentAssignments", {
      deviceId: device._id,
      patientId: args.patientId,
      medicationId,
      slot: args.slot,
      demoInventory: args.demoInventory,
      active: true,
      assignedBy: caregiver._id,
      createdAt: now,
      ...(args.supplyCount === undefined ? {} : {
        estimatedSupplyCount: args.supplyCount,
        supplyEstimateSource: "CAREGIVER_VERIFIED" as const,
        supplyEstimateUpdatedAt: now,
        supplyRevision: 1,
      }),
    });
    if (args.supplyCount !== undefined) await reconcilePatientRefills(ctx, args.patientId, now);

    return { medicationId, assignmentId, slot: args.slot };
  },
});
