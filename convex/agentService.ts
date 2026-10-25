import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";

const toolNameValidator = v.union(
  v.literal("get_dose_context"),
  v.literal("get_dispense_history"),
  v.literal("get_device_status"),
  v.literal("get_inventory_context"),
  v.literal("get_patient_reports"),
  v.literal("get_tray_observations"),
  v.literal("get_supply_estimate"),
  v.literal("get_consumption_forecast"),
  v.literal("get_refill_case_history"),
  v.literal("get_refill_checkout_status"),
);

const findingValidator = v.object({
  items: v.array(
    v.object({
      category: v.union(
        v.literal("NO_RECORDED_RESPONSE"),
        v.literal("DEVICE_CONNECTIVITY"),
        v.literal("DEVICE_FAULT"),
        v.literal("POSSIBLE_SUPPLY_ISSUE"),
        v.literal("PILL_UNCOLLECTED"),
        v.literal("INSUFFICIENT_EVIDENCE"),
      ),
      evidenceReferences: v.array(v.string()),
      uncertainty: v.union(v.literal("LOW"), v.literal("MEDIUM"), v.literal("HIGH")),
      explanation: v.string(),
    }),
  ),
  overallSummary: v.string(),
  proposedFollowUp: v.object({
    actionType: v.union(
      v.literal("CONTACT_PATIENT"),
      v.literal("REVIEW_DEVICE"),
      v.literal("CHECK_PHYSICAL_SUPPLY"),
      v.literal("DOCUMENT_NO_RESPONSE"),
      v.literal("NO_ACTION"),
    ),
    explanation: v.string(),
  }),
});

type DbCtx = QueryCtx | MutationCtx;

async function scopedCase(ctx: DbCtx, run: Doc<"agentRuns">) {
  if (run.workflowType === "REFILL_INVESTIGATION") {
    const refillCase = run.refillCaseId ? await ctx.db.get("refillCases", run.refillCaseId) : null;
    return { refillCase, careCase: null };
  }
  const careCase = run.careCaseId ? await ctx.db.get("careCases", run.careCaseId) : null;
  return { refillCase: null, careCase };
}

function isCaseCurrent(run: Doc<"agentRuns">, careCase: Doc<"careCases"> | null, refillCase: Doc<"refillCases"> | null) {
  return run.workflowType === "REFILL_INVESTIGATION"
    ? !!refillCase && refillCase.patientId === run.patientId && ["OPEN", "REVIEWED", "REFILL_REQUESTED"].includes(refillCase.status) && refillCase.caseVersion === run.caseVersion
    : !!careCase && careCase.patientId === run.patientId && careCase.status === "OPEN" && careCase.caseVersion === run.caseVersion;
}

async function authorizedRun(
  ctx: DbCtx,
  args: { runId: string; tokenHash: string; now: number },
) {
  const run = await ctx.db
    .query("agentRuns")
    .withIndex("by_runId", (q) => q.eq("runId", args.runId))
    .unique();
  if (!run) return { ok: false as const, code: "RUN_NOT_FOUND" as const };
  if (
    run.status !== "RUNNING" ||
    !run.claimTokenHash ||
    run.claimTokenHash !== args.tokenHash ||
    !run.leaseExpiresAt ||
    args.now > run.leaseExpiresAt
  ) {
    return { ok: false as const, code: "RUN_AUTHORIZATION_FAILED" as const };
  }
  return { ok: true as const, run };
}

