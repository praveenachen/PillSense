import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export const DEFAULT_REMINDER_WINDOWS = {
  upcomingWindowMinutes: 60,
  followUpWindowMinutes: 15,
} as const;

export type ReminderSource = "SCHEDULED_CHECK" | "DEMO_SIMULATION";
export type ReminderState = "UPCOMING" | "DUE" | "OVERDUE" | "RESOLVED";
export type TriggerReason =
  | "NO_PATIENT_RESPONSE"
  | "MOTOR_COMPLETED_INGESTION_UNCONFIRMED"
  | "MOTOR_OUTCOME_UNKNOWN"
  | "PATIENT_REPORTED_NOT_TAKEN"
  | "DEVICE_FAULT_OR_DISCONNECTED";

export async function reminderWindowsForPatient(
  ctx: MutationCtx,
  patientId: Id<"appUsers">,
) {
  const configured = await ctx.db
    .query("reminderSettings")
    .withIndex("by_patient", (q) => q.eq("patientId", patientId))
    .unique();
  return configured
    ? {
        upcomingWindowMinutes: configured.upcomingWindowMinutes,
        followUpWindowMinutes: configured.followUpWindowMinutes,
      }
    : DEFAULT_REMINDER_WINDOWS;
}

async function persistReminderState(
  ctx: MutationCtx,
  occurrence: Doc<"doseOccurrences">,
  state: ReminderState,
  now: number,
  source: ReminderSource,
) {
  if (occurrence.reminderState !== state) {
    await ctx.db.patch("doseOccurrences", occurrence._id, {
      reminderState: state,
      reminderUpdatedAt: now,
    });
  }
  const eventKey = `${occurrence._id}:${state}`;
  const existing = await ctx.db
    .query("reminderEvents")
    .withIndex("by_eventKey", (q) => q.eq("eventKey", eventKey))
    .unique();
  if (existing) return existing._id;
  return await ctx.db.insert("reminderEvents", {
    eventKey,
    occurrenceId: occurrence._id,
    patientId: occurrence.patientId,
    state,
    source,
    effectiveAt: now,
    recordedAt: Date.now(),
  });
}

async function closeCase(
  ctx: MutationCtx,
  occurrence: Doc<"doseOccurrences">,
  now: number,
  fingerprint: string,
  note: string,
) {
  const careCase = await ctx.db
    .query("careCases")
    .withIndex("by_occurrence", (q) => q.eq("occurrenceId", occurrence._id))
    .unique();
  if (!careCase || (careCase.status === "RESOLVED" && careCase.evidenceFingerprint === fingerprint)) {
    return;
  }
  const fromStatus = careCase.status;
  await ctx.db.patch("careCases", careCase._id, {
    status: "RESOLVED",
    evidenceFingerprint: fingerprint,
    resolutionNote: note,
    resolutionOutcome: "NO_FURTHER_ACTION",
    updatedAt: now,
  });
  await ctx.db.insert("careCaseTransitions", {
    caseId: careCase._id,
    patientId: careCase.patientId,
    type: "RESOLVED",
    fromStatus,
    toStatus: "RESOLVED",
    note,
    outcome: "NO_FURTHER_ACTION",
    occurredAt: now,
  });
}

