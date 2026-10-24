import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { createOrReuseAdherenceRun } from "./lib/agentRunCreation";

const REQUEST_TYPE = "DEMO_ADHERENCE_INVESTIGATION" as const;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS_PATTERN = /^agent1[a-z0-9]{20,100}$/;
const ALIAS_PATTERN = /^demo-[a-z0-9]{20,64}$/;
const MAX_REQUEST_AGE_MS = 10 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;

export const acceptRequest = internalMutation({
  args: {
    expectedSender: v.string(),
    sourceAgentAddress: v.string(),
    transport: v.union(v.literal("UAGENT_A2A"), v.literal("ASI_ONE_ACP")),
    protocolVersion: v.string(),
    requestId: v.string(),
    requestType: v.string(),
    caseAlias: v.string(),
    sentAt: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    if (
      !ADDRESS_PATTERN.test(args.expectedSender) ||
      (args.transport === "UAGENT_A2A" && args.sourceAgentAddress !== args.expectedSender)
    ) return { ok: false as const, code: "SENDER_NOT_ALLOWED" as const };
    if (
      args.protocolVersion !== "1.0" ||
      args.requestType !== REQUEST_TYPE ||
      !REQUEST_ID_PATTERN.test(args.requestId) ||
      !ALIAS_PATTERN.test(args.caseAlias)
    ) return { ok: false as const, code: "INVALID_REQUEST" as const };
    if (
      args.sentAt < args.now - MAX_REQUEST_AGE_MS ||
      args.sentAt > args.now + MAX_FUTURE_SKEW_MS
    ) return { ok: false as const, code: "STALE_REQUEST" as const };

    const requestKey = `${args.sourceAgentAddress}:${args.requestId}`;
    const duplicate = await ctx.db
      .query("agentverseRequests")
      .withIndex("by_requestKey", (q) => q.eq("requestKey", requestKey))
      .unique();
    if (duplicate) {
      return {
        ok: false as const,
        code: "REPLAY_REJECTED" as const,
        duplicate: true as const,
        status: duplicate.status,
      };
    }

    const scope = await ctx.db
      .query("agentverseScopes")
      .withIndex("by_alias", (q) => q.eq("alias", args.caseAlias))
      .unique();
    if (!scope || scope.status !== "ACTIVE" || scope.requestType !== args.requestType) {
      return { ok: false as const, code: "CASE_ALIAS_NOT_AUTHORIZED" as const };
    }
    const [careCase, patient, relationship] = await Promise.all([
      ctx.db.get("careCases", scope.careCaseId),
      ctx.db.get("appUsers", scope.patientId),
      ctx.db
        .query("careRelationships")
        .withIndex("by_caregiver_and_patient", (q) =>
          q.eq("caregiverId", scope.caregiverId).eq("patientId", scope.patientId),
        )
        .unique(),
    ]);
    if (
      !careCase ||
      careCase.patientId !== scope.patientId ||
      careCase.status !== "OPEN" ||
      careCase.caseVersion !== scope.caseVersion ||
      !patient?.isSynthetic ||
      relationship?.status !== "active"
    ) return { ok: false as const, code: "AUTHORIZED_CASE_UNAVAILABLE" as const };

    const requestDocumentId = await ctx.db.insert("agentverseRequests", {
      requestKey,
      requestId: args.requestId,
      protocolVersion: "1.0",
      sourceAgentAddress: args.sourceAgentAddress,
      transport: args.transport,
      requestType: REQUEST_TYPE,
      caseAlias: args.caseAlias,
      scopeId: scope._id,
      caregiverId: scope.caregiverId,
      patientId: scope.patientId,
      careCaseId: careCase._id,
      status: "ACK",
      outcomeCode: null,
      sentAt: args.sentAt,
      receivedAt: args.now,
      acknowledgedAt: args.now,
      startedAt: null,
      completedAt: null,
      lastResponseStatus: null,
      lastResponseSubmittedAt: null,
      updatedAt: args.now,
    });
    const run = await createOrReuseAdherenceRun(
      ctx,
      careCase,
      scope.caregiverId,
      args.now,
      { source: "AGENTVERSE", agentverseRequestId: requestDocumentId },
    );
    await ctx.db.patch("agentverseRequests", requestDocumentId, {
      agentRunId: run.runId,
      updatedAt: args.now,
    });
    return {
      ok: true as const,
      duplicate: false as const,
      requestDocumentId,
      status: "ACK" as const,
      linkedRunId: run.runId,
      linkedRunStatus: run.status,
    };
  },
});

