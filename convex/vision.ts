import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAppUser, resolveDashboardPatient } from "./lib/authorization";

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
    const { viewer, patient } = await resolveDashboardPatient(ctx);
    const existing = await ctx.db
      .query("cameraObservationSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (existing) {
      if (existing.initiatedBy !== viewer._id || existing.patientId !== patient._id) {
        throw new ConvexError("Camera session access denied");
      }
      return { sessionId: existing._id, duplicate: true };
    }

    const active = await ctx.db
      .query("cameraObservationSessions")
      .withIndex("by_patient_and_status", (q) =>
        q.eq("patientId", patient._id).eq("status", "ACTIVE"),
      )
      .first();
    if (active && now - active.startedAt <= 6 * 60_000) {
      throw new ConvexError("A camera observation session is already active");
    }
    if (active) {
      await ctx.db.patch(active._id, { status: "EXPIRED", endedAt: now, updatedAt: now });
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
    return { sessionId, duplicate: false };
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
    const viewer = await requireAppUser(ctx);
    const session = await ctx.db
      .query("cameraObservationSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (!session || session.initiatedBy !== viewer._id) {
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
    const viewer = await requireAppUser(ctx);
    const session = await ctx.db
      .query("cameraObservationSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (!session || session.initiatedBy !== viewer._id) {
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
