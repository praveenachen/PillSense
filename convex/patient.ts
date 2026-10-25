import { query } from "./_generated/server";
import { getActiveDeviceAssignments } from "./lib/activeDeviceAssignments";
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
    const device = await ctx.db
      .query("devices")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .unique();
    if (!device) {
      return { status: "unavailable" as const };
    }
    const activeAssignments = await getActiveDeviceAssignments(
      ctx,
      patient._id,
      device._id,
    );
    const rows = await Promise.all(
      activeAssignments.map(async (assignment) => {
        const medication = await ctx.db.get("medications", assignment.medicationId);
        const schedule = await ctx.db
          .query("medicationSchedules")
          .withIndex("by_medication", (q) =>
            q.eq("medicationId", assignment.medicationId),
          )
          .unique();
        if (!medication || !medication.active) {
          return null;
        }
        return {
          id: medication._id,
          name: medication.name,
          instructions: medication.instructions,
          productDetails: medication.productDetails ?? null,
          slot: assignment.slot,
          demoInventory: assignment.demoInventory,
          supplyCount: assignment.estimatedSupplyCount ?? null,
          localTime: schedule?.active ? schedule.localTime : null,
          weekdays: schedule?.active ? schedule.weekdays : [],
          timezone: schedule?.active ? schedule.timezone : null,
        };
      }),
    );

    return {
      status: "ready" as const,
      patientId: patient._id,
      deviceId: device._id,
      patientName: patient.displayName,
      isSynthetic: patient.isSynthetic,
      medications: rows
        .filter((row) => row !== null)
        .sort((a, b) =>
          a.localTime === b.localTime
            ? a.slot - b.slot
            : (a.localTime ?? "99:99").localeCompare(b.localTime ?? "99:99"),
        ),
    };
  },
});