export const claimNext = internalMutation({
  args: {
    tokenHash: v.string(),
    idempotencyKey: v.string(),
    now: v.number(),
    leaseExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const retried = await ctx.db
      .query("agentRuns")
      .withIndex("by_claimIdempotencyKey", (q) =>
        q.eq("claimIdempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (retried && retried.status === "RUNNING") {
      await ctx.db.patch("agentRuns", retried._id, {
        claimTokenHash: args.tokenHash,
        leaseExpiresAt: args.leaseExpiresAt,
        updatedAt: args.now,
      });
      return {
        runId: retried.runId,
        careCaseId: retried.careCaseId ?? retried.refillCaseId,
        caseVersion: retried.caseVersion,
      };
    }
    const pending = await ctx.db
      .query("agentRuns")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "PENDING"))
      .order("asc")
      .take(20);
    for (const run of pending) {
      const { careCase, refillCase } = await scopedCase(ctx, run);
      if (!isCaseCurrent(run, careCase, refillCase)) {
        await ctx.db.patch("agentRuns", run._id, {
          status: "FAILED",
          failureCode: "STALE_OR_CLOSED_CASE",
          updatedAt: args.now,
          completedAt: args.now,
        });
        if (careCase && careCase.caseVersion === run.caseVersion) {
          await ctx.db.patch("careCases", careCase._id, {
            investigationStatus: "FAILED",
            updatedAt: args.now,
          });
        }
        if (refillCase && refillCase.caseVersion === run.caseVersion) await ctx.db.patch("refillCases", refillCase._id, { investigationStatus: "FAILED", updatedAt: args.now });
        continue;
      }
      await ctx.db.patch("agentRuns", run._id, {
        status: "RUNNING",
        claimIdempotencyKey: args.idempotencyKey,
        claimTokenHash: args.tokenHash,
        leaseExpiresAt: args.leaseExpiresAt,
        claimedAt: args.now,
        updatedAt: args.now,
      });
      if (careCase) await ctx.db.patch("careCases", careCase._id, {
        investigationStatus: "RUNNING", updatedAt: args.now,
      });
      if (refillCase) await ctx.db.patch("refillCases", refillCase._id, { investigationStatus: "RUNNING", updatedAt: args.now });
      return {
        runId: run.runId,
        careCaseId: run.careCaseId ?? run.refillCaseId,
        caseVersion: run.caseVersion,
      };
    }
    return null;
  },
});

export const authorizeRun = internalQuery({
  args: { runId: v.string(), tokenHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const result = await authorizedRun(ctx, args);
    if (!result.ok) return result;
    return {
      ok: true as const,
      careCaseId: result.run.careCaseId,
      refillCaseId: result.run.refillCaseId,
      patientId: result.run.patientId,
      caseVersion: result.run.caseVersion,
      triggerReason: result.run.triggerReason,
      workflowType: result.run.workflowType,
    };
  },
});

export const getRunContextPayload = internalQuery({
  args: { runId: v.string(), tokenHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const result = await authorizedRun(ctx, args);
    if (!result.ok) return result;
    const run = result.run;
    const { careCase, refillCase } = await scopedCase(ctx, run);
    if (!isCaseCurrent(run, careCase, refillCase)) return { ok: false as const, code: "STALE_CASE_VERSION" as const };
    if (refillCase) {
      const medication = await ctx.db.get("medications", refillCase.medicationId);
      return { ok: true as const, careCaseId: refillCase._id, patientId: run.patientId, caseVersion: run.caseVersion, triggerReason: run.triggerReason, workflowType: run.workflowType, casePayload: { refillCaseId: refillCase._id, medicationId: refillCase.medicationId, medicationName: medication?.name ?? "Unavailable", status: refillCase.status, estimatedSupplyCount: refillCase.estimatedSupplyCount, confidence: refillCase.confidence, uncertaintyReasons: refillCase.uncertaintyReasons } };
    }
    if (!careCase) return { ok: false as const, code: "CASE_EVIDENCE_UNAVAILABLE" as const };
    const occurrence = await ctx.db.get("doseOccurrences", careCase.occurrenceId);
    return { ok: true as const, careCaseId: careCase._id, patientId: run.patientId, caseVersion: run.caseVersion, triggerReason: run.triggerReason, workflowType: run.workflowType, casePayload: { careCaseId: careCase._id, occurrenceId: careCase.occurrenceId, status: careCase.status, scheduledFor: occurrence?.scheduledFor ?? null, ingestionReport: occurrence?.ingestionReport ?? "UNREPORTED" } };
  },
});

