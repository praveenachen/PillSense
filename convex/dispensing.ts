import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requirePatientAccess } from "./lib/authorization";
import { validateSlot } from "./lib/medicationValidation";
import {
  reconcileOccurrence,
  reminderWindowsForPatient,
} from "./lib/reminderReconciliation";

async function reconcileAfterEvidence(
  ctx: MutationCtx,
  occurrenceId: Id<"doseOccurrences">,
  now: number,
) {
  const occurrence = await ctx.db.get("doseOccurrences", occurrenceId);
  if (!occurrence) return;
  const windows = await reminderWindowsForPatient(ctx, occurrence.patientId);
  await reconcileOccurrence(ctx, occurrence, now, "SCHEDULED_CHECK", windows);
}

const eventType = v.union(
  v.literal("COMMAND_ACCEPTED"),
  v.literal("MOTOR_STARTED"),
  v.literal("MOTOR_COMPLETED"),
  v.literal("UNKNOWN"),
  v.literal("FAULT"),
  v.literal("DISCONNECTED"),
);

export const authorize = mutation({
  args: { occurrenceId: v.id("doseOccurrences") },
  handler: async (ctx, args) => {
    const occurrence = await ctx.db.get("doseOccurrences", args.occurrenceId);
    if (!occurrence) throw new ConvexError("Dose occurrence is unavailable");
    await requirePatientAccess(ctx, occurrence.patientId);

    const [medication, schedule] = await Promise.all([
      ctx.db.get("medications", occurrence.medicationId),
      ctx.db.get("medicationSchedules", occurrence.scheduleId),
    ]);
    if (!medication?.active || !schedule?.active) {
      throw new ConvexError("This occurrence belongs to an inactive medication schedule");
    }
    if (
      schedule.patientId !== occurrence.patientId ||
      schedule.medicationId !== occurrence.medicationId ||
      (schedule.revision ?? 1) !== occurrence.scheduleRevision
    ) {
      throw new ConvexError("This occurrence is stale and cannot be dispensed");
    }
    if (occurrence.attemptStatus !== "NONE" || occurrence.commandId) {
      throw new ConvexError("This occurrence has already been attempted");
    }

    const now = Date.now();
    if (now < occurrence.eligibleFrom) {
      throw new ConvexError("This occurrence is not due yet");
    }
    if (now > occurrence.expiresAt) {
      throw new ConvexError("This occurrence has expired");
    }

    const assignments = await ctx.db
      .query("compartmentAssignments")
      .withIndex("by_medication", (q) => q.eq("medicationId", occurrence.medicationId))
      .take(2);
    const assignment = assignments.find(
      (candidate) => candidate.active && candidate.patientId === occurrence.patientId,
    );
    if (!assignment) throw new ConvexError("No active compartment assignment exists");
    validateSlot(assignment.slot);
    if (assignment.demoInventory !== 1) {
      throw new ConvexError("The assigned compartment has no demo pill loaded");
    }

    const device = await ctx.db.get("devices", assignment.deviceId);
    if (!device || device.patientId !== occurrence.patientId) {
      throw new ConvexError("The assigned device is unavailable");
    }
    const runtime = await ctx.db
      .query("deviceRuntime")
      .withIndex("by_device", (q) => q.eq("deviceId", device._id))
      .unique();
    if (!runtime?.connected || !runtime.homeAligned || runtime.state !== "READY") {
      throw new ConvexError("The mock device must be connected, calibrated, and ready");
    }

    const previousCommand = await ctx.db
      .query("dispenseCommands")
      .withIndex("by_occurrence", (q) => q.eq("occurrenceId", occurrence._id))
      .unique();
    if (previousCommand) {
      throw new ConvexError("This occurrence already has a dispense command");
    }

    const commandId = `cmd:${occurrence.occurrenceKey}`;
    const duplicateId = await ctx.db
      .query("dispenseCommands")
      .withIndex("by_commandId", (q) => q.eq("commandId", commandId))
      .unique();
    if (duplicateId) throw new ConvexError("Duplicate dispense command ID");

    await ctx.db.insert("dispenseCommands", {
      commandId,
      occurrenceId: occurrence._id,
      patientId: occurrence.patientId,
      medicationId: occurrence.medicationId,
      scheduleId: occurrence.scheduleId,
      deviceId: device._id,
      assignmentId: assignment._id,
      slot: assignment.slot,
      status: "AUTHORIZED",
      motorCompletion: "NOT_STARTED",
      pillRelease: "UNKNOWN",
      pillCollection: "UNKNOWN",
      expiresAt: occurrence.expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("doseOccurrences", occurrence._id, {
      attemptStatus: "AUTHORIZED",
      commandId,
    });
    return {
      authorization: "AUTHORIZED" as const,
      commandId,
      slot: assignment.slot,
      expiresAt: occurrence.expiresAt,
    };
  },
});

export const markDispatched = mutation({
  args: { commandId: v.string() },
  handler: async (ctx, args) => {
    const command = await ctx.db
      .query("dispenseCommands")
      .withIndex("by_commandId", (q) => q.eq("commandId", args.commandId))
      .unique();
    if (!command) throw new ConvexError("Dispense command is unavailable");
    await requirePatientAccess(ctx, command.patientId);
    if (command.status !== "AUTHORIZED") {
      throw new ConvexError("Dispense command has already been dispatched");
    }
    const now = Date.now();
    if (now > command.expiresAt) throw new ConvexError("Dispense command has expired");
    await ctx.db.patch("dispenseCommands", command._id, {
      status: "DISPATCHED",
      updatedAt: now,
    });
    await ctx.db.patch("doseOccurrences", command.occurrenceId, {
      attemptStatus: "DISPATCHED",
    });
    const runtime = await ctx.db
      .query("deviceRuntime")
      .withIndex("by_device", (q) => q.eq("deviceId", command.deviceId))
      .unique();
    if (runtime) {
      await ctx.db.patch("deviceRuntime", runtime._id, {
        state: "DISPENSING",
        updatedAt: now,
      });
    }
    return { dispatched: true };
  },
});

export const ingestMockEvent = mutation({
  args: {
    eventId: v.string(),
    commandId: v.string(),
    type: eventType,
    occurredAt: v.number(),
  },
  handler: async (ctx, args) => {
    if (!args.eventId.trim()) throw new ConvexError("Device event ID is required");
    const command = await ctx.db
      .query("dispenseCommands")
      .withIndex("by_commandId", (q) => q.eq("commandId", args.commandId))
      .unique();
    if (!command) throw new ConvexError("Dispense command is unavailable");
    await requirePatientAccess(ctx, command.patientId);
    const duplicate = await ctx.db
      .query("deviceEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (duplicate) return { duplicate: true, commandStatus: command.status };

    const now = Date.now();
    await ctx.db.insert("deviceEvents", {
      eventId: args.eventId,
      commandId: args.commandId,
      patientId: command.patientId,
      deviceId: command.deviceId,
      type: args.type,
      occurredAt: args.occurredAt,
      receivedAt: now,
    });

    const runtime = await ctx.db
      .query("deviceRuntime")
      .withIndex("by_device", (q) => q.eq("deviceId", command.deviceId))
      .unique();

    if (args.type === "MOTOR_COMPLETED" && command.status === "DISPATCHED") {
      await ctx.db.patch("dispenseCommands", command._id, {
        status: "COMPLETED",
        motorCompletion: "COMPLETED",
        updatedAt: now,
      });
      await ctx.db.patch("doseOccurrences", command.occurrenceId, {
        attemptStatus: "COMPLETED",
      });
      const assignment = await ctx.db.get("compartmentAssignments", command.assignmentId);
      if (assignment?.active && assignment.demoInventory === 1) {
        await ctx.db.patch("compartmentAssignments", assignment._id, { demoInventory: 0 });
      }
      if (runtime) {
        await ctx.db.patch("deviceRuntime", runtime._id, {
          state: "READY",
          connected: true,
          homeAligned: true,
          faultCode: null,
          updatedAt: now,
        });
      }
      await reconcileAfterEvidence(ctx, command.occurrenceId, now);
      return { duplicate: false, commandStatus: "COMPLETED" as const };
    }

    if (
      (args.type === "UNKNOWN" || args.type === "FAULT" || args.type === "DISCONNECTED") &&
      command.status !== "COMPLETED" &&
      command.status !== "UNKNOWN"
    ) {
      await ctx.db.patch("dispenseCommands", command._id, {
        status: "UNKNOWN",
        motorCompletion: "UNKNOWN",
        updatedAt: now,
      });
      await ctx.db.patch("doseOccurrences", command.occurrenceId, {
        attemptStatus: "UNKNOWN",
      });
      if (runtime) {
        await ctx.db.patch("deviceRuntime", runtime._id, {
          state: args.type === "DISCONNECTED" ? "DISCONNECTED" : "FAULT",
          connected: args.type !== "DISCONNECTED",
          homeAligned: false,
          faultCode: args.type === "DISCONNECTED" ? null : "AMBIGUOUS_RESULT",
          updatedAt: now,
        });
      }
      await reconcileAfterEvidence(ctx, command.occurrenceId, now);
      return { duplicate: false, commandStatus: "UNKNOWN" as const };
    }

    if (args.type === "MOTOR_STARTED" && runtime && command.status === "DISPATCHED") {
      await ctx.db.patch("deviceRuntime", runtime._id, {
        state: "DISPENSING",
        updatedAt: now,
      });
    }
    return { duplicate: false, commandStatus: command.status };
  },
});

export const reportIngestion = mutation({
  args: {
    occurrenceId: v.id("doseOccurrences"),
    report: v.union(v.literal("TAKEN"), v.literal("NOT_TAKEN")),
  },
  handler: async (ctx, args) => {
    const occurrence = await ctx.db.get("doseOccurrences", args.occurrenceId);
    if (!occurrence) throw new ConvexError("Dose occurrence is unavailable");
    await requirePatientAccess(ctx, occurrence.patientId);
    if (occurrence.ingestionReport === args.report) {
      return { report: args.report, motorEvidenceChanged: false, duplicate: true };
    }
    await ctx.db.patch("doseOccurrences", occurrence._id, {
      ingestionReport: args.report,
    });
    await reconcileAfterEvidence(ctx, occurrence._id, Date.now());
    return { report: args.report, motorEvidenceChanged: false, duplicate: false };
  },
});