async function ensureCareCase(
  ctx: MutationCtx,
  occurrence: Doc<"doseOccurrences">,
  now: number,
) {
  const command = await ctx.db
    .query("dispenseCommands")
    .withIndex("by_occurrence", (q) => q.eq("occurrenceId", occurrence._id))
    .unique();
  const deviceEvents = command
    ? await ctx.db
        .query("deviceEvents")
        .withIndex("by_commandId", (q) => q.eq("commandId", command.commandId))
        .take(20)
    : [];
  const hasDeviceIncident = deviceEvents.some(
    (event) => event.type === "FAULT" || event.type === "DISCONNECTED",
  );
  let triggerReason: TriggerReason = "NO_PATIENT_RESPONSE";
  if (occurrence.ingestionReport === "NOT_TAKEN") {
    triggerReason = "PATIENT_REPORTED_NOT_TAKEN";
  } else if (occurrence.demoTriggerHint === "DEVICE_FAULT_OR_DISCONNECTED" || hasDeviceIncident) {
    triggerReason = "DEVICE_FAULT_OR_DISCONNECTED";
  } else if (command?.status === "UNKNOWN" || occurrence.attemptStatus === "UNKNOWN") {
    triggerReason = "MOTOR_OUTCOME_UNKNOWN";
  } else if (command?.motorCompletion === "COMPLETED") {
    triggerReason = "MOTOR_COMPLETED_INGESTION_UNCONFIRMED";
  }

  const reminderEvents = await ctx.db
    .query("reminderEvents")
    .withIndex("by_occurrence", (q) => q.eq("occurrenceId", occurrence._id))
    .take(8);
  const deviceEventIds = deviceEvents.map((event) => event.eventId).sort();
  const fingerprint = JSON.stringify({
    triggerReason,
    patientReport: occurrence.ingestionReport,
    commandId: command?.commandId ?? null,
    commandStatus: command?.status ?? null,
    deviceEventIds,
  });
  const evidenceReferences = {
    commandId: command?.commandId ?? null,
    demoScenarioRunId: occurrence.demoScenarioRunId ?? null,
    reminderEventIds: reminderEvents.map((event) => event._id),
    deviceEventIds,
    patientReport: occurrence.ingestionReport,
  };
  const existing = await ctx.db
    .query("careCases")
    .withIndex("by_occurrence", (q) => q.eq("occurrenceId", occurrence._id))
    .unique();

  if (!existing) {
    const caseId = await ctx.db.insert("careCases", {
      caseId: `case:${occurrence._id}`,
      patientId: occurrence.patientId,
      occurrenceId: occurrence._id,
      caseVersion: 1,
      triggerReason,
      status: "OPEN",
      evidenceFingerprint: fingerprint,
      evidenceReferences,
      investigationStatus: "NOT_REQUESTED",
      acknowledgedBy: null,
      acknowledgedAt: null,
      resolutionNote: null,
      resolutionOutcome: null,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("careCaseTransitions", {
      caseId,
      patientId: occurrence.patientId,
      type: "OPENED",
      fromStatus: null,
      toStatus: "OPEN",
      occurredAt: now,
    });
    return;
  }
  if (existing.evidenceFingerprint === fingerprint) return;

  const wasResolved = existing.status === "RESOLVED";
  await ctx.db.patch("careCases", existing._id, {
    caseVersion: existing.caseVersion + 1,
    triggerReason,
    status: "OPEN",
    evidenceFingerprint: fingerprint,
    evidenceReferences,
    investigationStatus: "NOT_REQUESTED",
    acknowledgedBy: null,
    acknowledgedAt: null,
    resolutionNote: null,
    resolutionOutcome: null,
    updatedAt: now,
  });
  await ctx.db.insert("careCaseTransitions", {
    caseId: existing._id,
    patientId: occurrence.patientId,
    type: wasResolved ? "REOPENED" : "REASON_UPDATED",
    fromStatus: existing.status,
    toStatus: "OPEN",
    occurredAt: now,
  });
}

export async function reconcileOccurrence(
  ctx: MutationCtx,
  occurrence: Doc<"doseOccurrences">,
  now: number,
  source: ReminderSource,
  windows: { upcomingWindowMinutes: number; followUpWindowMinutes: number },
) {
  const [medication, schedule] = await Promise.all([
    ctx.db.get("medications", occurrence.medicationId),
    ctx.db.get("medicationSchedules", occurrence.scheduleId),
  ]);
  const isCurrent =
    medication?.active === true &&
    schedule?.active === true &&
    schedule.patientId === occurrence.patientId &&
    schedule.medicationId === occurrence.medicationId &&
    (schedule.revision ?? 1) === occurrence.scheduleRevision;
  if (!isCurrent) {
    await persistReminderState(ctx, occurrence, "RESOLVED", now, source);
    await closeCase(ctx, occurrence, now, `STALE:${occurrence.scheduleRevision}`, "Schedule changed or became inactive.");
    return "RESOLVED" as const;
  }
  if (occurrence.ingestionReport === "TAKEN") {
    await persistReminderState(ctx, occurrence, "RESOLVED", now, source);
    await closeCase(ctx, occurrence, now, "PATIENT_REPORTED_TAKEN", "Patient reported TAKEN.");
    return "RESOLVED" as const;
  }

  const upcomingAt = occurrence.scheduledFor - windows.upcomingWindowMinutes * MINUTE;
  const overdueAt = occurrence.scheduledFor + windows.followUpWindowMinutes * MINUTE;
  if (now < upcomingAt) return null;

  const state: ReminderState =
    now < occurrence.scheduledFor ? "UPCOMING" : now <= overdueAt ? "DUE" : "OVERDUE";
  await persistReminderState(ctx, occurrence, state, now, source);
  if (state === "OVERDUE") await ensureCareCase(ctx, occurrence, now);
  return state;
}

export async function reconcilePatient(
  ctx: MutationCtx,
  patientId: Id<"appUsers">,
  now: number,
  source: ReminderSource = "SCHEDULED_CHECK",
) {
  const windows = await reminderWindowsForPatient(ctx, patientId);
  const occurrences = await ctx.db
    .query("doseOccurrences")
    .withIndex("by_patient_and_scheduledFor", (q) =>
      q
        .eq("patientId", patientId)
        .gte("scheduledFor", now - 7 * DAY)
        .lte("scheduledFor", now + 7 * DAY),
    )
    .take(100);
  let checked = 0;
  for (const occurrence of occurrences) {
    await reconcileOccurrence(ctx, occurrence, now, source, windows);
    checked += 1;
  }
  return { checked, windows };
}

export async function resolveDemoOccurrence(
  ctx: MutationCtx,
  occurrence: Doc<"doseOccurrences">,
  now: number,
) {
  await persistReminderState(ctx, occurrence, "RESOLVED", now, "DEMO_SIMULATION");
  const careCase = await ctx.db
    .query("careCases")
    .withIndex("by_occurrence", (q) => q.eq("occurrenceId", occurrence._id))
    .unique();
  if (!careCase || careCase.status === "RESOLVED") return;
  await ctx.db.patch("careCases", careCase._id, {
    status: "RESOLVED",
    evidenceFingerprint: `DEMO_RESET:${now}`,
    resolutionNote: "Synthetic scenario reset; underlying records retained.",
    resolutionOutcome: "NO_FURTHER_ACTION",
    updatedAt: now,
  });
  await ctx.db.insert("careCaseTransitions", {
    caseId: careCase._id,
    patientId: careCase.patientId,
    type: "DEMO_RESET",
    fromStatus: careCase.status,
    toStatus: "RESOLVED",
    note: "Synthetic scenario reset; underlying records retained.",
    outcome: "NO_FURTHER_ACTION",
    occurredAt: now,
  });
}
