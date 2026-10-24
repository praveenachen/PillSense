import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { resolveDashboardPatient } from "./lib/authorization";

export const report = mutation({
  args: { idempotencyKey: v.string(), transcript: v.string() },
  handler: async (ctx, args) => {
    const { viewer, patient } = await resolveDashboardPatient(ctx);
    const key = args.idempotencyKey.trim();
    const transcript = args.transcript.trim();
    if (!key || key.length > 120) throw new ConvexError("Invalid device issue idempotency key");
    if (!transcript || transcript.length > 300) throw new ConvexError("Device issue description must contain 1 to 300 characters");
    const existing = await ctx.db.query("patientDeviceIssues").withIndex("by_issueKey", (q) => q.eq("issueKey", key)).unique();
    if (existing) {
      if (existing.patientId !== patient._id || existing.reportedBy !== viewer._id) throw new ConvexError("Device issue key conflict");
      return { issueId: existing._id, duplicate: true, observedState: existing.observedState };
    }
    const device = await ctx.db.query("devices").withIndex("by_patient", (q) => q.eq("patientId", patient._id)).unique();
    if (!device) throw new ConvexError("Patient device is unavailable");
    const runtime = await ctx.db.query("deviceRuntime").withIndex("by_device", (q) => q.eq("deviceId", device._id)).unique();
    const issueId = await ctx.db.insert("patientDeviceIssues", {
      issueKey: key,
      patientId: patient._id,
      deviceId: device._id,
      reportedBy: viewer._id,
      reportedProblem: "PATIENT_REPORTED_DEVICE_PROBLEM",
      transcript,
      observedState: runtime?.state ?? "UNKNOWN",
      observedConnected: runtime?.connected ?? null,
      observedFaultCode: runtime?.faultCode ?? null,
      status: "OPEN",
      createdAt: Date.now(),
    });
    return { issueId, duplicate: false, observedState: runtime?.state ?? "UNKNOWN" };
  },
});

export const listForCaregiver = query({
  args: {},
  handler: async (ctx) => {
    const { viewer, patient } = await resolveDashboardPatient(ctx);
    if (viewer.role !== "caregiver") return { status: "unauthorized" as const, issues: [] };
    const issues = await ctx.db.query("patientDeviceIssues").withIndex("by_patient_and_createdAt", (q) => q.eq("patientId", patient._id)).order("desc").take(20);
    return { status: "ready" as const, patientName: patient.displayName, issues };
  },
});
