import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireHardwareLabOperator, resolveDashboardPatient } from "./lib/authorization";

const source = v.literal("WINDOWS_OPENCV_MEDIAPIPE");
const eventType = v.union(
  v.literal("CAMERA_STARTED"),
  v.literal("CAMERA_STOPPED"),
  v.literal("PERSON_VISIBLE"),
  v.literal("PERSON_NOT_VISIBLE"),
  v.literal("HAND_AT_MOUTH_DETECTED"),
  v.literal("CAMERA_ERROR"),
);
const finalStatus = v.union(
  v.literal("STOPPED"),
  v.literal("ERROR"),
  v.literal("EXPIRED"),
);
const SESSION_TTL_MS = 5 * 60_000;

function sessionExpiresAt(startedAt: number) {
  return startedAt + SESSION_TTL_MS;
}

function validateExternalId(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(value)) {
    throw new ConvexError(`${label} is invalid`);
  }
}

function validateTimestamp(value: number, now: number, label: string) {
  if (!Number.isFinite(value) || value <= 0 || value > now + 60_000) {
    throw new ConvexError(`${label} is invalid`);
  }
}

export const beginSession = mutation({
  args: { sessionId: v.string(), startedAt: v.number() },
  handler: async (ctx, args) => {
    validateExternalId(args.sessionId, "Session ID");
    const now = Date.now();
    validateTimestamp(args.startedAt, now, "Start time");
    const { viewer, patient } = await requireHardwareLabOperator(ctx);
    const existing = await ctx.db
      .query("cameraObservationSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (existing) {
      if (existing.initiatedBy !== viewer._id || existing.patientId !== patient._id) {
        throw new ConvexError("Camera session access denied");
      }
      if (existing.status !== "ACTIVE") {
        throw new ConvexError("Camera session ID is already closed");
      }
      const expiresAt = sessionExpiresAt(existing.startedAt);
      if (now >= expiresAt) {
        await ctx.db.patch(existing._id, {
          status: "EXPIRED",
          endedAt: now,
          updatedAt: now,
        });
        throw new ConvexError("Camera session has expired");
      }
      return {
        kind: "RECOVER_EXISTING" as const,
        sessionId: existing.sessionId,
        expiresAt,
      };
    }

    const active = await ctx.db
      .query("cameraObservationSessions")
      .withIndex("by_patient_and_status", (q) =>
        q.eq("patientId", patient._id).eq("status", "ACTIVE"),
      )
      .first();
    if (active && now >= sessionExpiresAt(active.startedAt)) {
      await ctx.db.patch(active._id, { status: "EXPIRED", endedAt: now, updatedAt: now });
    } else if (active) {
      if (active.initiatedBy !== viewer._id) {
        throw new ConvexError("Another authorized operator owns the active camera session");
      }
      return {
        kind: "RECOVER_EXISTING" as const,
        sessionId: active.sessionId,
        expiresAt: sessionExpiresAt(active.startedAt),
      };
    }

    const sessionId = await ctx.db.insert("cameraObservationSessions", {
      sessionId: args.sessionId,
      patientId: patient._id,
      initiatedBy: viewer._id,
      source: "WINDOWS_OPENCV_MEDIAPIPE",
      status: "ACTIVE",
      startedAt: args.startedAt,
      createdAt: now,
      updatedAt: now,
    });
    return {
      kind: "CREATED" as const,
      sessionId: args.sessionId,
      expiresAt: sessionExpiresAt(args.startedAt),
      recordId: sessionId,
    };
  },
});

