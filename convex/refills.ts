import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireCaregiverAccess, resolveDashboardPatient } from "./lib/authorization";
import { buildSupplyForecast } from "./lib/refillForecast";
import { createOrReuseRefillRun } from "./lib/agentRunCreation";

const DEFAULT_THRESHOLD_DAYS = 3;
const ACTIVE_STATUSES = new Set(["OPEN", "REVIEWED", "REFILL_REQUESTED"]);

async function patientSettings(ctx: QueryCtx | MutationCtx, patientId: Id<"appUsers">) {
  return ctx.db.query("refillSettings").withIndex("by_patient", (q) => q.eq("patientId", patientId)).unique();
}

async function forecastAssignment(
  ctx: QueryCtx | MutationCtx,
  assignment: Doc<"compartmentAssignments">,
  now: number,
  thresholdDays: number,
) {
  const schedules = (await ctx.db.query("medicationSchedules")
    .withIndex("by_medication", (q) => q.eq("medicationId", assignment.medicationId)).take(20))
    .filter((row) => row.active);
  const recent = (await ctx.db.query("doseOccurrences")
    .withIndex("by_patient_and_scheduledFor", (q) =>
      q.eq("patientId", assignment.patientId).gte("scheduledFor", now - 14 * 24 * 60 * 60 * 1000),
    ).take(200)).filter((row) => row.medicationId === assignment.medicationId && row.scheduledFor < now);
  return buildSupplyForecast({
    now,
    supplyCount: assignment.estimatedSupplyCount ?? null,
    source: assignment.supplyEstimateSource ?? null,
    schedules: schedules.map((row) => ({ localTime: row.localTime, weekdays: row.weekdays, timezone: row.timezone })),
    thresholdDays,
    hasMissedDoseUncertainty: recent.some((row) =>
      row.ingestionReport !== "TAKEN" || row.attemptStatus === "UNKNOWN"),
  });
}

async function latestActiveCase(ctx: QueryCtx | MutationCtx, medicationId: Id<"medications">) {
  const rows = await ctx.db.query("refillCases")
    .withIndex("by_medication", (q) => q.eq("medicationId", medicationId)).order("desc").take(20);
  return rows.find((row) => ACTIVE_STATUSES.has(row.status)) ?? null;
}

