import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { resolveDashboardPatient } from "./lib/authorization";
import { ensureUpcomingOccurrences } from "./lib/occurrenceGeneration";

const MINUTE = 60 * 1000;

export const generateUpcoming = mutation({
  args: {},
  handler: async (ctx) => {
    const { patient } = await resolveDashboardPatient(ctx);
    const now = Date.now();
    return await ensureUpcomingOccurrences(ctx, patient._id, now);
  },
});

export const createDemoDue = mutation({
  args: {},
  handler: async (ctx) => {
    const { patient } = await resolveDashboardPatient(ctx);
    if (!patient.isSynthetic) {
      throw new ConvexError("Demo due mode is limited to synthetic patients");
    }
    const schedules = await ctx.db
      .query("medicationSchedules")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .take(32);
    const schedule = schedules.find((candidate) => candidate.active);
    if (!schedule) {
      throw new ConvexError("No active medication schedule is available for demo mode");
    }
    const medication = await ctx.db.get("medications", schedule.medicationId);
    if (!medication?.active) {
      throw new ConvexError("The scheduled medication is inactive");
    }
    const now = Date.now();
    const revision = schedule.revision ?? 1;
    const bucket = Math.floor(now / (15 * MINUTE));
    const occurrenceKey = `demo:${schedule._id}:${revision}:${bucket}`;
    const existing = await ctx.db
      .query("doseOccurrences")
      .withIndex("by_occurrenceKey", (q) => q.eq("occurrenceKey", occurrenceKey))
      .unique();
    if (existing) return existing._id;

    return await ctx.db.insert("doseOccurrences", {
      occurrenceKey,
      patientId: patient._id,
      medicationId: schedule.medicationId,
      scheduleId: schedule._id,
      scheduleRevision: revision,
      mode: "demo",
      scheduledFor: now,
      eligibleFrom: now - MINUTE,
      expiresAt: now + 15 * MINUTE,
      attemptStatus: "NONE",
      ingestionReport: "UNREPORTED",
      createdAt: now,
    });
  },
});

export const listForPatient = query({
  // `rangeStart`/`rangeEnd` let the Schedule tab page through weeks; other callers use the default window.
  args: { now: v.number(), rangeStart: v.optional(v.number()), rangeEnd: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { patient } = await resolveDashboardPatient(ctx);
    const customRange = args.rangeStart !== undefined && args.rangeEnd !== undefined;
    const occurrences = await ctx.db
      .query("doseOccurrences")
      .withIndex("by_patient_and_scheduledFor", (q) =>
        q
          .eq("patientId", patient._id)
          .gte("scheduledFor", args.rangeStart ?? args.now - 24 * 60 * MINUTE)
          .lte("scheduledFor", args.rangeEnd ?? args.now + 7 * 24 * 60 * MINUTE),
      )
      .take(customRange ? 150 : 50);
    const runtime = await ctx.db
      .query("deviceRuntime")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .unique();

    const rows = await Promise.all(
      occurrences.map(async (occurrence) => {
        const [medication, schedule] = await Promise.all([
          ctx.db.get("medications", occurrence.medicationId),
          ctx.db.get("medicationSchedules", occurrence.scheduleId),
        ]);
        const assignments = await ctx.db
          .query("compartmentAssignments")
          .withIndex("by_medication", (q) =>
            q.eq("medicationId", occurrence.medicationId),
          )
          .take(2);
        const assignment = assignments.find((candidate) => candidate.active);
        if (!medication || !schedule || !assignment) return null;

        let eligibility = "ELIGIBLE";
        if (!medication.active || !schedule.active || (schedule.revision ?? 1) !== occurrence.scheduleRevision) eligibility = "STALE";
        else if (occurrence.attemptStatus === "UNKNOWN") eligibility = "UNCERTAIN";
        else if (occurrence.attemptStatus !== "NONE") eligibility = "ALREADY_ATTEMPTED";
        else if (args.now < occurrence.eligibleFrom) eligibility = "NOT_DUE";
        else if (args.now > occurrence.expiresAt) eligibility = "EXPIRED";
        else if (assignment.demoInventory !== 1) eligibility = "EMPTY";
        else if (!runtime?.connected || runtime.state !== "READY" || !runtime.homeAligned) eligibility = "DEVICE_NOT_READY";

        return {
          id: occurrence._id,
          mode: occurrence.mode,
          medicationName: medication.name,
          instructions: medication.instructions,
          slot: assignment.slot,
          demoInventory: assignment.demoInventory,
          scheduledFor: occurrence.scheduledFor,
          eligibleFrom: occurrence.eligibleFrom,
          expiresAt: occurrence.expiresAt,
          attemptStatus: occurrence.attemptStatus,
          ingestionReport: occurrence.ingestionReport,
          commandId: occurrence.commandId ?? null,
          eligibility,
        };
      }),
    );
    return {
      patientName: patient.displayName,
      device: runtime
        ? {
            state: runtime.state,
            connected: runtime.connected,
            homeAligned: runtime.homeAligned,
            faultCode: runtime.faultCode ?? null,
          }
        : null,
      occurrences: rows.filter((row) => row !== null).sort((a, b) => a.scheduledFor - b.scheduledFor),
    };
  },
});
