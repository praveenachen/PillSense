import { query } from "./_generated/server";
import { requireIdentity } from "./lib/requireIdentity";

export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const viewer = await ctx.db
      .query("appUsers")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!viewer) {
      return { status: "needs_onboarding" as const };
    }

    let patient = viewer;
    if (viewer.role === "caregiver") {
      const relationship = await ctx.db
        .query("careRelationships")
        .withIndex("by_caregiver", (q) => q.eq("caregiverId", viewer._id))
        .first();
      if (!relationship || relationship.status !== "active") {
        return { status: "unauthorized" as const };
      }
      const pairedPatient = await ctx.db.get("appUsers", relationship.patientId);
      if (!pairedPatient || pairedPatient.role !== "patient") {
        return { status: "unavailable" as const };
      }
      patient = pairedPatient;
    }
    const assignments = await ctx.db
      .query("compartmentAssignments")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .take(7);
    const activeAssignments = assignments.filter((assignment) => assignment.active);
    const rows = await Promise.all(
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
          id: medication._id,
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
      patientName: patient.displayName,
      isSynthetic: patient.isSynthetic,
      medications: rows
        .filter((row) => row !== null)
        .sort((a, b) =>
          a.localTime === b.localTime
            ? a.slot - b.slot
            : a.localTime.localeCompare(b.localTime),
        ),
    };
  },
});