export async function reconcilePatientRefills(ctx: MutationCtx, patientId: Id<"appUsers">, now = Date.now()) {
  const threshold = (await patientSettings(ctx, patientId))?.lowSupplyThresholdDays ?? DEFAULT_THRESHOLD_DAYS;
  const assignments = (await ctx.db.query("compartmentAssignments")
    .withIndex("by_patient", (q) => q.eq("patientId", patientId)).take(20)).filter((row) => row.active);
  let created = 0;
  let updated = 0;
  async function queueAutomaticInvestigation(refillCase: Doc<"refillCases">) {
    const patient = await ctx.db.get("appUsers", patientId);
    if (!patient?.isSynthetic) return;
    const relationships = await ctx.db.query("careRelationships")
      .withIndex("by_patient", (q) => q.eq("patientId", patientId)).take(10);
    const relationship = relationships.find((candidate) => candidate.status === "active");
    if (!relationship) return;
    await createOrReuseRefillRun(ctx, refillCase, relationship.caregiverId, now, { source: "AUTOMATION" });
  }
  for (const assignment of assignments) {
    const forecast = await forecastAssignment(ctx, assignment, now, threshold);
    const active = await latestActiveCase(ctx, assignment.medicationId);
    if (!forecast.isActionable || !forecast.triggerReason) {
      if (active) {
        await ctx.db.patch("refillCases", active._id, { status: "CLOSED", caseVersion: active.caseVersion + 1, updatedAt: now });
        await ctx.db.insert("refillCaseTransitions", { caseId: active._id, patientId, type: "CLOSED", fromStatus: active.status, toStatus: "CLOSED", note: "Current forecast is above the configured low-supply threshold.", occurredAt: now });
        updated += 1;
      }
      continue;
    }
    const fingerprint = JSON.stringify({
      revision: assignment.supplyRevision ?? 0,
      trigger: forecast.triggerReason,
      threshold,
      schedules: (await ctx.db.query("medicationSchedules").withIndex("by_medication", (q) => q.eq("medicationId", assignment.medicationId)).take(20))
        .filter((row) => row.active).map((row) => [row._id, row.revision ?? 1, row.localTime, row.weekdays, row.timezone]),
      forecast,
    });
    const evidence = {
      triggerReason: forecast.triggerReason,
      evidenceFingerprint: fingerprint,
      estimatedSupplyCount: forecast.estimatedSupplyCount,
      supplyEstimateSource: assignment.supplyEstimateSource ?? null,
      estimatedDaysRemaining: forecast.estimatedDaysRemaining,
      expectedLowSupplyAt: forecast.expectedLowSupplyAt,
      estimatedRunOutAt: forecast.estimatedRunOutAt,
      confidence: forecast.confidence,
      uncertaintyReasons: forecast.uncertaintyReasons,
      lowSupplyThresholdDays: threshold,
    };
    if (!active) {
      const caseId = await ctx.db.insert("refillCases", {
        caseId: `refill:${assignment.medicationId}:${now}`,
        patientId,
        medicationId: assignment.medicationId,
        assignmentId: assignment._id,
        caseVersion: 1,
        status: "OPEN",
        ...evidence,
        investigationStatus: "NOT_REQUESTED",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("refillCaseTransitions", { caseId, patientId, type: "OPENED", fromStatus: null, toStatus: "OPEN", occurredAt: now });
      const createdCase = await ctx.db.get("refillCases", caseId);
      if (createdCase) await queueAutomaticInvestigation(createdCase);
      created += 1;
    } else if (active.evidenceFingerprint !== fingerprint) {
      await ctx.db.patch("refillCases", active._id, { ...evidence, caseVersion: active.caseVersion + 1, updatedAt: now });
      await ctx.db.insert("refillCaseTransitions", { caseId: active._id, patientId, type: "FORECAST_UPDATED", fromStatus: active.status, toStatus: active.status, occurredAt: now });
      const updatedCase = await ctx.db.get("refillCases", active._id);
      if (updatedCase) await queueAutomaticInvestigation(updatedCase);
      updated += 1;
    }
  }
  return { created, updated };
}

export const reconcileMine = mutation({
  args: {},
  handler: async (ctx) => {
    const { viewer, patient } = await resolveDashboardPatient(ctx);
    if (viewer.role !== "caregiver") throw new ConvexError("Caregiver access required");
    return reconcilePatientRefills(ctx, patient._id);
  },
});

export const listForCaregiver = query({
  args: {},
  handler: async (ctx) => {
    const { viewer, patient } = await resolveDashboardPatient(ctx);
    if (viewer.role !== "caregiver") return { status: "unauthorized" as const, cases: [] };
    const settings = await patientSettings(ctx, patient._id);
    const assignments = (await ctx.db.query("compartmentAssignments").withIndex("by_patient", (q) => q.eq("patientId", patient._id)).take(20)).filter((row) => row.active);
    const rows = await Promise.all(assignments.map(async (assignment) => {
      const medication = await ctx.db.get("medications", assignment.medicationId);
      if (!medication?.active) return null;
      const forecast = await forecastAssignment(ctx, assignment, Date.now(), settings?.lowSupplyThresholdDays ?? DEFAULT_THRESHOLD_DAYS);
      const cases = await ctx.db.query("refillCases").withIndex("by_medication", (q) => q.eq("medicationId", assignment.medicationId)).order("desc").take(10);
      const latest = cases[0] ?? null;
      return { assignmentId: assignment._id, medicationId: medication._id, medicationName: medication.name, slot: assignment.slot, demoInventory: assignment.demoInventory, supplyCount: assignment.estimatedSupplyCount ?? null, supplySource: assignment.supplyEstimateSource ?? null, forecast, refillCase: latest };
    }));
    return { status: "ready" as const, patientId: patient._id, patientName: patient.displayName, lowSupplyThresholdDays: settings?.lowSupplyThresholdDays ?? DEFAULT_THRESHOLD_DAYS, cases: rows.filter((row) => row !== null) };
  },
});

export const patientReminder = query({
  args: {},
  handler: async (ctx) => {
    const { patient } = await resolveDashboardPatient(ctx);
    const cases = (await Promise.all(["OPEN", "REVIEWED", "REFILL_REQUESTED"].map((status) =>
      ctx.db.query("refillCases").withIndex("by_patient_and_status", (q) =>
        q.eq("patientId", patient._id).eq("status", status as "OPEN" | "REVIEWED" | "REFILL_REQUESTED"),
      ).take(20),
    ))).flat();
    const reminders = await Promise.all(cases.map(async (refillCase) => {
      const medication = await ctx.db.get("medications", refillCase.medicationId);
      return medication ? { id: refillCase._id, medicationName: medication.name, confidence: refillCase.confidence, estimatedDaysRemaining: refillCase.estimatedDaysRemaining, triggerReason: refillCase.triggerReason, status: refillCase.status, supplyCount: refillCase.estimatedSupplyCount ?? null, runOutAt: refillCase.estimatedRunOutAt ?? null } : null;
    }));
    return { patientName: patient.displayName, reminders: reminders.filter((row) => row !== null) };
  },
});

function validateCount(count: number) {
  if (!Number.isSafeInteger(count) || count < 0 || count > 10000) throw new ConvexError("Verified supply must be a whole number from 0 to 10000");
}

export const updateThreshold = mutation({
  args: { patientId: v.id("appUsers"), days: v.number() },
  handler: async (ctx, args) => {
    const { caregiver } = await requireCaregiverAccess(ctx, args.patientId);
    if (!Number.isInteger(args.days) || args.days < 1 || args.days > 30) throw new ConvexError("Threshold must be 1 to 30 days");
    const current = await patientSettings(ctx, args.patientId);
    if (current) await ctx.db.patch("refillSettings", current._id, { lowSupplyThresholdDays: args.days, updatedBy: caregiver._id, updatedAt: Date.now() });
    else await ctx.db.insert("refillSettings", { patientId: args.patientId, lowSupplyThresholdDays: args.days, updatedBy: caregiver._id, updatedAt: Date.now() });
    return reconcilePatientRefills(ctx, args.patientId);
  },
});

export const adjustVerifiedSupply = mutation({
  args: { assignmentId: v.id("compartmentAssignments"), count: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    validateCount(args.count);
    const assignment = await ctx.db.get("compartmentAssignments", args.assignmentId);
    if (!assignment) throw new ConvexError("Assignment unavailable");
    const { caregiver } = await requireCaregiverAccess(ctx, assignment.patientId);
    const now = Date.now();
    await ctx.db.patch("compartmentAssignments", assignment._id, { estimatedSupplyCount: args.count, supplyEstimateSource: "CAREGIVER_VERIFIED", supplyEstimateUpdatedAt: now, supplyRevision: (assignment.supplyRevision ?? 0) + 1 });
    const active = await latestActiveCase(ctx, assignment.medicationId);
    if (active) await ctx.db.insert("refillCaseTransitions", { caseId: active._id, patientId: assignment.patientId, type: "SUPPLY_ADJUSTED", fromStatus: active.status, toStatus: active.status, actorId: caregiver._id, supplyCount: args.count, note: args.note?.trim().slice(0, 300), occurredAt: now });
    await reconcilePatientRefills(ctx, assignment.patientId, now);
    return { ok: true };
  },
});

export const transition = mutation({
  args: { refillCaseId: v.id("refillCases"), action: v.union(v.literal("REVIEW"), v.literal("REQUEST_REFILL"), v.literal("RECEIVE_REFILL")), receivedCount: v.optional(v.number()), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const refillCase = await ctx.db.get("refillCases", args.refillCaseId);
    if (!refillCase) throw new ConvexError("Refill case unavailable");
    const { caregiver } = await requireCaregiverAccess(ctx, refillCase.patientId);
    if (!ACTIVE_STATUSES.has(refillCase.status)) throw new ConvexError("Refill case is not active");
    const now = Date.now();
    const next = args.action === "REVIEW" ? "REVIEWED" : args.action === "REQUEST_REFILL" ? "REFILL_REQUESTED" : "REFILL_RECEIVED";
    if (args.action === "REQUEST_REFILL" && refillCase.status === "OPEN") throw new ConvexError("Review the case before recording a refill request");
    if (args.action === "RECEIVE_REFILL") {
      if (refillCase.status !== "REFILL_REQUESTED") throw new ConvexError("A refill must be requested before it can be received");
      if (args.receivedCount === undefined) throw new ConvexError("Verified received supply is required");
      validateCount(args.receivedCount);
      const assignment = await ctx.db.get("compartmentAssignments", refillCase.assignmentId);
      if (!assignment) throw new ConvexError("Assignment unavailable");
      await ctx.db.patch("compartmentAssignments", assignment._id, { estimatedSupplyCount: args.receivedCount, supplyEstimateSource: "CAREGIVER_VERIFIED", supplyEstimateUpdatedAt: now, supplyRevision: (assignment.supplyRevision ?? 0) + 1 });
    }
    await ctx.db.patch("refillCases", refillCase._id, { status: next, caseVersion: refillCase.caseVersion + 1, updatedAt: now });
    await ctx.db.insert("refillCaseTransitions", { caseId: refillCase._id, patientId: refillCase.patientId, type: args.action === "REVIEW" ? "REVIEWED" : args.action === "REQUEST_REFILL" ? "REFILL_REQUESTED" : "REFILL_RECEIVED", fromStatus: refillCase.status, toStatus: next, actorId: caregiver._id, supplyCount: args.receivedCount, note: args.note?.trim().slice(0, 300), occurredAt: now });
    return { status: next };
  },
});

export const runLowSupplyDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const { viewer, patient } = await resolveDashboardPatient(ctx);
    if (viewer.role !== "caregiver" || !patient.isSynthetic) throw new ConvexError("Synthetic caregiver demo required");
    const activeRun = await ctx.db.query("refillDemoRuns").withIndex("by_patient_and_status", (q) => q.eq("patientId", patient._id).eq("status", "ACTIVE")).unique();
    if (activeRun) return { created: false };
    const assignments = (await ctx.db.query("compartmentAssignments").withIndex("by_patient", (q) => q.eq("patientId", patient._id)).take(20)).filter((row) => row.active);
    const withSchedule = [];
    for (const row of assignments) {
      const schedule = await ctx.db.query("medicationSchedules")
        .withIndex("by_medication", (q) => q.eq("medicationId", row.medicationId)).first();
      if (schedule?.active) withSchedule.push(row);
    }
    const assignment = withSchedule.find((row) => row.slot === 6) ?? withSchedule[0];
    if (!assignment) throw new ConvexError("Add a synthetic medication before running the refill demo");
    const now = Date.now();
    const demoRun = await ctx.db.insert("refillDemoRuns", { patientId: patient._id, assignmentId: assignment._id, previousSupplyCount: assignment.estimatedSupplyCount ?? null, previousSource: assignment.supplyEstimateSource ?? null, previousUpdatedAt: assignment.supplyEstimateUpdatedAt ?? null, previousRevision: assignment.supplyRevision ?? 0, status: "ACTIVE", initiatedBy: viewer._id, createdAt: now });
    await ctx.db.patch("compartmentAssignments", assignment._id, { estimatedSupplyCount: 2, supplyEstimateSource: "SYNTHETIC_DEMO", supplyEstimateUpdatedAt: now, supplyRevision: (assignment.supplyRevision ?? 0) + 1 });
    await reconcilePatientRefills(ctx, patient._id, now);
    const active = await latestActiveCase(ctx, assignment.medicationId);
    if (active) await ctx.db.patch("refillDemoRuns", demoRun, { refillCaseId: active._id });
    return { created: true };
  },
});