async function toolEvidence(
  ctx: MutationCtx,
  run: Doc<"agentRuns">,
  toolName: Doc<"agentActions">["toolName"],
) {
  if (run.workflowType === "REFILL_INVESTIGATION") {
    const allowed = new Set(["get_supply_estimate", "get_consumption_forecast", "get_refill_case_history", "get_refill_checkout_status"]);
    if (!allowed.has(toolName) || !run.refillCaseId) return { ok: false as const, code: "TOOL_NOT_ALLOWED_FOR_WORKFLOW" as const };
    const refillCase = await ctx.db.get("refillCases", run.refillCaseId);
    if (!refillCase || refillCase.patientId !== run.patientId) return { ok: false as const, code: "CASE_EVIDENCE_UNAVAILABLE" as const };
    const [assignment, medication, schedules, transitions] = await Promise.all([
      ctx.db.get("compartmentAssignments", refillCase.assignmentId),
      ctx.db.get("medications", refillCase.medicationId),
      ctx.db.query("medicationSchedules").withIndex("by_medication", (q) => q.eq("medicationId", refillCase.medicationId)).take(20),
      ctx.db.query("refillCaseTransitions").withIndex("by_case", (q) => q.eq("caseId", refillCase._id)).order("asc").take(50),
    ]);
    const baseRefs = [`refillCase:${refillCase._id}`, `medication:${refillCase.medicationId}`];
    if (toolName === "get_supply_estimate") return { ok: true as const, summary: "Caregiver supply estimate read", evidenceReferences: assignment ? [...baseRefs, `assignment:${assignment._id}`] : baseRefs, data: { medicationName: medication?.name ?? "Unavailable", estimatedSupplyCount: refillCase.estimatedSupplyCount, source: refillCase.supplyEstimateSource, confidence: refillCase.confidence, uncertaintyReasons: refillCase.uncertaintyReasons, qualification: "This is not a sensor-confirmed physical count" } };
    if (toolName === "get_consumption_forecast") return { ok: true as const, summary: "Schedule-based consumption forecast read", evidenceReferences: [...baseRefs, ...schedules.map((row) => `schedule:${row._id}`)], data: { estimatedDaysRemaining: refillCase.estimatedDaysRemaining, expectedLowSupplyAt: refillCase.expectedLowSupplyAt, estimatedRunOutAt: refillCase.estimatedRunOutAt, thresholdDays: refillCase.lowSupplyThresholdDays, schedules: schedules.filter((row) => row.active).map((row) => ({ localTime: row.localTime, weekdays: row.weekdays, timezone: row.timezone })) } };
    if (toolName === "get_refill_checkout_status") {
      const checkout = await ctx.db.query("walgreensCheckouts")
        .withIndex("by_case", (q) => q.eq("refillCaseId", refillCase._id))
        .order("desc").first();
      return { ok: true as const, summary: "Caregiver handoff status read", evidenceReferences: baseRefs,
        data: { caseStatus: refillCase.status, investigationStatus: refillCase.investigationStatus,
          approvalRequired: !checkout, checkoutStatus: checkout?.status ?? null,
          environment: checkout?.environment ?? null,
          qualification: "Checkout returns are unverified and do not prove fulfillment or delivery" } };
    }
    return { ok: true as const, summary: "Refill case history read", evidenceReferences: [...baseRefs, ...transitions.map((row) => `refillTransition:${row._id}`)], data: { status: refillCase.status, triggerReason: refillCase.triggerReason, transitions: transitions.map((row) => ({ type: row.type, fromStatus: row.fromStatus, toStatus: row.toStatus, occurredAt: row.occurredAt, note: row.note ?? null })) } };
  }
  const allowed = new Set(["get_dose_context", "get_dispense_history", "get_device_status", "get_inventory_context", "get_patient_reports", "get_tray_observations"]);
  if (!allowed.has(toolName) || !run.careCaseId) return { ok: false as const, code: "TOOL_NOT_ALLOWED_FOR_WORKFLOW" as const };
  const careCase = await ctx.db.get("careCases", run.careCaseId);
  const occurrence = careCase
    ? await ctx.db.get("doseOccurrences", careCase.occurrenceId)
    : null;
  if (!careCase || !occurrence || careCase.patientId !== run.patientId) {
    return { ok: false as const, code: "CASE_EVIDENCE_UNAVAILABLE" as const };
  }
  const medication = await ctx.db.get("medications", occurrence.medicationId);
  const command = await ctx.db
    .query("dispenseCommands")
    .withIndex("by_occurrence", (q) => q.eq("occurrenceId", occurrence._id))
    .unique();
  const assignments = await ctx.db
    .query("compartmentAssignments")
    .withIndex("by_medication", (q) => q.eq("medicationId", occurrence.medicationId))
    .take(2);
  const assignment = assignments.find(
    (candidate) => candidate.active && candidate.patientId === run.patientId,
  );
  const device = assignment ? await ctx.db.get("devices", assignment.deviceId) : null;
  const runtime = device
    ? await ctx.db
        .query("deviceRuntime")
        .withIndex("by_device", (q) => q.eq("deviceId", device._id))
        .unique()
    : null;
  const events = command
    ? await ctx.db
        .query("deviceEvents")
        .withIndex("by_commandId", (q) => q.eq("commandId", command.commandId))
        .take(20)
    : [];
  const occurrenceRef = `occurrence:${occurrence._id}`;

  if (toolName === "get_dose_context") {
    return {
      ok: true as const,
      summary: "Dose context read",
      evidenceReferences: [occurrenceRef],
      data: {
        occurrenceId: occurrence._id,
        medicationName: medication?.name ?? "Unavailable",
        dueAt: occurrence.scheduledFor,
        reminderState: occurrence.reminderState ?? null,
        triggerReason: careCase.triggerReason,
        scheduleRevision: occurrence.scheduleRevision,
      },
    };
  }
  if (toolName === "get_dispense_history") {
    const refs = [occurrenceRef];
    if (command) refs.push(`command:${command.commandId}`);
    refs.push(...events.map((event) => `deviceEvent:${event.eventId}`));
    return {
      ok: true as const,
      summary: command ? "Dispense evidence read" : "No dispense command recorded",
      evidenceReferences: refs,
      data: {
        command: command
          ? {
              commandId: command.commandId,
              status: command.status,
              motorCompletion: command.motorCompletion,
              pillRelease: command.pillRelease,
              pillCollection: command.pillCollection,
              updatedAt: command.updatedAt,
            }
          : null,
        events: events.map((event) => ({
          eventId: event.eventId,
          type: event.type,
          occurredAt: event.occurredAt,
        })),
      },
    };
  }
  if (toolName === "get_device_status") {
    const refs = [occurrenceRef];
    if (runtime) refs.push(`deviceRuntime:${runtime._id}`);
    refs.push(...events.map((event) => `deviceEvent:${event.eventId}`));
    return {
      ok: true as const,
      summary: runtime ? "Device status read" : "Device runtime not available",
      evidenceReferences: refs,
      data: {
        runtime: runtime
          ? {
              state: runtime.state,
              connected: runtime.connected,
              homeAligned: runtime.homeAligned,
              faultCode: runtime.faultCode,
              updatedAt: runtime.updatedAt,
            }
          : null,
        relatedEvents: events.map((event) => ({ eventId: event.eventId, type: event.type })),
      },
    };
  }
  if (toolName === "get_inventory_context") {
    const refs = [occurrenceRef];
    if (assignment) refs.push(`assignment:${assignment._id}`);
    return {
      ok: true as const,
      summary: assignment ? "Demo inventory context read" : "Assignment not available",
      evidenceReferences: refs,
      data: assignment
        ? {
            slot: assignment.slot,
            demoInventory: assignment.demoInventory,
            inventoryMeaning: "Nominal one-inert-pill demo inventory; physical reload is manual",
          }
        : null,
    };
  }
  if (toolName === "get_patient_reports") {
    return {
      ok: true as const,
      summary: "Patient report read",
      evidenceReferences: [occurrenceRef, `patientReport:${occurrence._id}`],
      data: {
        ingestionReport: occurrence.ingestionReport,
        qualification: "A motor result never verifies ingestion",
      },
    };
  }
  return {
    ok: true as const,
    summary: "Tray observations are not available",
    evidenceReferences: [occurrenceRef, "tray:NOT_AVAILABLE"],
    data: { status: "NOT_AVAILABLE", reason: "No camera or tray sensor is implemented" },
  };
}

