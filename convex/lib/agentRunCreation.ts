import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function createOrReuseAdherenceRun(
  ctx: MutationCtx,
  careCase: Doc<"careCases">,
  requestedBy: Id<"appUsers">,
  now: number,
  options: {
    source: "CAREGIVER_UI" | "AGENTVERSE";
    agentverseRequestId?: Id<"agentverseRequests">;
  },
) {
  const existingRuns = await ctx.db
    .query("agentRuns")
    .withIndex("by_case", (q) => q.eq("careCaseId", careCase._id))
    .order("desc")
    .take(20);
  const active = existingRuns.find(
    (run) => run.status === "PENDING" || run.status === "RUNNING",
  );
  if (active) {
    if (active.caseVersion === careCase.caseVersion) {
      return { runId: active._id, status: active.status, created: false };
    }
    await ctx.db.patch("agentRuns", active._id, {
      status: "FAILED",
      failureCode: "STALE_CASE_VERSION",
      updatedAt: now,
      completedAt: now,
    });
  }
  const completed = existingRuns.find(
    (run) => run.caseVersion === careCase.caseVersion && run.status === "COMPLETED",
  );
  if (completed) {
    return { runId: completed._id, status: completed.status, created: false };
  }

  const attempt =
    existingRuns.filter((run) => run.caseVersion === careCase.caseVersion).length + 1;
  const runId = await ctx.db.insert("agentRuns", {
    runId: `${careCase.caseId}:v${careCase.caseVersion}:attempt${attempt}`,
    careCaseId: careCase._id,
    patientId: careCase.patientId,
    caseVersion: careCase.caseVersion,
    triggerReason: careCase.triggerReason,
    workflowType: "ADHERENCE_INVESTIGATION",
    source: options.source,
    agentverseRequestId: options.agentverseRequestId,
    status: "PENDING",
    requestedBy,
    claimIdempotencyKey: null,
    provider: null,
    model: null,
    findings: null,
    failureCode: null,
    submissionIdempotencyKey: null,
    createdAt: now,
    updatedAt: now,
    claimedAt: null,
    completedAt: null,
  });
  await ctx.db.patch("careCases", careCase._id, {
    investigationStatus: "PENDING",
    updatedAt: now,
  });
  return { runId, status: "PENDING" as const, created: true };
}

export async function createOrReuseRefillRun(
  ctx: MutationCtx,
  refillCase: Doc<"refillCases">,
  requestedBy: Id<"appUsers">,
  now: number,
  options: { source: "CAREGIVER_UI" | "AGENTVERSE"; agentverseRequestId?: Id<"agentverseRequests"> },
) {
  const runs = await ctx.db.query("agentRuns")
    .withIndex("by_refill_case", (q) => q.eq("refillCaseId", refillCase._id))
    .order("desc").take(20);
  const active = runs.find((run) => run.status === "PENDING" || run.status === "RUNNING");
  if (active?.caseVersion === refillCase.caseVersion) return { runId: active._id, status: active.status, created: false };
  if (active) await ctx.db.patch("agentRuns", active._id, {
    status: "FAILED", failureCode: "STALE_CASE_VERSION", updatedAt: now, completedAt: now,
  });
  const completed = runs.find((run) => run.caseVersion === refillCase.caseVersion && run.status === "COMPLETED");
  if (completed) return { runId: completed._id, status: completed.status, created: false };
  const attempt = runs.filter((run) => run.caseVersion === refillCase.caseVersion).length + 1;
  const runId = await ctx.db.insert("agentRuns", {
    runId: `${refillCase.caseId}:v${refillCase.caseVersion}:attempt${attempt}`,
    refillCaseId: refillCase._id, patientId: refillCase.patientId,
    caseVersion: refillCase.caseVersion, triggerReason: refillCase.triggerReason,
    workflowType: "REFILL_INVESTIGATION", source: options.source,
    agentverseRequestId: options.agentverseRequestId, status: "PENDING",
    requestedBy, claimIdempotencyKey: null, provider: null, model: null,
    findings: null, failureCode: null, submissionIdempotencyKey: null,
    createdAt: now, updatedAt: now, claimedAt: null, completedAt: null,
  });
  await ctx.db.patch("refillCases", refillCase._id, { investigationStatus: "PENDING", updatedAt: now });
  return { runId, status: "PENDING" as const, created: true };
}
