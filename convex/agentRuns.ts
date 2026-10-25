import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireCaregiverAccess, resolveDashboardPatient } from "./lib/authorization";
import { createOrReuseAdherenceRun, createOrReuseRefillRun } from "./lib/agentRunCreation";

export const requestInvestigation = mutation({
  args: { careCaseId: v.id("careCases") },
  handler: async (ctx, args) => {
    const careCase = await ctx.db.get("careCases", args.careCaseId);
    if (!careCase) throw new ConvexError("Care case is unavailable");
    const { caregiver } = await requireCaregiverAccess(ctx, careCase.patientId);
    const patient = await ctx.db.get("appUsers", careCase.patientId);
    if (!patient?.isSynthetic) {
      throw new ConvexError("AI investigation is currently limited to synthetic demo patients");
    }
    if (careCase.status !== "OPEN") {
      throw new ConvexError("Only open care cases can be investigated");
    }

    const now = Date.now();
    return await createOrReuseAdherenceRun(ctx, careCase, caregiver._id, now, {
      source: "CAREGIVER_UI",
    });
  },
});

export const requestRefillInvestigation = mutation({
  args: { refillCaseId: v.id("refillCases") },
  handler: async (ctx, args) => {
    const refillCase = await ctx.db.get("refillCases", args.refillCaseId);
    if (!refillCase) throw new ConvexError("Refill case is unavailable");
    const { caregiver } = await requireCaregiverAccess(ctx, refillCase.patientId);
    const patient = await ctx.db.get("appUsers", refillCase.patientId);
    if (!patient?.isSynthetic) throw new ConvexError("AI investigation is currently limited to synthetic demo patients");
    if (!["OPEN", "REVIEWED", "REFILL_REQUESTED"].includes(refillCase.status)) throw new ConvexError("Only active refill cases can be investigated");
    return createOrReuseRefillRun(ctx, refillCase, caregiver._id, Date.now(), { source: "CAREGIVER_UI" });
  },
});

export const listForCaregiver = query({
  args: {},
  handler: async (ctx) => {
    const { viewer, patient } = await resolveDashboardPatient(ctx);
    if (viewer.role !== "caregiver") {
      return { status: "unauthorized" as const, runs: [] };
    }
    const runs = await ctx.db
      .query("agentRuns")
      .withIndex("by_patient_and_createdAt", (q) => q.eq("patientId", patient._id))
      .order("desc")
      .take(30);
    const rows = await Promise.all(
      runs.map(async (run) => {
        const [caseRecord, actions] = await Promise.all([
          run.workflowType === "REFILL_INVESTIGATION" && run.refillCaseId
            ? ctx.db.get("refillCases", run.refillCaseId)
            : run.careCaseId ? ctx.db.get("careCases", run.careCaseId) : null,
          ctx.db
            .query("agentActions")
            .withIndex("by_run_and_startedAt", (q) => q.eq("runId", run._id))
            .order("asc")
            .take(20),
        ]);
        if (!caseRecord || caseRecord.patientId !== patient._id) return null;
        return {
          id: run._id,
          runId: run.runId,
          careCaseId: run.careCaseId ?? run.refillCaseId,
          caseId: caseRecord.caseId,
          caseVersion: run.caseVersion,
          triggerReason: run.triggerReason,
          workflowType: run.workflowType,
          status: run.status,
          provider: run.provider,
          model: run.model,
          findings: run.findings,
          failureCode: run.failureCode,
          createdAt: run.createdAt,
          claimedAt: run.claimedAt,
          completedAt: run.completedAt,
          actions: actions.map((action) => ({
            actionId: action.actionId,
            kind: action.kind,
            toolName: action.toolName,
            status: action.status,
            summary: action.summary,
            evidenceReferences: action.evidenceReferences,
            errorCode: action.errorCode,
            startedAt: action.startedAt,
            completedAt: action.completedAt,
          })),
        };
      }),
    );
    return {
      status: "ready" as const,
      patientName: patient.displayName,
      runs: rows.filter((row) => row !== null),
    };
  },
});
