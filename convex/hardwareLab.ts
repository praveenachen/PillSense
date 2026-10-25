import { ConvexError, v } from "convex/values";
import { env, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireHardwareLabOperator } from "./lib/authorization";
import { requireIdentity } from "./lib/requireIdentity";

const ARM_DURATION_MS = 10 * 60_000;

async function requireConfiguredDemoOperator(ctx: QueryCtx | MutationCtx) {
  if (env.PILLSENSE_DEMO_ENVIRONMENT !== "development") {
    throw new ConvexError("Voice hardware demo mode is disabled outside development");
  }
  const identity = await requireIdentity(ctx);
  const configuredOperator = env.PILLSENSE_DEMO_OPERATOR_TOKEN_IDENTIFIER?.trim();
  if (!configuredOperator || identity.tokenIdentifier !== configuredOperator) {
    throw new ConvexError("This account is not configured as the voice hardware demo operator");
  }
  return await requireHardwareLabOperator(ctx);
}

/**
 * Server-enforced operator gate for the internal hardware lab.
 * For the hackathon build, an operator is an authenticated caregiver with an
 * explicit active relationship to a synthetic patient. A hidden route alone
 * is never treated as authorization.
 */
export const access = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const viewer = await ctx.db.query("appUsers").withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier)).unique();
    if (!viewer) return { authorized: false as const, reason: "ONBOARDING_REQUIRED" as const };
    if (viewer.role !== "caregiver") {
      return { authorized: false as const, reason: "CAREGIVER_REQUIRED" as const };
    }
    const relationships = await ctx.db
      .query("careRelationships")
      .withIndex("by_caregiver", (q) => q.eq("caregiverId", viewer._id))
      .collect();
    for (const relationship of relationships) {
      if (relationship.status !== "active") continue;
      const patient = await ctx.db.get("appUsers", relationship.patientId);
      if (patient?.role === "patient" && patient.isSynthetic) {
        return {
          authorized: true as const,
          operatorName: viewer.displayName,
          patientName: patient.displayName,
          scope: "SYNTHETIC_PATIENT_LAB" as const,
        };
      }
    }
    return { authorized: false as const, reason: "SYNTHETIC_RELATIONSHIP_REQUIRED" as const };
  },
});

export const voiceDemoArm = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    try {
      const { viewer, patient } = await requireConfiguredDemoOperator(ctx);
      const arm = await ctx.db
        .query("hardwareDemoArms")
        .withIndex("by_armed_by_and_status", (q) =>
          q.eq("armedBy", viewer._id).eq("status", "ARMED"),
        )
        .order("desc")
        .first();
      if (!arm || arm.patientId !== patient._id) return { status: "NOT_ARMED" as const };
      if (arm.expiresAt <= args.now) {
        return { status: "EXPIRED" as const, armId: arm._id };
      }
      return {
        status: "ARMED" as const,
        armId: arm._id,
        connectionId: arm.connectionId,
        expectedSlot: arm.expectedSlot,
        expiresAt: arm.expiresAt,
      };
    } catch (error) {
      return {
        status: "UNAVAILABLE" as const,
        reason: error instanceof Error ? error.message : "Voice hardware demo mode is unavailable",
      };
    }
  },
});

export const armVoiceDemo = mutation({
  args: {
    connectionId: v.string(),
    observedStatus: v.literal("READY"),
    emptyOrInertConfirmed: v.boolean(),
    manualHomeConfirmed: v.boolean(),
    movingPartsClear: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { viewer, patient } = await requireConfiguredDemoOperator(ctx);
    if (!/^[A-Za-z0-9-]{8,80}$/.test(args.connectionId)) {
      throw new ConvexError("The browser Bluetooth connection identifier is invalid");
    }
    if (!args.emptyOrInertConfirmed || !args.manualHomeConfirmed || !args.movingPartsClear) {
      throw new ConvexError("All physical demo safety confirmations are required");
    }
    const device = await ctx.db
      .query("devices")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .unique();
    if (!device) throw new ConvexError("The paired synthetic dispenser is unavailable");

    const now = Date.now();
    const current = await ctx.db
      .query("hardwareDemoArms")
      .withIndex("by_armed_by_and_status", (q) =>
        q.eq("armedBy", viewer._id).eq("status", "ARMED"),
      )
      .order("desc")
      .first();
    if (current && current.expiresAt > now) {
      if (current.connectionId === args.connectionId && current.patientId === patient._id) {
        return { armId: current._id, expiresAt: current.expiresAt, duplicate: true };
      }
      throw new ConvexError("A voice hardware demo is already armed. Disarm it before arming another connection");
    }
    if (current) {
      await ctx.db.patch("hardwareDemoArms", current._id, {
        status: "EXPIRED",
        updatedAt: now,
      });
    }

    const armId = await ctx.db.insert("hardwareDemoArms", {
      patientId: patient._id,
      deviceId: device._id,
      armedBy: viewer._id,
      expectedSlot: 6,
      connectionId: args.connectionId,
      observedStatus: args.observedStatus,
      manualHomeConfirmed: true,
      emptyOrInertConfirmed: true,
      movingPartsClear: true,
      status: "ARMED",
      expiresAt: now + ARM_DURATION_MS,
      createdAt: now,
      updatedAt: now,
    });
    return { armId, expiresAt: now + ARM_DURATION_MS, duplicate: false };
  },
});

export const disarmVoiceDemo = mutation({
  args: { armId: v.id("hardwareDemoArms") },
  handler: async (ctx, args) => {
    const { viewer } = await requireConfiguredDemoOperator(ctx);
    const arm = await ctx.db.get("hardwareDemoArms", args.armId);
    if (!arm || arm.armedBy !== viewer._id) {
      throw new ConvexError("Voice hardware demo arm is unavailable");
    }
    if (arm.status !== "ARMED") return { duplicate: true };
    await ctx.db.patch("hardwareDemoArms", arm._id, {
      status: "DISARMED",
      updatedAt: Date.now(),
    });
    return { duplicate: false };
  },
});
