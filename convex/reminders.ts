import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { resolveDashboardPatient } from "./lib/authorization";
import { ensureUpcomingOccurrences } from "./lib/occurrenceGeneration";
import {
  DEFAULT_REMINDER_WINDOWS,
  reconcileOccurrence,
  reconcilePatient,
  reminderWindowsForPatient,
  resolveDemoOccurrence,
} from "./lib/reminderReconciliation";

const MINUTE = 60 * 1000;

const scenarioValidator = v.union(
  v.literal("DUE_REMINDER"),
  v.literal("UNANSWERED_ROUTINE"),
  v.literal("OVERDUE_ESCALATION"),
  v.literal("DEVICE_UNRESOLVED"),
);

export const reconcileMine = mutation({
  args: {},
  handler: async (ctx) => {
    const { patient } = await resolveDashboardPatient(ctx);
    const now = Date.now();
    const generated = await ensureUpcomingOccurrences(ctx, patient._id, now);
    const reconciled = await reconcilePatient(ctx, patient._id, now);
    return { ...generated, ...reconciled };
  },
});

export const reconcileAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const schedules = await ctx.db.query("medicationSchedules").take(100);
    const patientIds = new Map<string, (typeof schedules)[number]["patientId"]>();
    for (const schedule of schedules) {
      if (schedule.active) patientIds.set(schedule.patientId, schedule.patientId);
    }
    let generated = 0;
    let checked = 0;
    for (const patientId of patientIds.values()) {
      const generation = await ensureUpcomingOccurrences(ctx, patientId, now);
      const reconciliation = await reconcilePatient(ctx, patientId, now);
      generated += generation.created;
      checked += reconciliation.checked;
    }
    return { patients: patientIds.size, generated, checked };
  },
});

