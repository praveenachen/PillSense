import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { env, mutation, query } from "./_generated/server";
import { requirePatientAccess } from "./lib/authorization";
import { educationForMedication } from "./lib/medicationEducation";
import { buildSupplyForecast } from "./lib/refillForecast";

const intentValidator = v.union(
  v.literal("YES"),
  v.literal("READY"),
  v.literal("NO"),
  v.literal("REPEAT"),
  v.literal("REQUEST_MORE_INFORMATION"),
  v.literal("REQUEST_SUPPLY_INFORMATION"),
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

function present(
  session: Doc<"medicationInteractionSessions">,
  medication: Doc<"medications">,
  patientName: string,
  command: Doc<"dispenseCommands"> | null = null,
  isSynthetic = false,
) {
  const education = educationForMedication(medication);
  return {
    id: session._id,
    occurrenceId: session.occurrenceId,
    state: session.state,
    greetingStatus: session.greetingStatus,
    firstInteraction: session.firstInteraction,
    cameraConsent: session.cameraConsent,
    patientFirstName: patientFirstName(patientName),
    isSynthetic,
    medicationName: medication.name,
    instructions: medication.instructions,
    hardware: command ? {
      operationId: command.operationId ?? null,
      status: command.status,
      motorCompletion: command.motorCompletion,
      slot: command.slot,
      browserObserved: command.source === "VOICE_BLE_DEMO",
    } : null,
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
    const [session, medication, patient, command] = await Promise.all([
      ctx.db.query("medicationInteractionSessions").withIndex("by_occurrence", (q) => q.eq("occurrenceId", args.occurrenceId)).unique(),
      ctx.db.get("medications", occurrence.medicationId),
      ctx.db.get("appUsers", occurrence.patientId),
      ctx.db.query("dispenseCommands").withIndex("by_occurrence", (q) => q.eq("occurrenceId", args.occurrenceId)).unique(),
    ]);
    return session && medication && patient ? present(session, medication, patient.displayName, command, patient.isSynthetic ?? false) : null;
  },
});

