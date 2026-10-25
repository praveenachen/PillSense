import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { resolveDashboardPatient } from "./lib/authorization";

export const latestForCaregiver = query({
  args: {},
  handler: async (ctx) => {
    const { viewer, patient } = await resolveDashboardPatient(ctx);
    if (viewer.role !== "caregiver") return { status: "unauthorized" as const, activity: [] };
    const commands = await ctx.db
      .query("dispenseCommands")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .order("desc")
      .take(20);
    const activity = await Promise.all(
      commands.map(async (command) => {
        const [medication, occurrence, assignment] = await Promise.all([
          ctx.db.get("medications", command.medicationId),
          ctx.db.get("doseOccurrences", command.occurrenceId),
          ctx.db.get("compartmentAssignments", command.assignmentId),
        ]);
        if (!medication || !occurrence || !assignment) return null;
        return {
          commandId: command.commandId,
          medicationName: medication.name,
          slot: command.slot,
          status: command.status,
          motorCompletion: command.motorCompletion,
          pillRelease: command.pillRelease,
          pillCollection: command.pillCollection,
          ingestionReport: occurrence.ingestionReport,
          demoInventory: assignment.demoInventory,
          updatedAt: command.updatedAt,
          requiresReview: command.status === "UNKNOWN",
        };
      }),
    );
    return {
      status: "ready" as const,
      patientName: patient.displayName,
      activity: activity.filter((row) => row !== null),
    };
  },
});

/** A bounded, authorization-scoped view over real persisted evidence records. */
export const careJourney = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const { patient } = await resolveDashboardPatient(ctx);
    const since = args.now - 14 * 24 * 60 * 60 * 1000;
    const [medications, reminderEvents, interactionEvents, cameraEvents, careCases, refillCases, agentRuns] = await Promise.all([
      ctx.db.query("medications").withIndex("by_patient", (q) => q.eq("patientId", patient._id)).order("desc").take(20),
      ctx.db.query("reminderEvents").withIndex("by_patient_and_effectiveAt", (q) => q.eq("patientId", patient._id).gte("effectiveAt", since)).order("desc").take(30),
      ctx.db.query("medicationInteractionEvents").withIndex("by_patient_and_occurredAt", (q) => q.eq("patientId", patient._id).gte("occurredAt", since)).order("desc").take(30),
      ctx.db.query("cameraObservationEvents").withIndex("by_patient_and_occurredAt", (q) => q.eq("patientId", patient._id).gte("occurredAt", since)).order("desc").take(30),
      Promise.all(["OPEN", "ACKNOWLEDGED", "RESOLVED"].map((status) => ctx.db.query("careCases").withIndex("by_patient_and_status", (q) => q.eq("patientId", patient._id).eq("status", status as "OPEN" | "ACKNOWLEDGED" | "RESOLVED")).order("desc").take(10))).then((groups) => groups.flat()),
      Promise.all(["OPEN", "REVIEWED", "REFILL_REQUESTED", "REFILL_RECEIVED", "CLOSED"].map((status) => ctx.db.query("refillCases").withIndex("by_patient_and_status", (q) => q.eq("patientId", patient._id).eq("status", status as "OPEN" | "REVIEWED" | "REFILL_REQUESTED" | "REFILL_RECEIVED" | "CLOSED")).order("desc").take(8))).then((groups) => groups.flat()),
      ctx.db.query("agentRuns").withIndex("by_patient_and_createdAt", (q) => q.eq("patientId", patient._id).gte("createdAt", since)).order("desc").take(20),
    ]);
    const medicationNames = new Map(medications.map((medication) => [medication._id, medication.name]));
    const occurrenceCache = new Map<string, Doc<"doseOccurrences"> | null>();
    async function occurrence(id: (typeof reminderEvents)[number]["occurrenceId"]) {
      const key = String(id);
      if (!occurrenceCache.has(key)) occurrenceCache.set(key, await ctx.db.get("doseOccurrences", id));
      return occurrenceCache.get(key) ?? null;
    }
    type Item = { id: string; at: number; title: string; detail: string; source: "REAL" | "SYNTHETIC"; evidence: string };
    const items: Item[] = medications.map((medication) => ({
      id: `medication:${medication._id}`, at: medication.createdAt,
      title: "Medication setup saved", detail: medication.name,
      source: medication.demoSeedKey ? "SYNTHETIC" : "REAL", evidence: `medication:${medication._id}`,
    }));
    for (const event of reminderEvents) {
      const dose = await occurrence(event.occurrenceId);
      items.push({ id: `reminder:${event._id}`, at: event.recordedAt, title: `Reminder ${event.state.toLowerCase()}`,
        detail: dose ? medicationNames.get(dose.medicationId) ?? "Medication" : "Medication",
        source: event.source === "DEMO_SIMULATION" ? "SYNTHETIC" : "REAL", evidence: `reminderEvent:${event._id}` });
    }
    for (const event of interactionEvents) {
      const dose = await occurrence(event.occurrenceId);
      items.push({ id: `interaction:${event._id}`, at: event.occurredAt,
        title: event.type.replaceAll("_", " ").toLocaleLowerCase().replace(/^./, (value) => value.toUpperCase()),
        detail: dose ? medicationNames.get(dose.medicationId) ?? "Medication session" : "Medication session",
        source: dose?.mode === "demo" ? "SYNTHETIC" : "REAL", evidence: `interactionEvent:${event._id}` });
    }
    for (const event of cameraEvents) items.push({ id: `camera:${event._id}`, at: event.receivedAt,
      title: event.type.replaceAll("_", " ").toLocaleLowerCase().replace(/^./, (value) => value.toUpperCase()),
      detail: "Local OpenCV observation; not ingestion evidence", source: "REAL", evidence: `cameraEvent:${event.eventId}` });
    for (const careCase of careCases) items.push({ id: `care:${careCase._id}`, at: careCase.updatedAt,
      title: careCase.status === "RESOLVED" ? "Care follow-up resolved" : "Caregiver follow-up active",
      detail: careCase.triggerReason.replaceAll("_", " ").toLocaleLowerCase(), source: careCase.evidenceReferences.demoScenarioRunId ? "SYNTHETIC" : "REAL", evidence: `careCase:${careCase._id}` });
    for (const refillCase of refillCases) items.push({ id: `refill:${refillCase._id}`, at: refillCase.updatedAt,
      title: `Refill case ${refillCase.status.toLocaleLowerCase().replaceAll("_", " ")}`,
      detail: medicationNames.get(refillCase.medicationId) ?? "Medication", source: refillCase.supplyEstimateSource === "SYNTHETIC_DEMO" ? "SYNTHETIC" : "REAL", evidence: `refillCase:${refillCase._id}` });
    for (const run of agentRuns) items.push({ id: `agent:${run._id}`, at: run.updatedAt,
      title: `Care investigation ${run.status.toLocaleLowerCase()}`,
      detail: run.provider === "DETERMINISTIC_FALLBACK" ? "NON_LLM_FALLBACK" : run.provider ?? "Coordinator queued",
      source: patient.isSynthetic ? "SYNTHETIC" : "REAL", evidence: `agentRun:${run._id}` });
    return { patientName: patient.displayName, events: items.sort((a, b) => b.at - a.at).slice(0, 50) };
  },
});
