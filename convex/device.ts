import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { resolveDashboardPatient } from "./lib/authorization";

export const connectMock = mutation({
  args: {},
  handler: async (ctx) => {
    const { patient } = await resolveDashboardPatient(ctx);
    const device = await ctx.db
      .query("devices")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .unique();
    if (!device) throw new ConvexError("Patient device is unavailable");
    const runtime = await ctx.db
      .query("deviceRuntime")
      .withIndex("by_device", (q) => q.eq("deviceId", device._id))
      .unique();
    const values = {
      deviceId: device._id,
      patientId: patient._id,
      state: "CALIBRATION_REQUIRED" as const,
      connected: true,
      homeAligned: false,
      faultCode: null,
      updatedAt: Date.now(),
    };
    if (runtime) {
      await ctx.db.patch("deviceRuntime", runtime._id, values);
    } else {
      await ctx.db.insert("deviceRuntime", values);
    }
    return { state: values.state, connected: true, homeAligned: false };
  },
});

export const confirmMockHome = mutation({
  args: {},
  handler: async (ctx) => {
    const { patient } = await resolveDashboardPatient(ctx);
    const runtime = await ctx.db
      .query("deviceRuntime")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .unique();
    if (!runtime?.connected) {
      throw new ConvexError("Mock device is disconnected");
    }
    await ctx.db.patch("deviceRuntime", runtime._id, {
      state: "READY",
      homeAligned: true,
      faultCode: null,
      updatedAt: Date.now(),
    });
    return { state: "READY" as const, connected: true, homeAligned: true };
  },
});

export const setDemoCondition = mutation({
  args: {
    condition: v.union(v.literal("FAULT"), v.literal("DISCONNECTED")),
  },
  handler: async (ctx, args) => {
    const { patient } = await resolveDashboardPatient(ctx);
    const runtime = await ctx.db
      .query("deviceRuntime")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .unique();
    if (!runtime) throw new ConvexError("Connect the mock device first");
    await ctx.db.patch("deviceRuntime", runtime._id, {
      state: args.condition,
      connected: args.condition !== "DISCONNECTED",
      homeAligned: false,
      faultCode: args.condition === "FAULT" ? "SIMULATED_FAULT" : null,
      updatedAt: Date.now(),
    });
    return args.condition;
  },
});