export const claimGreeting = mutation({
  args: { occurrenceId: v.id("doseOccurrences") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const { session, medication, patient } = await ensureSession(ctx, args.occurrenceId, now);
    if (session.greetingStatus !== "NOT_ISSUED") {
      return { shouldPlay: false as const, session: present(session, medication, patient.displayName, null, patient.isSynthetic ?? false) };
    }
    await ctx.db.patch("medicationInteractionSessions", session._id, { greetingStatus: "CLAIMED", updatedAt: now });
    await ctx.db.insert("medicationInteractionEvents", {
      sessionId: session._id, occurrenceId: session.occurrenceId, patientId: session.patientId,
      type: "GREETING_CLAIMED", source: "SYSTEM", occurredAt: now,
    });
    const updated = { ...session, greetingStatus: "CLAIMED" as const, updatedAt: now };
    return { shouldPlay: true as const, session: present(updated, medication, patient.displayName, null, patient.isSynthetic ?? false) };
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

async function recordedSupplySummary(ctx: MutationCtx, occurrence: Doc<"doseOccurrences">, now: number) {
  const device = await ctx.db.query("devices").withIndex("by_patient", (q) => q.eq("patientId", occurrence.patientId)).unique();
  const assignments = await ctx.db.query("compartmentAssignments").withIndex("by_medication", (q) => q.eq("medicationId", occurrence.medicationId)).take(10);
  const assignment = assignments.find((row) => row.active && row.patientId === occurrence.patientId && row.deviceId === device?._id);
  const schedules = (await ctx.db.query("medicationSchedules").withIndex("by_medication", (q) => q.eq("medicationId", occurrence.medicationId)).take(32))
    .filter((row) => row.active && row.patientId === occurrence.patientId);
  const count = assignment?.estimatedSupplyCount ?? null;
  const forecast = buildSupplyForecast({ now, supplyCount: count, source: assignment?.supplyEstimateSource ?? null, schedules });
  if (count === null || forecast.estimatedRunOutAt === null) return "I don’t have enough saved inventory and schedule information to estimate when your supply will run out. Your caregiver can update those records. A prescription end date should be confirmed with your prescriber.";
  if (count === 0) return "Your recorded supply estimate is zero. Ask your caregiver to check the remaining supply. That does not tell me when your prescription should end.";
  const date = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: schedules[0]?.timezone ?? "UTC" }).format(forecast.estimatedRunOutAt);
  return `Your recorded supply estimate is ${count} pills. Based on your saved schedule, that supply may run out around ${date}. This is an inventory estimate, not a prescription end date.`;
}

export const respond = mutation({
  args: { occurrenceId: v.id("doseOccurrences"), intent: intentValidator, source: sourceValidator },
  handler: async (ctx, args) => {
    const now = Date.now();
    const { session, medication, occurrence, patient } = await ensureSession(ctx, args.occurrenceId, now);
    const education = educationForMedication(medication);
    // Conversation education must not depend on the hardware-enabling env flag.
    // Hardware authorization below still requires the configured development mode.
    const ironDemoEducation = patient.isSynthetic && education?.code === "MEDLINEPLUS_IRON";
    const educationOffer = `Before we continue, would you like to hear about possible side effects of ${medication.name}?`;
    const questionsPrompt = "Any questions?";
    const dispensePrompt = "Are you ready to dispense your medication?";
    let next = session.state;
    let response: string;
    let eventType: Doc<"medicationInteractionEvents">["type"] = "PATIENT_INTENT";
    // A failed client preflight can leave the session ready without ever
    // authorizing a hardware command. A repeated voice readiness response may
    // resume only that exact unattempted state. Once any command/attempt exists,
    // duplicate speech remains ineligible and can never create another MOVE.
    const resumableUnattemptedVoiceReadiness =
      args.source === "VOICE" &&
      (args.intent === "READY" || args.intent === "YES") &&
      session.state === "READY_FOR_SUPERVISED_ROUTINE" &&
      session.hardwareReadinessSource === "VOICE" &&
      occurrence.attemptStatus === "NONE" &&
      !occurrence.commandId;

    // Recover old, unattempted demo sessions that the previous READY shortcut
    // advanced without offering education. Never rewind an attempted operation.
    const history = ironDemoEducation && ["AWAITING_CONTINUE", "READY_FOR_SUPERVISED_ROUTINE"].includes(session.state)
      ? await ctx.db.query("medicationInteractionEvents")
        .withIndex("by_session_and_occurredAt", (q) => q.eq("sessionId", session._id)).take(100)
      : [];
    const recoverSkippedEducation = ironDemoEducation &&
      ["AWAITING_CONTINUE", "READY_FOR_SUPERVISED_ROUTINE"].includes(session.state) &&
      occurrence.attemptStatus === "NONE" && !occurrence.commandId &&
      !history.some((event) => event.type === "EDUCATION_PRESENTED" || event.intent === "NO");

    if ((args.intent === "READY" || args.intent === "YES") && recoverSkippedEducation) {
      next = "AWAITING_EDUCATION_CHOICE";
      response = educationOffer;
    } else if (args.intent === "READY") {
      if (session.state === "AWAITING_READINESS" && ironDemoEducation) {
        next = "AWAITING_EDUCATION_CHOICE";
        response = educationOffer;
      } else if (session.state === "AWAITING_EDUCATION_CHOICE" && education) {
        next = "AWAITING_SUPPLY_CHOICE";
        eventType = "EDUCATION_PRESENTED";
        response = `${education.spokenSummary} ${questionsPrompt}`;
      } else if (session.state === "AWAITING_SUPPLY_CHOICE") {
        next = "AWAITING_CONTINUE";
        response = dispensePrompt;
      } else if (["AWAITING_READINESS", "AWAITING_EDUCATION_CHOICE", "AWAITING_CONTINUE"].includes(session.state)) {
        next = "READY_FOR_SUPERVISED_ROUTINE";
        eventType = "ROUTINE_READY";
        response = "Okay. I am preparing the armed demo dispenser now.";
      } else if (session.state === "READY_FOR_SUPERVISED_ROUTINE") {
        response = resumableUnattemptedVoiceReadiness
          ? "The routine is ready. I am resuming the armed demo dispenser preparation now."
          : "The routine is already ready. I will not create another movement command.";
      } else {
        response = "This medication session already has a terminal or in-progress hardware state. No new movement command was created.";
      }
    } else if (args.intent === "REPEAT") {
      response = session.state === "AWAITING_CONTINUE"
        ? dispensePrompt
        : session.state === "AWAITING_EDUCATION_CHOICE" ? educationOffer
          : session.state === "AWAITING_SUPPLY_CHOICE" ? questionsPrompt : "Please answer yes or no to the current question.";
    } else if (args.intent === "REQUEST_SUPPLY_INFORMATION") {
      const canContinue = ["AWAITING_READINESS", "AWAITING_EDUCATION_CHOICE", "AWAITING_SUPPLY_CHOICE", "AWAITING_CONTINUE"].includes(session.state);
      response = `${await recordedSupplySummary(ctx, occurrence, now)}${canContinue ? ` ${dispensePrompt}` : ""}`;
      if (canContinue) next = "AWAITING_CONTINUE";
    } else if (args.intent === "REQUEST_MORE_INFORMATION") {
      const canContinue = ["AWAITING_READINESS", "AWAITING_EDUCATION_CHOICE", "AWAITING_SUPPLY_CHOICE", "AWAITING_CONTINUE"].includes(session.state);
      response = education
        ? `${education.spokenSummary}${canContinue ? ` ${questionsPrompt}` : ""}`
        : `I do not have reviewed medication education for ${medication.name}. Your caregiver-approved instruction is: ${medication.instructions || "No additional instruction is recorded"}.`;
      if (education && canContinue) {
        next = "AWAITING_SUPPLY_CHOICE";
        eventType = "EDUCATION_PRESENTED";
      }
    } else if (args.intent === "NO") {
      if (session.state === "AWAITING_EDUCATION_CHOICE" || session.state === "AWAITING_SUPPLY_CHOICE") {
        next = "AWAITING_CONTINUE";
        response = dispensePrompt;
      } else if (["AWAITING_READINESS", "AWAITING_CONTINUE"].includes(session.state)) {
        next = "DECLINED";
        eventType = "SESSION_DECLINED";
        response = "Okay. We can pause here.";
      } else {
        response = "Okay. Your existing routine status is unchanged.";
      }
    } else if (session.state === "AWAITING_READINESS") {
      if ((session.firstInteraction || ironDemoEducation) && education) {
        next = "AWAITING_EDUCATION_CHOICE";
        response = educationOffer;
      } else {
        next = "READY_FOR_SUPERVISED_ROUTINE";
        eventType = "ROUTINE_READY";
        response = "Okay. I am preparing the armed demo dispenser now.";
      }
    } else if (session.state === "AWAITING_EDUCATION_CHOICE") {
      if (!education) {
        next = "READY_FOR_SUPERVISED_ROUTINE";
        eventType = "ROUTINE_READY";
        response = `I do not have reviewed medication education for ${medication.name}. Your recorded instruction is: ${medication.instructions || "No additional instruction is recorded"}. I will continue only if the supervised demo hardware was armed first.`;
      } else {
        next = "AWAITING_SUPPLY_CHOICE";
        eventType = "EDUCATION_PRESENTED";
        response = `${education.spokenSummary} ${questionsPrompt}`;
      }
    } else if (session.state === "AWAITING_SUPPLY_CHOICE") {
      // Legacy state name: this is now the open question turn after education.
      // "Yes" means the user has a question, not that they approved movement.
      response = "What would you like to know?";
    } else if (session.state === "AWAITING_CONTINUE") {
      next = "READY_FOR_SUPERVISED_ROUTINE";
      eventType = "ROUTINE_READY";
      response = "Okay. I am preparing the armed demo dispenser now.";
    } else if (session.state === "READY_FOR_SUPERVISED_ROUTINE") {
      response = resumableUnattemptedVoiceReadiness
        ? "The routine is ready. I am resuming the armed demo dispenser preparation now."
        : "The routine is already ready. I will not create another movement command.";
    } else {
      response = "This medication session is already closed. No hardware command was issued.";
    }

    const voiceHardwareReady =
      (eventType === "ROUTINE_READY" && args.source === "VOICE") ||
      (resumableUnattemptedVoiceReadiness && !recoverSkippedEducation);
    await ctx.db.patch("medicationInteractionSessions", session._id, {
      state: next,
      updatedAt: now,
      ...(voiceHardwareReady ? { hardwareReadinessSource: "VOICE" as const } : {}),
    });
    await ctx.db.insert("medicationInteractionEvents", {
      sessionId: session._id, occurrenceId: session.occurrenceId, patientId: session.patientId,
      type: eventType, intent: args.intent, detailCode: education?.code, source: args.source, occurredAt: now,
    });
    return {
      state: next,
      response,
      hardwareDispatchEligible: voiceHardwareReady,
      educationSourceUrl: eventType === "EDUCATION_PRESENTED" ? education?.sourceUrl ?? null : null,
    };
  },
});

function voiceOperationId(sessionId: string) {
  const compact = sessionId.replace(/[^A-Za-z0-9]/g, "").slice(-10).toUpperCase();
  if (!compact) throw new ConvexError("Unable to create a hardware operation ID");
  return `VH${compact}`.slice(0, 12);
}

export const prepareHardwareDispatch = mutation({
  args: {
    occurrenceId: v.id("doseOccurrences"),
    connectionId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (env.PILLSENSE_DEMO_ENVIRONMENT !== "development") {
      throw new ConvexError("Voice hardware demo mode is disabled outside development");
    }
    const { session, occurrence, medication, patient } = await ensureSession(ctx, args.occurrenceId, now);
    if (!patient.isSynthetic) throw new ConvexError("Voice hardware demo is limited to the synthetic patient");
    if (session.hardwareReadinessSource !== "VOICE") {
      throw new ConvexError("A structured voice readiness response is required");
    }

    const existing = await ctx.db
      .query("dispenseCommands")
      .withIndex("by_occurrence", (q) => q.eq("occurrenceId", occurrence._id))
      .unique();
    if (existing) {
      return {
        commandId: existing.commandId,
        operationId: existing.operationId ?? existing.commandId,
        slot: existing.slot,
        shouldDispatch: false as const,
        status: existing.status,
      };
    }
    if (session.state !== "READY_FOR_SUPERVISED_ROUTINE") {
      throw new ConvexError("The medication session is not ready for hardware preparation");
    }
    if (occurrence.attemptStatus !== "NONE" || occurrence.commandId) {
      throw new ConvexError("This occurrence has already been attempted");
    }
    if (now < occurrence.eligibleFrom || now > occurrence.expiresAt) {
      throw new ConvexError("This reminder is not currently eligible for the demo movement");
    }

    const [schedule, arm] = await Promise.all([
      ctx.db.get("medicationSchedules", occurrence.scheduleId),
      ctx.db
        .query("hardwareDemoArms")
        .withIndex("by_patient_and_status", (q) =>
          q.eq("patientId", occurrence.patientId).eq("status", "ARMED"),
        )
        .order("desc")
        .first(),
    ]);
    if (!schedule?.active || schedule.medicationId !== medication._id || (schedule.revision ?? 1) !== occurrence.scheduleRevision) {
      throw new ConvexError("This reminder no longer matches the active medication schedule");
    }
    if (!arm || arm.expiresAt <= now) throw new ConvexError("The supervised voice hardware demo is not armed");
    if (arm.connectionId !== args.connectionId) {
      throw new ConvexError("The armed Bluetooth connection is no longer active");
    }

    const assignments = await ctx.db
      .query("compartmentAssignments")
      .withIndex("by_medication", (q) => q.eq("medicationId", occurrence.medicationId))
      .take(10);
    const assignment = assignments.find((candidate) =>
      candidate.active &&
      candidate.patientId === occurrence.patientId &&
      candidate.deviceId === arm.deviceId,
    );
    if (!assignment) throw new ConvexError("No active assignment exists on the armed device");
    if (assignment.slot !== arm.expectedSlot || assignment.slot !== 6) {
      throw new ConvexError("The verified firmware supports only the armed Slot 6 demo");
    }
    // This supervised positioning demo uses operator-confirmed empty/inert
    // hardware. Synthetic inventory is UI/mock data, not physical load evidence
    // or a prerequisite for movement; this path never decrements it.

    const operationId = voiceOperationId(String(session._id));
    const duplicate = await ctx.db
      .query("dispenseCommands")
      .withIndex("by_commandId", (q) => q.eq("commandId", operationId))
      .unique();
    if (duplicate) throw new ConvexError("Duplicate voice hardware operation ID");

    await ctx.db.insert("dispenseCommands", {
      commandId: operationId,
      operationId,
      occurrenceId: occurrence._id,
      patientId: occurrence.patientId,
      medicationId: occurrence.medicationId,
      scheduleId: occurrence.scheduleId,
      deviceId: arm.deviceId,
      assignmentId: assignment._id,
      demoArmId: arm._id,
      source: "VOICE_BLE_DEMO",
      slot: 6,
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
      commandId: operationId,
    });
    await ctx.db.patch("medicationInteractionSessions", session._id, {
      state: "PREPARING_DISPENSER",
      hardwareCommandId: operationId,
      updatedAt: now,
    });
    await ctx.db.insert("medicationInteractionEvents", {
      sessionId: session._id,
      occurrenceId: occurrence._id,
      patientId: occurrence.patientId,
      type: "HARDWARE_PREPARED",
      source: "SYSTEM",
      occurredAt: now,
    });
    return { commandId: operationId, operationId, slot: 6, shouldDispatch: true as const, status: "AUTHORIZED" as const };
  },
});

export const markHardwareDispatched = mutation({
  args: { commandId: v.string(), connectionId: v.string() },
  handler: async (ctx, args) => {
    const command = await ctx.db.query("dispenseCommands")
      .withIndex("by_commandId", (q) => q.eq("commandId", args.commandId)).unique();
    if (!command || command.source !== "VOICE_BLE_DEMO" || !command.demoArmId) {
      throw new ConvexError("Voice hardware command is unavailable");
    }
    await requirePatientAccess(ctx, command.patientId);
    if (command.status !== "AUTHORIZED") return { shouldSend: false as const, status: command.status };
    const arm = await ctx.db.get("hardwareDemoArms", command.demoArmId);
    const now = Date.now();
    if (!arm || arm.status !== "ARMED" || arm.expiresAt <= now || arm.connectionId !== args.connectionId) {
      throw new ConvexError("The supervised voice hardware arm is no longer valid");
    }
    await ctx.db.patch("hardwareDemoArms", arm._id, { status: "CONSUMED", consumedAt: now, updatedAt: now });
    await ctx.db.patch("dispenseCommands", command._id, { status: "DISPATCHED", updatedAt: now });
    await ctx.db.patch("doseOccurrences", command.occurrenceId, { attemptStatus: "DISPATCHED" });
    const session = await ctx.db.query("medicationInteractionSessions")
      .withIndex("by_occurrence", (q) => q.eq("occurrenceId", command.occurrenceId)).unique();
    if (session) {
      await ctx.db.patch("medicationInteractionSessions", session._id, { state: "MOVEMENT_IN_PROGRESS", updatedAt: now });
      await ctx.db.insert("medicationInteractionEvents", {
        sessionId: session._id, occurrenceId: command.occurrenceId, patientId: command.patientId,
        type: "HARDWARE_DISPATCHED", source: "SYSTEM", occurredAt: now,
      });
    }
    return { shouldSend: true as const, status: "DISPATCHED" as const };
  },
});

const browserHardwareEvent = v.union(
  v.literal("MOTOR_STARTED"),
  v.literal("MOTOR_COMPLETED"),
  v.literal("UNKNOWN"),
  v.literal("FAULT"),
  v.literal("DISCONNECTED"),
);

export const recordHardwareEvent = mutation({
  args: { commandId: v.string(), operationId: v.string(), type: browserHardwareEvent, occurredAt: v.number() },
  handler: async (ctx, args) => {
    const command = await ctx.db.query("dispenseCommands")
      .withIndex("by_commandId", (q) => q.eq("commandId", args.commandId)).unique();
    if (!command || command.source !== "VOICE_BLE_DEMO" || command.operationId !== args.operationId) {
      throw new ConvexError("The browser BLE result does not match this voice demo command");
    }
    await requirePatientAccess(ctx, command.patientId);
    const eventId = `voice-ble:${args.operationId}:${args.type}`;
    const duplicate = await ctx.db.query("deviceEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", eventId)).unique();
    if (duplicate) return { duplicate: true, commandStatus: command.status };

    const now = Date.now();
    await ctx.db.insert("deviceEvents", {
      eventId,
      commandId: command.commandId,
      patientId: command.patientId,
      deviceId: command.deviceId,
      type: args.type,
      source: "BROWSER_BLE_DEMO",
      trustedHardwareEvidence: false,
      occurredAt: args.occurredAt,
      receivedAt: now,
    });
    const session = await ctx.db.query("medicationInteractionSessions")
      .withIndex("by_occurrence", (q) => q.eq("occurrenceId", command.occurrenceId)).unique();

    if (args.type === "MOTOR_COMPLETED" && command.status === "DISPATCHED") {
      await ctx.db.patch("dispenseCommands", command._id, { status: "COMPLETED", motorCompletion: "COMPLETED", updatedAt: now });
      await ctx.db.patch("doseOccurrences", command.occurrenceId, { attemptStatus: "COMPLETED" });
      if (session) {
        await ctx.db.patch("medicationInteractionSessions", session._id, {
          state: session.cameraConsent ? "CAMERA_OBSERVATION_PENDING" : "AWAITING_PATIENT_REPORT",
          updatedAt: now,
        });
        await ctx.db.insert("medicationInteractionEvents", {
          sessionId: session._id, occurrenceId: command.occurrenceId, patientId: command.patientId,
          type: "HARDWARE_COMPLETED", source: "SYSTEM", occurredAt: now,
        });
      }
      return { duplicate: false, commandStatus: "COMPLETED" as const };
    }

    if (args.type === "MOTOR_STARTED" && command.status === "DISPATCHED") {
      if (session) {
        await ctx.db.patch("medicationInteractionSessions", session._id, { state: "MOVEMENT_IN_PROGRESS", updatedAt: now });
        await ctx.db.insert("medicationInteractionEvents", {
          sessionId: session._id, occurrenceId: command.occurrenceId, patientId: command.patientId,
          type: "HARDWARE_STARTED", source: "SYSTEM", occurredAt: now,
        });
      }
      return { duplicate: false, commandStatus: "DISPATCHED" as const };
    }

    if (command.status !== "COMPLETED" && command.status !== "UNKNOWN") {
      await ctx.db.patch("dispenseCommands", command._id, { status: "UNKNOWN", motorCompletion: "UNKNOWN", updatedAt: now });
      await ctx.db.patch("doseOccurrences", command.occurrenceId, { attemptStatus: "UNKNOWN" });
      if (session) {
        await ctx.db.patch("medicationInteractionSessions", session._id, { state: "HARDWARE_UNKNOWN", updatedAt: now });
        await ctx.db.insert("medicationInteractionEvents", {
          sessionId: session._id, occurrenceId: command.occurrenceId, patientId: command.patientId,
          type: "HARDWARE_UNKNOWN", source: "SYSTEM", occurredAt: now,
        });
      }
    }
    return { duplicate: false, commandStatus: "UNKNOWN" as const };
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