export const resetLowSupplyDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const { viewer, patient } = await resolveDashboardPatient(ctx);
    if (viewer.role !== "caregiver" || !patient.isSynthetic) throw new ConvexError("Synthetic caregiver demo required");
    const runs = await ctx.db.query("refillDemoRuns").withIndex("by_patient_and_status", (q) => q.eq("patientId", patient._id).eq("status", "ACTIVE")).take(10);
    const now = Date.now();
    for (const run of runs) {
      const assignment = await ctx.db.get("compartmentAssignments", run.assignmentId);
      if (assignment) await ctx.db.patch("compartmentAssignments", assignment._id, { estimatedSupplyCount: run.previousSupplyCount ?? undefined, supplyEstimateSource: run.previousSource ?? undefined, supplyEstimateUpdatedAt: run.previousUpdatedAt ?? undefined, supplyRevision: run.previousRevision });
      if (run.refillCaseId) {
        const refillCase = await ctx.db.get("refillCases", run.refillCaseId);
        if (refillCase && refillCase.status !== "CLOSED") {
          await ctx.db.patch("refillCases", refillCase._id, { status: "CLOSED", caseVersion: refillCase.caseVersion + 1, updatedAt: now });
          await ctx.db.insert("refillCaseTransitions", { caseId: refillCase._id, patientId: patient._id, type: "DEMO_RESET", fromStatus: refillCase.status, toStatus: "CLOSED", actorId: viewer._id, occurredAt: now });
        }
      }
      await ctx.db.patch("refillDemoRuns", run._id, { status: "RESET", resetAt: now });
    }
    return { reset: runs.length };
  },
});