export const inspectSession = mutation({
  args: {},
  handler: async (ctx) => {
    const serverNow = Date.now();
    const { viewer, patient } = await requireHardwareLabOperator(ctx);
    const active = await ctx.db
      .query("cameraObservationSessions")
      .withIndex("by_patient_and_status", (q) =>
        q.eq("patientId", patient._id).eq("status", "ACTIVE"),
      )
      .first();
    if (!active) return { kind: "NONE" as const, reconciled: false };
    const expiresAt = sessionExpiresAt(active.startedAt);
    if (serverNow >= expiresAt) {
      await ctx.db.patch(active._id, {
        status: "EXPIRED",
        endedAt: serverNow,
        updatedAt: serverNow,
      });
      return { kind: "NONE" as const, reconciled: true };
    }
    if (active.initiatedBy !== viewer._id) {
      return { kind: "OTHER_OPERATOR_ACTIVE" as const, expiresAt };
    }
    return {
      kind: "OWNED_ACTIVE" as const,
      sessionId: active.sessionId,
      startedAt: active.startedAt,
      expiresAt,
    };
  },
});

export const recordEvent = mutation({
  args: {
    sessionId: v.string(),
    eventId: v.string(),
    type: eventType,
    source,
    occurredAt: v.number(),
    diagnostic: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateExternalId(args.sessionId, "Session ID");
    validateExternalId(args.eventId, "Event ID");
    const { viewer, patient } = await requireHardwareLabOperator(ctx);
    const session = await ctx.db
      .query("cameraObservationSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (!session || session.initiatedBy !== viewer._id || session.patientId !== patient._id) {
      throw new ConvexError("Camera session access denied");
    }
    const now = Date.now();
    validateTimestamp(args.occurredAt, now, "Event time");
    if (args.occurredAt < session.startedAt - 60_000) {
      throw new ConvexError("Event predates the camera session");
    }
    if (args.diagnostic && args.diagnostic.length > 240) {
      throw new ConvexError("Camera diagnostic is too long");
    }
    const existing = await ctx.db
      .query("cameraObservationEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (existing) {
      if (
        existing.sessionId !== session._id || existing.type !== args.type ||
        existing.source !== args.source || existing.occurredAt !== args.occurredAt
      ) throw new ConvexError("Event ID collision");
      return { eventId: existing._id, duplicate: true };
    }
    if (session.status !== "ACTIVE" && args.type !== "CAMERA_STOPPED") {
      throw new ConvexError("Camera session is not active");
    }

    const eventId = await ctx.db.insert("cameraObservationEvents", {
      eventId: args.eventId,
      sessionId: session._id,
      patientId: session.patientId,
      type: args.type,
      source: args.source,
      occurredAt: args.occurredAt,
      receivedAt: now,
      ...(args.diagnostic ? { diagnostic: args.diagnostic } : {}),
    });
    if (args.type === "CAMERA_ERROR") {
      await ctx.db.patch(session._id, { status: "ERROR", updatedAt: now });
    } else if (args.type === "CAMERA_STOPPED") {
      await ctx.db.patch(session._id, {
        status: session.status === "ERROR" ? "ERROR" : "STOPPED",
        endedAt: args.occurredAt,
        updatedAt: now,
      });
    }
    return { eventId, duplicate: false };
  },
});

export const closeSession = mutation({
  args: { sessionId: v.string(), status: finalStatus, endedAt: v.number() },
  handler: async (ctx, args) => {
    const { viewer, patient } = await requireHardwareLabOperator(ctx);
    const session = await ctx.db
      .query("cameraObservationSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (!session || session.initiatedBy !== viewer._id || session.patientId !== patient._id) {
      throw new ConvexError("Camera session access denied");
    }
    const now = Date.now();
    validateTimestamp(args.endedAt, now, "End time");
    await ctx.db.patch(session._id, {
      status: session.status === "ERROR" ? "ERROR" : args.status,
      endedAt: args.endedAt,
      updatedAt: now,
    });
    return { closed: true };
  },
});

export const latest = query({
  args: {},
  handler: async (ctx) => {
    const { patient } = await resolveDashboardPatient(ctx);
    const session = await ctx.db
      .query("cameraObservationSessions")
      .withIndex("by_patient_and_startedAt", (q) => q.eq("patientId", patient._id))
      .order("desc")
      .first();
    if (!session) return null;
    const events = await ctx.db
      .query("cameraObservationEvents")
      .withIndex("by_session_and_occurredAt", (q) => q.eq("sessionId", session._id))
      .order("desc")
      .take(50);
    return { session, events };
  },
});
