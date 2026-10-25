import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requirePatientAccess } from "./lib/authorization";
import { educationForMedication } from "./lib/medicationEducation";

const intentValidator = v.union(
  v.literal("YES"),
  v.literal("NO"),
  v.literal("REPEAT"),
  v.literal("REQUEST_MORE_INFORMATION"),
);
const sourceValidator = v.union(v.literal("VOICE"), v.literal("TEXT"));

async function occurrenceContext(ctx: MutationCtx, occurrenceId: Doc<"doseOccurrences">["_id"]) {
  const occurrence = await ctx.db.get("doseOccurrences", occurrenceId);
  if (!occurrence) throw new ConvexError("Dose occurrence is unavailable");
  await requirePatientAccess(ctx, occurrence.patientId);
  const medication = await ctx.db.get("medications", occurrence.medicationId);
  const patient = await ctx.db.get("appUsers", occurrence.patientId);
  if (!medication?.active || !patient) throw new ConvexError("Medication session context is unavailable");
  return { occurrence, medication, patient };
}

async function ensureSession(ctx: MutationCtx, occurrenceId: Doc<"doseOccurrences">["_id"], now: number) {
  const context = await occurrenceContext(ctx, occurrenceId);
  const existing = await ctx.db.query("medicationInteractionSessions")
    .withIndex("by_occurrence", (q) => q.eq("occurrenceId", occurrenceId)).unique();
  if (existing) return { session: existing, ...context, created: false };
  const prior = await ctx.db.query("medicationInteractionSessions")
    .withIndex("by_patient_and_medication", (q) =>
      q.eq("patientId", context.occurrence.patientId).eq("medicationId", context.occurrence.medicationId),
    ).take(2);
  const sessionId = await ctx.db.insert("medicationInteractionSessions", {
    occurrenceId,
    patientId: context.occurrence.patientId,
    medicationId: context.occurrence.medicationId,
    firstInteraction: prior.length === 0,
    state: "AWAITING_READINESS",
    greetingStatus: "NOT_ISSUED",
    cameraConsent: false,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("medicationInteractionEvents", {
    sessionId,
    occurrenceId,
    patientId: context.occurrence.patientId,
    type: "SESSION_CREATED",
    source: "SYSTEM",
    occurredAt: now,
  });
  const session = await ctx.db.get("medicationInteractionSessions", sessionId);
  if (!session) throw new ConvexError("Unable to create medication session");
  return { session, ...context, created: true };
}

function patientFirstName(displayName: string) {
  return displayName.trim().split(/\s+/)[0] || "there";
}

function present(session: Doc<"medicationInteractionSessions">, medication: Doc<"medications">, patientName: string) {
  const education = educationForMedication(medication);
  return {
    id: session._id,
    occurrenceId: session.occurrenceId,
    state: session.state,
    greetingStatus: session.greetingStatus,
    firstInteraction: session.firstInteraction,
    cameraConsent: session.cameraConsent,
    patientFirstName: patientFirstName(patientName),
    medicationName: medication.name,
    instructions: medication.instructions,
    education: education ? {
      available: true as const,
      sourceTitle: education.sourceTitle,
      sourceUrl: education.sourceUrl,
    } : { available: false as const, sourceTitle: null, sourceUrl: null },
  };
}

export const getForOccurrence = query({
  args: { occurrenceId: v.id("doseOccurrences") },
  handler: async (ctx, args) => {
    const occurrence = await ctx.db.get("doseOccurrences", args.occurrenceId);
    if (!occurrence) return null;
    await requirePatientAccess(ctx, occurrence.patientId);
    const [session, medication, patient] = await Promise.all([
      ctx.db.query("medicationInteractionSessions").withIndex("by_occurrence", (q) => q.eq("occurrenceId", args.occurrenceId)).unique(),
      ctx.db.get("medications", occurrence.medicationId),
      ctx.db.get("appUsers", occurrence.patientId),
    ]);
    return session && medication && patient ? present(session, medication, patient.displayName) : null;
  },
});

export const claimGreeting = mutation({
  args: { occurrenceId: v.id("doseOccurrences") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const { session, medication, patient } = await ensureSession(ctx, args.occurrenceId, now);
    if (session.greetingStatus !== "NOT_ISSUED") {
      return { shouldPlay: false as const, session: present(session, medication, patient.displayName) };
    }
    await ctx.db.patch("medicationInteractionSessions", session._id, { greetingStatus: "CLAIMED", updatedAt: now });
    await ctx.db.insert("medicationInteractionEvents", {
      sessionId: session._id, occurrenceId: session.occurrenceId, patientId: session.patientId,
      type: "GREETING_CLAIMED", source: "SYSTEM", occurredAt: now,
    });
    const updated = { ...session, greetingStatus: "CLAIMED" as const, updatedAt: now };
    return { shouldPlay: true as const, session: present(updated, medication, patient.displayName) };
  },
});

export const recordGreetingOutcome = mutation({
  args: {
    sessionId: v.id("medicationInteractionSessions"),
    outcome: v.union(v.literal("PLAYED"), v.literal("PLAYBACK_BLOCKED"), v.literal("FAILED")),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("medicationInteractionSessions", args.sessionId);
    if (!session) throw new ConvexError("Medication session is unavailable");
    await requirePatientAccess(ctx, session.patientId);
    const now = Date.now();
    await ctx.db.patch("medicationInteractionSessions", session._id, { greetingStatus: args.outcome, updatedAt: now });
    await ctx.db.insert("medicationInteractionEvents", {
      sessionId: session._id, occurrenceId: session.occurrenceId, patientId: session.patientId,
      type: args.outcome === "PLAYED" ? "GREETING_PLAYED" : args.outcome === "PLAYBACK_BLOCKED" ? "GREETING_PLAYBACK_BLOCKED" : "GREETING_FAILED",
      source: "SYSTEM", occurredAt: now,
    });
    return { greetingStatus: args.outcome };
  },
});

export const respond = mutation({
  args: { occurrenceId: v.id("doseOccurrences"), intent: intentValidator, source: sourceValidator },
  handler: async (ctx, args) => {
    const now = Date.now();
    const { session, medication } = await ensureSession(ctx, args.occurrenceId, now);
    const education = educationForMedication(medication);
    let next = session.state;
    let response: string;
    let eventType: Doc<"medicationInteractionEvents">["type"] = "PATIENT_INTENT";

    if (args.intent === "REPEAT") {
      response = session.state === "AWAITING_CONTINUE" && education
        ? `${education.spokenSummary} Would you like to continue with your scheduled medication routine?`
        : "Please answer yes or no to the current question.";
    } else if (args.intent === "REQUEST_MORE_INFORMATION") {
      response = education
        ? `${education.spokenSummary} Would you like to continue with your scheduled medication routine?`
        : `I do not have reviewed medication education for ${medication.name}. Your caregiver-approved instruction is: ${medication.instructions || "No additional instruction is recorded"}.`;
      if (education) next = "AWAITING_CONTINUE";
    } else if (args.intent === "NO") {
      next = "DECLINED";
      eventType = "SESSION_DECLINED";
      response = "Okay. The routine is paused. No hardware command was issued and your care team can still review the reminder.";
    } else if (session.state === "AWAITING_READINESS") {
      if (session.firstInteraction && education) {
        next = "AWAITING_EDUCATION_CHOICE";
        response = `I noticed this is your first scheduled interaction with ${medication.name}. Would you like to hear general side-effect information from ${education.sourceTitle}?`;
      } else {
        next = "READY_FOR_SUPERVISED_ROUTINE";
        eventType = "ROUTINE_READY";
        response = "Okay. Let's get everything ready. An authorized operator must use Hardware Lab for any supervised motor test.";
      }
    } else if (session.state === "AWAITING_EDUCATION_CHOICE") {
      if (!education) {
        next = "READY_FOR_SUPERVISED_ROUTINE";
        eventType = "ROUTINE_READY";
        response = `I do not have reviewed medication education for ${medication.name}. Your recorded instruction is: ${medication.instructions || "No additional instruction is recorded"}. An operator must supervise any hardware test.`;
      } else {
        next = "AWAITING_CONTINUE";
        eventType = "EDUCATION_PRESENTED";
        response = `${education.spokenSummary} Would you like to continue with your scheduled medication routine?`;
      }
    } else if (session.state === "AWAITING_CONTINUE") {
      next = "READY_FOR_SUPERVISED_ROUTINE";
      eventType = "ROUTINE_READY";
      response = "Okay. Let's get everything ready. Voice cannot move the motor; an authorized operator must use the supervised Hardware Lab controls.";
    } else if (session.state === "READY_FOR_SUPERVISED_ROUTINE") {
      response = "The routine is ready for operator supervision. Voice cannot dispatch a motor command.";
    } else {
      response = "This medication session is already closed. No hardware command was issued.";
    }

    await ctx.db.patch("medicationInteractionSessions", session._id, { state: next, updatedAt: now });
    await ctx.db.insert("medicationInteractionEvents", {
      sessionId: session._id, occurrenceId: session.occurrenceId, patientId: session.patientId,
      type: eventType, intent: args.intent, detailCode: education?.code, source: args.source, occurredAt: now,
    });
    return { state: next, response, educationSourceUrl: eventType === "EDUCATION_PRESENTED" ? education?.sourceUrl ?? null : null };
  },
});

export const setCameraConsent = mutation({
  args: { occurrenceId: v.id("doseOccurrences"), consent: v.boolean() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const { session } = await ensureSession(ctx, args.occurrenceId, now);
    if (session.cameraConsent === args.consent) return { consent: args.consent, duplicate: true };
    await ctx.db.patch("medicationInteractionSessions", session._id, { cameraConsent: args.consent, updatedAt: now });
    await ctx.db.insert("medicationInteractionEvents", {
      sessionId: session._id, occurrenceId: session.occurrenceId, patientId: session.patientId,
      type: "CAMERA_CONSENT_CHANGED", detailCode: args.consent ? "CONSENTED" : "REVOKED", source: "TEXT", occurredAt: now,
    });
    return { consent: args.consent, duplicate: false };
  },
});
