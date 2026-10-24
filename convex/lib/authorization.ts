import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireIdentity } from "./requireIdentity";

type DatabaseContext = QueryCtx | MutationCtx;

export async function requireAppUser(ctx: DatabaseContext) {
  const identity = await requireIdentity(ctx);
  const user = await ctx.db
    .query("appUsers")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();

  if (!user) {
    throw new ConvexError("Demo onboarding required");
  }

  return user;
}

export async function requireCaregiverAccess(
  ctx: DatabaseContext,
  patientId: Id<"appUsers">,
) {
  const caregiver = await requireAppUser(ctx);
  if (caregiver.role !== "caregiver") {
    throw new ConvexError("Caregiver access required");
  }

  const relationship = await ctx.db
    .query("careRelationships")
    .withIndex("by_caregiver_and_patient", (q) =>
      q.eq("caregiverId", caregiver._id).eq("patientId", patientId),
    )
    .unique();

  if (!relationship || relationship.status !== "active") {
    throw new ConvexError("Patient access denied");
  }

  return { caregiver, relationship };
}

export async function requirePatientAccess(
  ctx: DatabaseContext,
  patientId: Id<"appUsers">,
) {
  const viewer = await requireAppUser(ctx);
  if (viewer.role === "patient" && viewer._id === patientId) {
    return viewer;
  }
  if (viewer.role !== "caregiver") {
    throw new ConvexError("Patient access denied");
  }
  const relationship = await ctx.db
    .query("careRelationships")
    .withIndex("by_caregiver_and_patient", (q) =>
      q.eq("caregiverId", viewer._id).eq("patientId", patientId),
    )
    .unique();
  if (!relationship || relationship.status !== "active") {
    throw new ConvexError("Patient access denied");
  }
  return viewer;
}

export async function resolveDashboardPatient(ctx: QueryCtx) {
  const viewer = await requireAppUser(ctx);
  if (viewer.role === "patient") {
    return { viewer, patient: viewer };
  }

  const relationship = await ctx.db
    .query("careRelationships")
    .withIndex("by_caregiver", (q) => q.eq("caregiverId", viewer._id))
    .first();

  if (!relationship || relationship.status !== "active") {
    throw new ConvexError("No paired patient");
  }

  const patient = await ctx.db.get("appUsers", relationship.patientId);
  if (!patient || patient.role !== "patient") {
    throw new ConvexError("Paired patient is unavailable");
  }

  return { viewer, patient };
}
