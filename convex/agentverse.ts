import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireCaregiverAccess, resolveDashboardPatient } from "./lib/authorization";

const REQUEST_TYPE = "DEMO_ADHERENCE_INVESTIGATION" as const;
const REFILL_REQUEST_TYPE = "DEMO_REFILL_STATUS" as const;

export const preauthorizeRefillCase = mutation({
  args: { refillCaseId: v.id("refillCases") },
  handler: async (ctx, args) => {
    const refillCase = await ctx.db.get("refillCases", args.refillCaseId);
    if (!refillCase) throw new ConvexError("Refill case unavailable");
    const { caregiver } = await requireCaregiverAccess(ctx, refillCase.patientId);
    const patient = await ctx.db.get("appUsers", refillCase.patientId);
    if (!patient?.isSynthetic || !["OPEN", "REVIEWED", "REFILL_REQUESTED"].includes(refillCase.status)) {
      throw new ConvexError("Active synthetic refill case required");
    }
    const scopes = await ctx.db.query("agentverseScopes")
      .withIndex("by_refill_case", (q) => q.eq("refillCaseId", refillCase._id))
      .order("desc").take(50);
    const existing = scopes.find((scope) =>
      scope.caseVersion === refillCase.caseVersion && scope.status === "ACTIVE");
    if (existing) return { alias: existing.alias, created: false };
    const now = Date.now();
    for (const scope of scopes.filter((scope) => scope.status === "ACTIVE")) {
      await ctx.db.patch("agentverseScopes", scope._id, { status: "REVOKED", updatedAt: now });
    }
    const alias = `demo-${crypto.randomUUID().replaceAll("-", "")}`;
    await ctx.db.insert("agentverseScopes", {
      alias, caregiverId: caregiver._id, patientId: refillCase.patientId,
      refillCaseId: refillCase._id, caseVersion: refillCase.caseVersion,
      requestType: REFILL_REQUEST_TYPE, status: "ACTIVE", createdAt: now, updatedAt: now,
    });
    return { alias, created: true };
  },
});

export const preauthorizeDemoCase = mutation({
  args: { careCaseId: v.id("careCases") },
  handler: async (ctx, args) => {
    const careCase = await ctx.db.get("careCases", args.careCaseId);
    if (!careCase) throw new ConvexError("Care case is unavailable");
    const { caregiver } = await requireCaregiverAccess(ctx, careCase.patientId);
    const patient = await ctx.db.get("appUsers", careCase.patientId);
    if (!patient?.isSynthetic) {
      throw new ConvexError("Agentverse is limited to synthetic demo patients");
    }
    if (careCase.status !== "OPEN") {
      throw new ConvexError("Only an open care case can be pre-authorized");
    }

    const existing = await ctx.db
      .query("agentverseScopes")
      .withIndex("by_case", (q) => q.eq("careCaseId", careCase._id))
      .order("desc")
      .take(10);
    const current = existing.find(
      (scope) => scope.status === "ACTIVE" && scope.caseVersion === careCase.caseVersion,
    );
    if (current) {
      return { alias: current.alias, created: false };
    }

    const now = Date.now();
    for (const scope of existing.filter((row) => row.status === "ACTIVE")) {
      await ctx.db.patch("agentverseScopes", scope._id, {
        status: "REVOKED",
        updatedAt: now,
      });
    }
    const alias = `demo-${crypto.randomUUID().replaceAll("-", "")}`;
    await ctx.db.insert("agentverseScopes", {
      alias,
      caregiverId: caregiver._id,
      patientId: careCase.patientId,
      careCaseId: careCase._id,
      caseVersion: careCase.caseVersion,
      requestType: REQUEST_TYPE,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    });
    return { alias, created: true };
  },
});

export const revokeDemoScope = mutation({
  args: { scopeId: v.id("agentverseScopes") },
  handler: async (ctx, args) => {
    const scope = await ctx.db.get("agentverseScopes", args.scopeId);
    if (!scope) throw new ConvexError("Agentverse scope is unavailable");
    const { caregiver } = await requireCaregiverAccess(ctx, scope.patientId);
    if (scope.caregiverId !== caregiver._id) throw new ConvexError("Scope access denied");
    if (scope.status === "REVOKED") return { duplicate: true };
    await ctx.db.patch("agentverseScopes", scope._id, {
      status: "REVOKED",
      updatedAt: Date.now(),
    });
    return { duplicate: false };
  },
});

export const listForCaregiver = query({
  args: {},
  handler: async (ctx) => {
    const { viewer, patient } = await resolveDashboardPatient(ctx);
    if (viewer.role !== "caregiver") {
      return { status: "unauthorized" as const, scopes: [], requests: [] };
    }
    const [scopes, requests] = await Promise.all([
      ctx.db
        .query("agentverseScopes")
        .withIndex("by_caregiver_and_updatedAt", (q) => q.eq("caregiverId", viewer._id))
        .order("desc")
        .take(20),
      ctx.db
        .query("agentverseRequests")
        .withIndex("by_caregiver_and_receivedAt", (q) => q.eq("caregiverId", viewer._id))
        .order("desc")
        .take(30),
    ]);
    const requestRows = await Promise.all(requests.map(async (request) => {
      const run = request.agentRunId ? await ctx.db.get("agentRuns", request.agentRunId) : null;
      return {
        id: request._id,
        requestId: request.requestId,
        protocolVersion: request.protocolVersion,
        sourceAgentAddress: request.sourceAgentAddress,
        transport: request.transport ?? "UAGENT_A2A",
        requestType: request.requestType,
        caseAlias: request.caseAlias,
        status: request.status,
        outcomeCode: request.outcomeCode,
        agentRunId: request.agentRunId ?? null,
        runStatus: run?.status ?? null,
        resultProvider: run?.provider ?? null,
        receivedAt: request.receivedAt,
        completedAt: request.completedAt,
        lastResponseStatus: request.lastResponseStatus,
        lastResponseSubmittedAt: request.lastResponseSubmittedAt,
      };
    }));
    return {
      status: "ready" as const,
      patientName: patient.displayName,
      scopes: scopes.map((scope) => ({
        id: scope._id,
        alias: scope.alias,
        careCaseId: scope.careCaseId,
        refillCaseId: scope.refillCaseId ?? null,
        caseVersion: scope.caseVersion,
        requestType: scope.requestType,
        status: scope.status,
        updatedAt: scope.updatedAt,
      })),
      requests: requestRows,
    };
  },
});
