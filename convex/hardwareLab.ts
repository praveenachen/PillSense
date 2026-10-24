import { query } from "./_generated/server";
import { requireIdentity } from "./lib/requireIdentity";

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
