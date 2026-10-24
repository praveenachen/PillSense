import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireIdentity } from "./lib/requireIdentity";

export const setup = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const caregiver = await ctx.db
      .query("appUsers")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (!caregiver) {
      return { status: "needs_onboarding" as const };
    }
    if (caregiver.role !== "caregiver") {
      return { status: "unauthorized" as const };
    }

    const relationship = await ctx.db
      .query("careRelationships")
      .withIndex("by_caregiver", (q) => q.eq("caregiverId", caregiver._id))
      .first();
    if (!relationship) {
      return { status: "needs_onboarding" as const };
    }

    const patient = await ctx.db.get("appUsers", relationship.patientId);
    const device = await ctx.db
      .query("devices")
      .withIndex("by_patient", (q) => q.eq("patientId", relationship.patientId))
      .unique();
    if (!patient || !device) {
      return { status: "unavailable" as const };
    }

    const assignments = await ctx.db
      .query("compartmentAssignments")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .take(7);
    const activeAssignments = assignments.filter((assignment) => assignment.active);
    const medicationRows = await Promise.all(
      activeAssignments.map(async (assignment) => {
        const medication = await ctx.db.get("medications", assignment.medicationId);
        const schedule = await ctx.db
          .query("medicationSchedules")
          .withIndex("by_medication", (q) =>
            q.eq("medicationId", assignment.medicationId),
          )
          .unique();
        if (!medication || !schedule || !medication.active || !schedule.active) {
          return null;
        }
        return {
          medicationId: medication._id,
          name: medication.name,
          instructions: medication.instructions,
          slot: assignment.slot,
          demoInventory: assignment.demoInventory,
          localTime: schedule.localTime,
          weekdays: schedule.weekdays,
          timezone: schedule.timezone,
        };
      }),
    );

    return {
      status: "ready" as const,
      caregiverName: caregiver.displayName,
      patient: { id: patient._id, displayName: patient.displayName },
      device: { id: device._id, label: device.label },
      medications: medicationRows
        .filter((row) => row !== null)
        .sort((a, b) => a.slot - b.slot),
    };
  },
});

export const canAccessPatient = query({
  args: { patientId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const caregiver = await ctx.db
      .query("appUsers")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!caregiver || caregiver.role !== "caregiver") {
      return false;
    }
    const relationship = await ctx.db
      .query("careRelationships")
      .withIndex("by_caregiver_and_patient", (q) =>
        q.eq("caregiverId", caregiver._id).eq("patientId", args.patientId),
      )
      .unique();
    return relationship?.status === "active";
  },
});
