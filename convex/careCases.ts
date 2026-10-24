import { ConvexError, v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { requireCaregiverAccess, resolveDashboardPatient } from "./lib/authorization";

const outcomeValidator = v.union(
  v.literal("FOLLOW_UP_REQUIRED"),
  v.literal("CONTACTED_PATIENT"),
  v.literal("DEVICE_REVIEW"),
  v.literal("NO_FURTHER_ACTION"),
  v.literal("OTHER"),
);

const recommendations = {
  NO_PATIENT_RESPONSE: "Contact the patient or follow the care team's established check-in process.",
  MOTOR_COMPLETED_INGESTION_UNCONFIRMED:
    "Confirm with the patient. Motor completion does not verify release, collection, or ingestion.",
  MOTOR_OUTCOME_UNKNOWN:
    "Review device evidence and reconcile the physical dispenser before considering any new command.",
  PATIENT_REPORTED_NOT_TAKEN:
    "Review the patient's report using the care team's established process; PillSense does not recommend a catch-up dose.",
  DEVICE_FAULT_OR_DISCONNECTED:
    "Inspect device connectivity and alignment. Do not automatically retry an ambiguous dispense.",
} as const;

export const listForCaregiver = query({
  args: {},
  handler: async (ctx) => {
    const { viewer, patient } = await resolveDashboardPatient(ctx);
    if (viewer.role !== "caregiver") {
      return { status: "unauthorized" as const, cases: [] };
    }
    const [open, acknowledged, resolved] = await Promise.all([
      ctx.db
        .query("careCases")
        .withIndex("by_patient_and_status", (q) =>
          q.eq("patientId", patient._id).eq("status", "OPEN"),
        )
        .order("desc")
        .take(20),
      ctx.db
        .query("careCases")
        .withIndex("by_patient_and_status", (q) =>
          q.eq("patientId", patient._id).eq("status", "ACKNOWLEDGED"),
        )
        .order("desc")
        .take(20),
      ctx.db
        .query("careCases")
        .withIndex("by_patient_and_status", (q) =>
          q.eq("patientId", patient._id).eq("status", "RESOLVED"),
        )
        .order("desc")
        .take(10),
    ]);
    const cases = [...open, ...acknowledged, ...resolved]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 30);
    const rows = await Promise.all(
      cases.map(async (careCase) => {
        const occurrence = await ctx.db.get("doseOccurrences", careCase.occurrenceId);
        if (!occurrence) return null;
        const [medication, transitions, agentRuns] = await Promise.all([
          ctx.db.get("medications", occurrence.medicationId),
          ctx.db
            .query("careCaseTransitions")
            .withIndex("by_case", (q) => q.eq("caseId", careCase._id))
            .order("desc")
            .take(20),
          ctx.db
            .query("agentRuns")
            .withIndex("by_case", (q) => q.eq("careCaseId", careCase._id))
            .order("desc")
            .take(1),
        ]);
        if (!medication) return null;
        return {
          id: careCase._id,
          caseId: careCase.caseId,
          caseVersion: careCase.caseVersion,
          occurrenceId: careCase.occurrenceId,
          patientName: patient.displayName,
          medicationName: medication.name,
          dueAt: occurrence.scheduledFor,
          triggerReason: careCase.triggerReason,
          status: careCase.status,
          recommendation: recommendations[careCase.triggerReason],
          evidenceReferences: careCase.evidenceReferences,
          investigationStatus: careCase.investigationStatus,
          syntheticPatient: patient.isSynthetic,
          agentRun: agentRuns[0]
            ? {
                id: agentRuns[0]._id,
                status: agentRuns[0].status,
                provider: agentRuns[0].provider,
                model: agentRuns[0].model,
                findings: agentRuns[0].findings,
                failureCode: agentRuns[0].failureCode,
                updatedAt: agentRuns[0].updatedAt,
              }
            : null,
          resolutionNote: careCase.resolutionNote,
          resolutionOutcome: careCase.resolutionOutcome,
          updatedAt: careCase.updatedAt,
          transitions: transitions.map((transition) => ({
            type: transition.type,
            fromStatus: transition.fromStatus,
            toStatus: transition.toStatus,
            note: transition.note ?? null,
            outcome: transition.outcome ?? null,
            occurredAt: transition.occurredAt,
          })),
        };
      }),
    );
    return {
      status: "ready" as const,
      patientName: patient.displayName,
      cases: rows.filter((row) => row !== null),
    };
  },
});

export const updateStatus = mutation({
  args: {
    careCaseId: v.id("careCases"),
    action: v.union(v.literal("ACKNOWLEDGE"), v.literal("RESOLVE")),
    note: v.string(),
    outcome: outcomeValidator,
  },
  handler: async (ctx, args) => {
    const careCase = await ctx.db.get("careCases", args.careCaseId);
    if (!careCase) throw new ConvexError("Care case is unavailable");
    const { caregiver } = await requireCaregiverAccess(ctx, careCase.patientId);
    const note = args.note.trim();
    if (note.length < 1 || note.length > 500) {
      throw new ConvexError("Resolution note must contain 1 to 500 characters");
    }
    const status = args.action === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : "RESOLVED";
    if (
      careCase.status === status &&
      careCase.resolutionNote === note &&
      careCase.resolutionOutcome === args.outcome
    ) {
      return { status, duplicate: true };
    }
    if (careCase.status === "RESOLVED") {
      throw new ConvexError("Resolved care cases cannot be acknowledged or rewritten");
    }
    const now = Date.now();
    await ctx.db.patch("careCases", careCase._id, {
      status,
      acknowledgedBy: caregiver._id,
      acknowledgedAt: now,
      resolutionNote: note,
      resolutionOutcome: args.outcome,
      updatedAt: now,
    });
    await ctx.db.insert("careCaseTransitions", {
      caseId: careCase._id,
      patientId: careCase.patientId,
      type: args.action === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : "RESOLVED",
      fromStatus: careCase.status,
      toStatus: status,
      actorId: caregiver._id,
      note,
      outcome: args.outcome,
      occurredAt: now,
    });
    return { status, duplicate: false };
  },
});

export const agentPayload = internalQuery({
  args: { careCaseId: v.id("careCases") },
  handler: async (ctx, args) => {
    const careCase = await ctx.db.get("careCases", args.careCaseId);
    if (!careCase) return null;
    return {
      caseId: careCase.caseId,
      patientScope: { patientId: careCase.patientId },
      occurrenceId: careCase.occurrenceId,
      caseVersion: careCase.caseVersion,
      triggerReason: careCase.triggerReason,
      evidenceReferences: careCase.evidenceReferences,
      investigationStatus: careCase.investigationStatus,
    };
  },
});