export const consumeTool = internalMutation({
  args: {
    runId: v.string(),
    tokenHash: v.string(),
    now: v.number(),
    actionId: v.string(),
    toolName: toolNameValidator,
  },
  handler: async (ctx, args) => {
    const authorization = await authorizedRun(ctx, args);
    if (!authorization.ok) return authorization;
    if (!args.actionId.trim() || args.actionId.length > 160) {
      return { ok: false as const, code: "INVALID_IDEMPOTENCY_KEY" as const };
    }
    const existing = await ctx.db
      .query("agentActions")
      .withIndex("by_actionId", (q) => q.eq("actionId", args.actionId))
      .unique();
    if (existing) {
      if (existing.runId !== authorization.run._id || existing.toolName !== args.toolName) {
        return { ok: false as const, code: "IDEMPOTENCY_KEY_CONFLICT" as const };
      }
      const evidence = await toolEvidence(ctx, authorization.run, args.toolName);
      return evidence.ok ? { ...evidence, duplicate: true } : evidence;
    }
    const actions = await ctx.db
      .query("agentActions")
      .withIndex("by_run_and_startedAt", (q) => q.eq("runId", authorization.run._id))
      .take(20);
    if (actions.filter((action) => action.kind === "TOOL").length >= 5) {
      return { ok: false as const, code: "TOOL_BUDGET_EXCEEDED" as const };
    }
    const evidence = await toolEvidence(ctx, authorization.run, args.toolName);
    if (!evidence.ok) {
      await ctx.db.insert("agentActions", {
        actionId: args.actionId,
        runId: authorization.run._id,
        patientId: authorization.run.patientId,
        kind: "TOOL",
        toolName: args.toolName,
        status: "FAILED",
        startedAt: args.now,
        completedAt: args.now,
        evidenceReferences: [],
        summary: "Evidence read failed",
        errorCode: evidence.code,
      });
      return evidence;
    }
    await ctx.db.insert("agentActions", {
      actionId: args.actionId,
      runId: authorization.run._id,
      patientId: authorization.run.patientId,
      kind: "TOOL",
      toolName: args.toolName,
      status: "SUCCESS",
      startedAt: args.now,
      completedAt: args.now,
      evidenceReferences: evidence.evidenceReferences,
      summary: evidence.summary,
      errorCode: null,
    });
    return { ...evidence, duplicate: false };
  },
});