export const syncRequest = internalMutation({
  args: {
    expectedSender: v.string(),
    sourceAgentAddress: v.string(),
    transport: v.union(v.literal("UAGENT_A2A"), v.literal("ASI_ONE_ACP")),
    requestId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.transport === "UAGENT_A2A" && args.sourceAgentAddress !== args.expectedSender) {
      return { ok: false as const, code: "SENDER_NOT_ALLOWED" as const };
    }
    const request = await ctx.db
      .query("agentverseRequests")
      .withIndex("by_requestKey", (q) =>
        q.eq("requestKey", `${args.sourceAgentAddress}:${args.requestId}`),
      )
      .unique();
    if (!request?.agentRunId) return { ok: false as const, code: "REQUEST_NOT_FOUND" as const };
    const run = await ctx.db.get("agentRuns", request.agentRunId);
    if (!run || run.patientId !== request.patientId || run.careCaseId !== request.careCaseId) {
      return { ok: false as const, code: "RUN_LINK_INVALID" as const };
    }
    let status: "IN_PROGRESS" | "COMPLETED" | "FAILED";
    let outcomeCode: string | null = null;
    if (run.status === "COMPLETED") {
      status = "COMPLETED";
      outcomeCode = "INVESTIGATION_AVAILABLE";
    } else if (run.status === "FAILED") {
      status = "FAILED";
      outcomeCode = "COORDINATOR_FAILED";
    } else {
      status = "IN_PROGRESS";
    }
    if (request.status !== status || request.outcomeCode !== outcomeCode) {
      await ctx.db.patch("agentverseRequests", request._id, {
        status,
        outcomeCode,
        startedAt: request.startedAt ?? args.now,
        completedAt: status === "COMPLETED" || status === "FAILED" ? args.now : null,
        updatedAt: args.now,
      });
    }
    const actions = status === "COMPLETED"
      ? await ctx.db
        .query("agentActions")
        .withIndex("by_run_and_startedAt", (q) => q.eq("runId", run._id))
        .take(20)
      : [];
    return {
      ok: true as const,
      status,
      outcomeCode,
      linkedRunStatus: run.status,
      provider: run.provider,
      toolCallCount: actions.filter((action) => action.kind === "TOOL").length,
      findingSignals: run.findings?.items.map((item) => ({
        category: item.category,
        uncertainty: item.uncertainty,
      })) ?? [],
      proposedAction: run.findings?.proposedFollowUp.actionType ?? null,
    };
  },
});

export const markResponseSubmitted = internalMutation({
  args: {
    expectedSender: v.string(),
    sourceAgentAddress: v.string(),
    transport: v.union(v.literal("UAGENT_A2A"), v.literal("ASI_ONE_ACP")),
    requestId: v.string(),
    responseStatus: v.union(
      v.literal("ACK"),
      v.literal("IN_PROGRESS"),
      v.literal("COMPLETED"),
      v.literal("FAILED"),
    ),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.transport === "UAGENT_A2A" && args.sourceAgentAddress !== args.expectedSender) {
      return { ok: false as const, code: "SENDER_NOT_ALLOWED" as const };
    }
    const request = await ctx.db
      .query("agentverseRequests")
      .withIndex("by_requestKey", (q) =>
        q.eq("requestKey", `${args.sourceAgentAddress}:${args.requestId}`),
      )
      .unique();
    if (!request) return { ok: false as const, code: "REQUEST_NOT_FOUND" as const };
    await ctx.db.patch("agentverseRequests", request._id, {
      lastResponseStatus: args.responseStatus,
      lastResponseSubmittedAt: args.now,
      updatedAt: args.now,
    });
    return { ok: true as const };
  },
});

export const failRequest = internalMutation({
  args: {
    expectedSender: v.string(),
    sourceAgentAddress: v.string(),
    transport: v.union(v.literal("UAGENT_A2A"), v.literal("ASI_ONE_ACP")),
    requestId: v.string(),
    outcomeCode: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.transport === "UAGENT_A2A" && args.sourceAgentAddress !== args.expectedSender) {
      return { ok: false as const, code: "SENDER_NOT_ALLOWED" as const };
    }
    const request = await ctx.db
      .query("agentverseRequests")
      .withIndex("by_requestKey", (q) =>
        q.eq("requestKey", `${args.sourceAgentAddress}:${args.requestId}`),
      )
      .unique();
    if (!request) return { ok: false as const, code: "REQUEST_NOT_FOUND" as const };
    if (request.status === "COMPLETED") {
      return { ok: false as const, code: "REQUEST_ALREADY_COMPLETED" as const };
    }
    const outcomeCode = args.outcomeCode.trim().slice(0, 80) || "AGENTVERSE_WORKFLOW_FAILED";
    await ctx.db.patch("agentverseRequests", request._id, {
      status: "FAILED",
      outcomeCode,
      completedAt: args.now,
      updatedAt: args.now,
    });
    return { ok: true as const };
  },
});