export const configureDemoWindows = mutation({
  args: {
    upcomingWindowMinutes: v.number(),
    followUpWindowMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    const { viewer, patient } = await resolveDashboardPatient(ctx);
    if (!patient.isSynthetic) throw new ConvexError("Demo windows are limited to synthetic patients");
    if (
      !Number.isInteger(args.upcomingWindowMinutes) ||
      args.upcomingWindowMinutes < 1 ||
      args.upcomingWindowMinutes > 120
    ) {
      throw new ConvexError("Upcoming window must be a whole number from 1 to 120 minutes");
    }
    if (
      !Number.isInteger(args.followUpWindowMinutes) ||
      args.followUpWindowMinutes < 1 ||
      args.followUpWindowMinutes > 60
    ) {
      throw new ConvexError("Follow-up window must be a whole number from 1 to 60 minutes");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("reminderSettings")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .unique();
    const value = {
      upcomingWindowMinutes: args.upcomingWindowMinutes,
      followUpWindowMinutes: args.followUpWindowMinutes,
      updatedBy: viewer._id,
      updatedAt: now,
    };
    if (existing) await ctx.db.patch("reminderSettings", existing._id, value);
    else await ctx.db.insert("reminderSettings", { patientId: patient._id, ...value });
    return value;
  },
});

export const runDemoScenario = mutation({
  args: { scenario: scenarioValidator },
  handler: async (ctx, args) => {
    const { viewer, patient } = await resolveDashboardPatient(ctx);
    if (!patient.isSynthetic) throw new ConvexError("Reminder demo mode is limited to synthetic patients");
    const schedules = await ctx.db
      .query("medicationSchedules")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .take(32);
    const schedule = schedules.find((candidate) => candidate.active);
    if (!schedule) throw new ConvexError("Create an active synthetic medication schedule first");
    const medication = await ctx.db.get("medications", schedule.medicationId);
    if (!medication?.active) throw new ConvexError("The demo medication is inactive");

    const now = Date.now();
    const windows = await reminderWindowsForPatient(ctx, patient._id);
    const runId = crypto.randomUUID();
    const runDocId = await ctx.db.insert("demoScenarioRuns", {
      runId,
      patientId: patient._id,
      scenario: args.scenario,
      status: "ACTIVE",
      simulatedNow: now,
      initiatedBy: viewer._id,
      createdAt: now,
    });
    const elapsedMinutes =
      args.scenario === "DUE_REMINDER"
        ? 0
        : args.scenario === "UNANSWERED_ROUTINE"
          ? Math.max(0.5, windows.followUpWindowMinutes / 2)
          : windows.followUpWindowMinutes + 1;
    const scheduledFor = now - elapsedMinutes * MINUTE;
    const occurrenceId = await ctx.db.insert("doseOccurrences", {
      occurrenceKey: `reminder-demo:${runId}`,
      patientId: patient._id,
      medicationId: schedule.medicationId,
      scheduleId: schedule._id,
      scheduleRevision: schedule.revision ?? 1,
      mode: "demo",
      scheduledFor,
      eligibleFrom: scheduledFor - 15 * MINUTE,
      expiresAt: scheduledFor + 30 * MINUTE,
      attemptStatus: "NONE",
      ingestionReport: "UNREPORTED",
      demoScenarioRunId: runDocId,
      demoTriggerHint:
        args.scenario === "DEVICE_UNRESOLVED"
          ? "DEVICE_FAULT_OR_DISCONNECTED"
          : undefined,
      createdAt: now,
    });
    await ctx.db.patch("demoScenarioRuns", runDocId, { occurrenceId });
    const occurrence = await ctx.db.get("doseOccurrences", occurrenceId);
    if (!occurrence) throw new ConvexError("Unable to create the demo occurrence");
    const reminderState = await reconcileOccurrence(
      ctx,
      occurrence,
      now,
      "DEMO_SIMULATION",
      windows,
    );
    return { runId, occurrenceId, reminderState, simulatedNow: now };
  },
});

export const resetDemoScenarios = mutation({
  args: {},
  handler: async (ctx) => {
    const { patient } = await resolveDashboardPatient(ctx);
    if (!patient.isSynthetic) throw new ConvexError("Reminder demo reset is limited to synthetic patients");
    const now = Date.now();
    const runs = await ctx.db
      .query("demoScenarioRuns")
      .withIndex("by_patient_and_status", (q) =>
        q.eq("patientId", patient._id).eq("status", "ACTIVE"),
      )
      .take(50);
    let reset = 0;
    for (const run of runs) {
      if (run.occurrenceId) {
        const occurrence = await ctx.db.get("doseOccurrences", run.occurrenceId);
        if (occurrence) await resolveDemoOccurrence(ctx, occurrence, now);
      }
      await ctx.db.patch("demoScenarioRuns", run._id, { status: "RESET", resetAt: now });
      reset += 1;
    }
    return { reset };
  },
});

export const forPatient = query({
  args: {},
  handler: async (ctx) => {
    const { patient } = await resolveDashboardPatient(ctx);
    const occurrences = await ctx.db
      .query("doseOccurrences")
      .withIndex("by_patient_and_scheduledFor", (q) => q.eq("patientId", patient._id))
      .order("desc")
      .take(50);
    const rows = await Promise.all(
      occurrences
        .filter((occurrence) =>
          occurrence.reminderState !== undefined && occurrence.reminderState !== "RESOLVED",
        )
        .slice(0, 20)
        .map(async (occurrence) => {
          const medication = await ctx.db.get("medications", occurrence.medicationId);
          const assignments = await ctx.db
            .query("compartmentAssignments")
            .withIndex("by_medication", (q) => q.eq("medicationId", occurrence.medicationId))
            .take(2);
          const assignment = assignments.find((candidate) => candidate.active);
          if (!medication || !assignment) return null;
          return {
            occurrenceId: occurrence._id,
            medicationName: medication.name,
            slot: assignment.slot,
            dueAt: occurrence.scheduledFor,
            state: occurrence.reminderState,
            followUpNeeded:
              occurrence.reminderState === "DUE" || occurrence.reminderState === "OVERDUE",
            ingestionReport: occurrence.ingestionReport,
            mode: occurrence.mode,
          };
        }),
    );
    const settings = await ctx.db
      .query("reminderSettings")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .unique();
    return {
      patientName: patient.displayName,
      isSynthetic: patient.isSynthetic,
      windows: settings
        ? {
            upcomingWindowMinutes: settings.upcomingWindowMinutes,
            followUpWindowMinutes: settings.followUpWindowMinutes,
          }
        : DEFAULT_REMINDER_WINDOWS,
      reminders: rows.filter((row) => row !== null),
    };
  },
});
