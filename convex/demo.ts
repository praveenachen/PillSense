import { ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireIdentity } from "./lib/requireIdentity";

export const ensureCareTeam = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const now = Date.now();
    let caregiver = await ctx.db
      .query("appUsers")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (caregiver && caregiver.role !== "caregiver") {
      throw new ConvexError("This account is not a caregiver account");
    }

    if (!caregiver) {
      const caregiverId = await ctx.db.insert("appUsers", {
        tokenIdentifier: identity.tokenIdentifier,
        displayName:
          identity.name ?? identity.givenName ?? identity.email ?? "Demo Caregiver",
        role: "caregiver",
        isSynthetic: false,
        createdAt: now,
      });
      caregiver = await ctx.db.get("appUsers", caregiverId);
    }

    if (!caregiver) {
      throw new ConvexError("Unable to create caregiver profile");
    }

    const existingRelationship = await ctx.db
      .query("careRelationships")
      .withIndex("by_caregiver", (q) => q.eq("caregiverId", caregiver._id))
      .first();

    if (existingRelationship) {
      return {
        caregiverId: caregiver._id,
        patientId: existingRelationship.patientId,
        created: false,
      };
    }

    const patientId = await ctx.db.insert("appUsers", {
      displayName: "Demo Patient",
      role: "patient",
      isSynthetic: true,
      createdAt: now,
    });
    await ctx.db.insert("careRelationships", {
      caregiverId: caregiver._id,
      patientId,
      status: "active",
      createdAt: now,
    });
    await ctx.db.insert("devices", {
      patientId,
      label: "PillSense Demo Dispenser",
      hardwareModel: "ARDUINO_UNO_R4_WIFI",
      physicalPositions: 8,
      createdAt: now,
    });

    return { caregiverId: caregiver._id, patientId, created: true };
  },
});
