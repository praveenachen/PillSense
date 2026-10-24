import { query } from "./_generated/server";
import { resolveDashboardPatient } from "./lib/authorization";

export const latestForCaregiver = query({
  args: {},
  handler: async (ctx) => {
    const { viewer, patient } = await resolveDashboardPatient(ctx);
    if (viewer.role !== "caregiver") return { status: "unauthorized" as const, activity: [] };
    const commands = await ctx.db
      .query("dispenseCommands")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .order("desc")
      .take(20);
    const activity = await Promise.all(
      commands.map(async (command) => {
        const [medication, occurrence, assignment] = await Promise.all([
          ctx.db.get("medications", command.medicationId),
          ctx.db.get("doseOccurrences", command.occurrenceId),
          ctx.db.get("compartmentAssignments", command.assignmentId),
        ]);
        if (!medication || !occurrence || !assignment) return null;
        return {
          commandId: command.commandId,
          medicationName: medication.name,
          slot: command.slot,
          status: command.status,
          motorCompletion: command.motorCompletion,
          pillRelease: command.pillRelease,
          pillCollection: command.pillCollection,
          ingestionReport: occurrence.ingestionReport,
          demoInventory: assignment.demoInventory,
          updatedAt: command.updatedAt,
          requiresReview: command.status === "UNKNOWN",
        };
      }),
    );
    return {
      status: "ready" as const,
      patientName: patient.displayName,
      activity: activity.filter((row) => row !== null),
    };
  },
});