export const submitInvestigation = internalMutation({
  args: {
    runId: v.string(),
    tokenHash: v.string(),
    now: v.number(),
    idempotencyKey: v.string(),
    provider: v.union(
      v.literal("OPENAI"),
      v.literal("ANTHROPIC"),
      v.literal("DETERMINISTIC_FALLBACK"),
    ),
    model: v.union(v.string(), v.null()),
    findings: findingValidator,
  },
  handler: async (ctx, args) => {
    const runById = await ctx.db
      .query("agentRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .unique();
    if (
      runById?.status === "COMPLETED" &&
      runById.submissionIdempotencyKey === args.idempotencyKey
    ) {
      return { ok: true as const, duplicate: true, status: "COMPLETED" as const };
    }
    const authorization = await authorizedRun(ctx, args);
    if (!authorization.ok) return authorization;
    const run = authorization.run;
    const { careCase, refillCase } = await scopedCase(ctx, run);
    if (!isCaseCurrent(run, careCase, refillCase)) {
      await ctx.db.patch("agentRuns", run._id, {
        status: "FAILED",
        failureCode: "STALE_CASE_VERSION",
        updatedAt: args.now,
        completedAt: args.now,
      });
      if (careCase && careCase.caseVersion === run.caseVersion) {
        await ctx.db.patch("careCases", careCase._id, {
          investigationStatus: "FAILED",
          updatedAt: args.now,
        });
      }
      if (refillCase && refillCase.caseVersion === run.caseVersion) await ctx.db.patch("refillCases", refillCase._id, { investigationStatus: "FAILED", updatedAt: args.now });
      return { ok: false as const, code: "STALE_CASE_VERSION" as const };
    }
    if (!args.idempotencyKey.trim() || args.idempotencyKey.length > 160) {
      return { ok: false as const, code: "INVALID_IDEMPOTENCY_KEY" as const };
    }
    if (args.model !== null && args.model.length > 100) {
      return { ok: false as const, code: "INVALID_MODEL" as const };
    }
    if (
      args.findings.items.length < 1 ||
      args.findings.items.length > 6 ||
      args.findings.overallSummary.length < 1 ||
      args.findings.overallSummary.length > 800 ||
      args.findings.proposedFollowUp.explanation.length < 1 ||
      args.findings.proposedFollowUp.explanation.length > 500 ||
      args.findings.items.some(
        (item) =>
          item.explanation.length < 1 ||
          item.explanation.length > 600 ||
          item.evidenceReferences.length < 1 ||
          item.evidenceReferences.length > 20,
      )
    ) {
      return { ok: false as const, code: "INVALID_FINDINGS" as const };
    }

    const actions = await ctx.db
      .query("agentActions")
      .withIndex("by_run_and_startedAt", (q) => q.eq("runId", run._id))
      .take(20);
    const allowedEvidence = new Set<string>([
      ...(careCase ? [
        `occurrence:${careCase.occurrenceId}`,
        `patientReport:${careCase.occurrenceId}`,
        ...(careCase.evidenceReferences.commandId ? [`command:${careCase.evidenceReferences.commandId}`] : []),
        ...careCase.evidenceReferences.deviceEventIds.map((id) => `deviceEvent:${id}`),
        ...careCase.evidenceReferences.reminderEventIds.map((id) => `reminderEvent:${id}`),
      ] : []),
      ...(refillCase ? [`refillCase:${refillCase._id}`, `medication:${refillCase.medicationId}`, `assignment:${refillCase.assignmentId}`] : []),
      ...actions.flatMap((action) => action.evidenceReferences),
    ]);
    const citedEvidence = args.findings.items.flatMap((item) => item.evidenceReferences);
    if (citedEvidence.some((reference) => !allowedEvidence.has(reference))) {
      return { ok: false as const, code: "INVALID_EVIDENCE_REFERENCE" as const };
    }

    await ctx.db.patch("agentRuns", run._id, {
      status: "COMPLETED",
      provider: args.provider,
      model: args.model,
      findings: args.findings,
      failureCode: null,
      submissionIdempotencyKey: args.idempotencyKey,
      updatedAt: args.now,
      completedAt: args.now,
    });
    if (careCase) await ctx.db.patch("careCases", careCase._id, { investigationStatus: "COMPLETED", updatedAt: args.now });
    if (refillCase) await ctx.db.patch("refillCases", refillCase._id, { investigationStatus: "COMPLETED", updatedAt: args.now });
    await ctx.db.insert("agentActions", {
      actionId: `submit:${args.idempotencyKey}`,
      runId: run._id,
      patientId: run.patientId,
      kind: "WORKFLOW",
      toolName: "submit_investigation",
      status: "SUCCESS",
      startedAt: args.now,
      completedAt: args.now,
      evidenceReferences: [...new Set(citedEvidence)].slice(0, 50),
      summary: "Structured investigation submitted",
      errorCode: null,
    });
    return { ok: true as const, duplicate: false, status: "COMPLETED" as const };
  },
});

export const failRun = internalMutation({
  args: {
    runId: v.string(),
    tokenHash: v.string(),
    now: v.number(),
    idempotencyKey: v.string(),
    failureCode: v.string(),
  },
  handler: async (ctx, args) => {
    const authorization = await authorizedRun(ctx, args);
    if (!authorization.ok) {
      const existing = await ctx.db
        .query("agentActions")
        .withIndex("by_actionId", (q) => q.eq("actionId", `failure:${args.idempotencyKey}`))
        .unique();
      return existing
        ? { ok: true as const, duplicate: true }
        : authorization;
    }
    const run = authorization.run;
    const safeCode = args.failureCode.trim().slice(0, 100) || "WORKER_FAILURE";
    await ctx.db.patch("agentRuns", run._id, {
      status: "FAILED",
      failureCode: safeCode,
      updatedAt: args.now,
      completedAt: args.now,
    });
    const { careCase, refillCase } = await scopedCase(ctx, run);
    if (careCase?.caseVersion === run.caseVersion) {
      await ctx.db.patch("careCases", careCase._id, {
        investigationStatus: "FAILED",
        updatedAt: args.now,
      });
    }
    if (refillCase?.caseVersion === run.caseVersion) await ctx.db.patch("refillCases", refillCase._id, { investigationStatus: "FAILED", updatedAt: args.now });
    await ctx.db.insert("agentActions", {
      actionId: `failure:${args.idempotencyKey}`,
      runId: run._id,
      patientId: run.patientId,
      kind: "WORKFLOW",
      toolName: "workflow_failure",
      status: "FAILED",
      startedAt: args.now,
      completedAt: args.now,
      evidenceReferences: [],
      summary: "Coordinator run failed; deterministic care case remains active",
      errorCode: safeCode,
    });
    return { ok: true as const, duplicate: false };
  },
});

/**
 * Keeps synthetic care alerts actionable when the optional Python worker is offline.
 * A live worker has a grace period to claim the run first; claimed/RUNNING work is
 * never replaced. This fallback does not infer ingestion or recommend medication use.
 */
export const completePendingFallbacks = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const staleBefore = now - 90_000;
    const pending = await ctx.db.query("agentRuns")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "PENDING").lte("createdAt", staleBefore))
      .order("asc").take(20);
    let completed = 0;
    for (const run of pending) {
      const patient = await ctx.db.get("appUsers", run.patientId);
      if (!patient?.isSynthetic || run.source !== "AUTOMATION") continue;
      const { careCase, refillCase } = await scopedCase(ctx, run);
      if (!isCaseCurrent(run, careCase, refillCase)) continue;
      const findings = refillCase ? {
        items: [{
          category: "POSSIBLE_SUPPLY_ISSUE" as const,
          evidenceReferences: [`refillCase:${refillCase._id}`],
          uncertainty: "MEDIUM" as const,
          explanation: "The schedule-based supply estimate crossed the configured low-supply threshold. The physical count has not been sensor verified.",
        }],
        overallSummary: "NON_LLM_FALLBACK: PillSense detected a low synthetic supply estimate. A caregiver should verify the physical supply before requesting a refill.",
        proposedFollowUp: {
          actionType: "CHECK_PHYSICAL_SUPPLY" as const,
          explanation: "Verify the remaining supply, then use the existing caregiver review and refill workflow if appropriate.",
        },
      } : careCase ? {
        items: [{
          category: "NO_RECORDED_RESPONSE" as const,
          evidenceReferences: [`occurrence:${careCase.occurrenceId}`],
          uncertainty: "HIGH" as const,
          explanation: "No patient response was recorded during the reminder window. Device and camera evidence do not establish ingestion.",
        }],
        overallSummary: "NON_LLM_FALLBACK: The scheduled dose received no patient response. PillSense cannot determine whether medication was taken.",
        proposedFollowUp: {
          actionType: "CONTACT_PATIENT" as const,
          explanation: "Use the care team's established process to contact the patient and document the outcome.",
        },
      } : null;
      if (!findings) continue;
      await ctx.db.patch("agentRuns", run._id, {
        status: "COMPLETED",
        provider: "DETERMINISTIC_FALLBACK",
        model: "NON_LLM_FALLBACK",
        findings,
        failureCode: null,
        submissionIdempotencyKey: `fallback:${run.runId}`,
        updatedAt: now,
        completedAt: now,
      });
      if (careCase) await ctx.db.patch("careCases", careCase._id, { investigationStatus: "COMPLETED", updatedAt: now });
      if (refillCase) await ctx.db.patch("refillCases", refillCase._id, { investigationStatus: "COMPLETED", updatedAt: now });
      await ctx.db.insert("agentActions", {
        actionId: `fallback:${run.runId}`,
        runId: run._id,
        patientId: run.patientId,
        kind: "WORKFLOW",
        toolName: "submit_investigation",
        status: "SUCCESS",
        startedAt: now,
        completedAt: now,
        evidenceReferences: findings.items.flatMap((item) => item.evidenceReferences),
        summary: "NON_LLM_FALLBACK completed after the coordinator remained unavailable",
        errorCode: null,
      });
      completed += 1;
    }
    return { checked: pending.length, completed };
  },
});
