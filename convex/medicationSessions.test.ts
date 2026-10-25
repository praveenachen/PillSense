/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function dueDose(tokenIdentifier: string, medicationName = "Advil 200 mg") {
  vi.stubEnv("PILLSENSE_DEMO_ENVIRONMENT", "development");
  vi.stubEnv("PILLSENSE_DEMO_OPERATOR_TOKEN_IDENTIFIER", tokenIdentifier);
  const root = convexTest(schema, modules);
  const caregiver = root.withIdentity({ tokenIdentifier, name: "Demo Caregiver" });
  await caregiver.mutation(api.demo.ensureCareTeam, {});
  const setup = await caregiver.query(api.caregiver.setup, {});
  if (setup.status !== "ready") throw new Error("Care team unavailable");
  await caregiver.mutation(api.medications.createWithAssignment, {
    patientId: setup.patient.id,
    name: medicationName,
    instructions: "1 tablet · Follow the caregiver-approved package instructions",
    slot: 6,
    localTime: "09:00",
    weekdays: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
    timezone: "America/Toronto",
    demoInventory: 1,
  });
  const scenario = await caregiver.mutation(api.reminders.runDemoScenario, { scenario: "DUE_REMINDER" });
  return { root, caregiver, occurrenceId: scenario.occurrenceId, setup };
}

async function readyByVoice(data: Awaited<ReturnType<typeof dueDose>>) {
  await data.caregiver.mutation(api.medicationSessions.claimGreeting, { occurrenceId: data.occurrenceId });
  return await data.caregiver.mutation(api.medicationSessions.respond, { occurrenceId: data.occurrenceId, intent: "READY", source: "VOICE" });
}

async function arm(data: Awaited<ReturnType<typeof dueDose>>, connectionId = "connection-demo-1") {
  await data.caregiver.mutation(api.hardwareLab.armVoiceDemo, {
    connectionId,
    observedStatus: "READY",
    emptyOrInertConfirmed: true,
    manualHomeConfirmed: true,
    movingPartsClear: true,
  });
  return connectionId;
}

describe("H6C medication interaction sessions", () => {
  it("does not skip synthetic Iron education when the hardware demo env flag is absent", async () => {
    const data = await dueDose("issuer|iron-without-env", "Iron Pills");
    vi.stubEnv("PILLSENSE_DEMO_ENVIRONMENT", "");
    try {
      const result = await readyByVoice(data);
      expect(result).toMatchObject({ state: "AWAITING_EDUCATION_CHOICE", hardwareDispatchEligible: false });
      expect(result.response).toContain("side effects");
    } finally {
      vi.stubEnv("PILLSENSE_DEMO_ENVIRONMENT", "development");
    }
  });

  it.each(["AWAITING_CONTINUE", "READY_FOR_SUPERVISED_ROUTINE"] as const)("recovers skipped education in unattempted %s sessions without authorizing movement", async (state) => {
    const data = await dueDose(`issuer|iron-legacy-${state}`, "Iron Pills");
    const greeting = await data.caregiver.mutation(api.medicationSessions.claimGreeting, { occurrenceId: data.occurrenceId });
    await data.root.run(async (ctx) => {
      await ctx.db.patch("medicationInteractionSessions", greeting.session.id, { state, hardwareReadinessSource: "VOICE" });
    });
    const recovered = await data.caregiver.mutation(api.medicationSessions.respond, { occurrenceId: data.occurrenceId, intent: "READY", source: "VOICE" });
    expect(recovered).toMatchObject({ state: "AWAITING_EDUCATION_CHOICE", hardwareDispatchEligible: false });
    const explained = await data.caregiver.mutation(api.medicationSessions.respond, { occurrenceId: data.occurrenceId, intent: "YES", source: "VOICE" });
    expect(explained.response).toContain("Any questions?");
    expect(explained.hardwareDispatchEligible).toBe(false);
    const commands = await data.root.run((ctx) => ctx.db.query("dispenseCommands").take(10));
    expect(commands).toHaveLength(0);
  });

  it("offers sourced Iron Pills side effects before voice movement and never reopens a completed attempt", async () => {
    const data = await dueDose("issuer|iron-education-demo", "Iron Pills");
    const connectionId = await arm(data);
    const offered = await readyByVoice(data);
    expect(offered).toMatchObject({ state: "AWAITING_EDUCATION_CHOICE", hardwareDispatchEligible: false });
    expect(offered.response).toContain("side effects of Iron Pills");
    const explained = await data.caregiver.mutation(api.medicationSessions.respond, { occurrenceId: data.occurrenceId, intent: "YES", source: "VOICE" });
    expect(explained).toMatchObject({ state: "AWAITING_SUPPLY_CHOICE", hardwareDispatchEligible: false, educationSourceUrl: "https://medlineplus.gov/druginfo/meds/a682778.html" });
    expect(explained.response).toContain("constipation");
    expect(explained.response.endsWith("Any questions?")).toBe(true);
    const hasQuestion = await data.caregiver.mutation(api.medicationSessions.respond, { occurrenceId: data.occurrenceId, intent: "YES", source: "VOICE" });
    expect(hasQuestion).toMatchObject({ state: "AWAITING_SUPPLY_CHOICE", hardwareDispatchEligible: false, response: "What would you like to know?" });
    const supply = await data.caregiver.mutation(api.medicationSessions.respond, { occurrenceId: data.occurrenceId, intent: "REQUEST_SUPPLY_INFORMATION", source: "VOICE" });
    expect(supply).toMatchObject({ state: "AWAITING_CONTINUE", hardwareDispatchEligible: false });
    expect(supply.response.endsWith("Are you ready to dispense your medication?")).toBe(true);
    const ready = await data.caregiver.mutation(api.medicationSessions.respond, { occurrenceId: data.occurrenceId, intent: "READY", source: "VOICE" });
    expect(ready.hardwareDispatchEligible).toBe(true);
    const informationOnly = await data.caregiver.mutation(api.medicationSessions.respond, { occurrenceId: data.occurrenceId, intent: "REQUEST_MORE_INFORMATION", source: "VOICE" });
    expect(informationOnly.hardwareDispatchEligible).toBe(false);
    const prepared = await data.caregiver.mutation(api.medicationSessions.prepareHardwareDispatch, { occurrenceId: data.occurrenceId, connectionId });
    await data.caregiver.mutation(api.medicationSessions.markHardwareDispatched, { commandId: prepared.commandId, connectionId });
    await data.caregiver.mutation(api.medicationSessions.recordHardwareEvent, { commandId: prepared.commandId, operationId: prepared.operationId, type: "MOTOR_COMPLETED", occurredAt: Date.now() });
    const after = await data.caregiver.mutation(api.medicationSessions.respond, { occurrenceId: data.occurrenceId, intent: "REQUEST_MORE_INFORMATION", source: "VOICE" });
    expect(after).toMatchObject({ state: "AWAITING_PATIENT_REPORT", hardwareDispatchEligible: false });
    expect(after.response).not.toContain("continue");
    const duplicate = await data.caregiver.mutation(api.medicationSessions.prepareHardwareDispatch, { occurrenceId: data.occurrenceId, connectionId });
    expect(duplicate).toMatchObject({ shouldDispatch: false, status: "COMPLETED" });
  });

  it("allows declining the side-effect explanation without treating it as declining the entire reminder", async () => {
    const data = await dueDose("issuer|iron-education-decline", "Iron Pills");
    await readyByVoice(data);
    const skipped = await data.caregiver.mutation(api.medicationSessions.respond, { occurrenceId: data.occurrenceId, intent: "NO", source: "VOICE" });
    expect(skipped).toMatchObject({ state: "AWAITING_CONTINUE", hardwareDispatchEligible: false });
    const paused = await data.caregiver.mutation(api.medicationSessions.respond, { occurrenceId: data.occurrenceId, intent: "NO", source: "VOICE" });
    expect(paused).toMatchObject({ state: "DECLINED", hardwareDispatchEligible: false });
  });

  it("answers a supply question from this patient's saved inventory without dispatching or changing it", async () => {
    const data = await dueDose("issuer|supply-question", "Iron Pills");
    await readyByVoice(data);
    const assignmentId = await data.root.run(async (ctx) => {
      const assignment = await ctx.db.query("compartmentAssignments").withIndex("by_device_and_slot", (q) => q.eq("deviceId", data.setup.device.id).eq("slot", 6)).first();
      if (!assignment) throw new Error("Missing assignment");
      await ctx.db.patch("compartmentAssignments", assignment._id, { estimatedSupplyCount: 12, supplyEstimateSource: "SYNTHETIC_DEMO" });
      return assignment._id;
    });
    const response = await data.caregiver.mutation(api.medicationSessions.respond, { occurrenceId: data.occurrenceId, intent: "REQUEST_SUPPLY_INFORMATION", source: "VOICE" });
    expect(response).toMatchObject({ state: "AWAITING_CONTINUE", hardwareDispatchEligible: false });
    expect(response.response).toContain("12 pills");
    expect(response.response).toContain("supply may run out around");
    expect(response.response).toContain("not a prescription end date");
    expect(response.response.endsWith("Are you ready to dispense your medication?")).toBe(true);
    const evidence = await data.root.run(async (ctx) => ({ assignment: await ctx.db.get("compartmentAssignments", assignmentId), commands: await ctx.db.query("dispenseCommands").take(10) }));
    expect(evidence.assignment?.estimatedSupplyCount).toBe(12);
    expect(evidence.commands).toHaveLength(0);
    const other = data.root.withIdentity({ tokenIdentifier: "issuer|unrelated-supply-reader" });
    await expect(other.mutation(api.medicationSessions.respond, { occurrenceId: data.occurrenceId, intent: "REQUEST_SUPPLY_INFORMATION", source: "VOICE" })).rejects.toThrow();
  });

  it("does not invent a runout date when inventory is unknown", async () => {
    const data = await dueDose("issuer|unknown-supply", "Iron Pills");
    await readyByVoice(data);
    const response = await data.caregiver.mutation(api.medicationSessions.respond, { occurrenceId: data.occurrenceId, intent: "REQUEST_SUPPLY_INFORMATION", source: "VOICE" });
    expect(response.hardwareDispatchEligible).toBe(false);
    expect(response.response).toContain("don’t have enough saved inventory");
    expect(response.response).not.toContain("run out around");
  });

  it("claims a personalized greeting once across refreshes", async () => {
    const data = await dueDose("issuer|h6c-session");
    const first = await data.caregiver.mutation(api.medicationSessions.claimGreeting, { occurrenceId: data.occurrenceId });
    const duplicate = await data.caregiver.mutation(api.medicationSessions.claimGreeting, { occurrenceId: data.occurrenceId });
    expect(first.shouldPlay).toBe(true);
    expect(first.session.medicationName).toContain("Advil 200 mg");
    expect(duplicate.shouldPlay).toBe(false);
  });

  it("persists bounded yes, education, continue and camera-consent transitions", async () => {
    const data = await dueDose("issuer|h6c-conversation");
    await data.caregiver.mutation(api.medicationSessions.claimGreeting, { occurrenceId: data.occurrenceId });
    const educationOffer = await data.caregiver.mutation(api.medicationSessions.respond, { occurrenceId: data.occurrenceId, intent: "YES", source: "TEXT" });
    expect(educationOffer.state).toBe("AWAITING_EDUCATION_CHOICE");
    const education = await data.caregiver.mutation(api.medicationSessions.respond, { occurrenceId: data.occurrenceId, intent: "YES", source: "TEXT" });
    expect(education.state).toBe("AWAITING_SUPPLY_CHOICE");
    expect(education.response).toContain("MedlinePlus");
    await data.caregiver.mutation(api.medicationSessions.respond, { occurrenceId: data.occurrenceId, intent: "NO", source: "TEXT" });
    const ready = await data.caregiver.mutation(api.medicationSessions.respond, { occurrenceId: data.occurrenceId, intent: "YES", source: "TEXT" });
    expect(ready.state).toBe("READY_FOR_SUPERVISED_ROUTINE");
    await data.caregiver.mutation(api.medicationSessions.setCameraConsent, { occurrenceId: data.occurrenceId, consent: true });
    const persisted = await data.caregiver.query(api.medicationSessions.getForOccurrence, { occurrenceId: data.occurrenceId });
    expect(persisted).toMatchObject({ cameraConsent: true, state: "READY_FOR_SUPERVISED_ROUTINE" });
    expect(persisted?.education?.sourceUrl).toBe("https://medlineplus.gov/druginfo/meds/a682159.html");
  });

  it("supports decline without dispatching hardware or recording ingestion", async () => {
    const data = await dueDose("issuer|h6c-decline");
    await data.caregiver.mutation(api.medicationSessions.claimGreeting, { occurrenceId: data.occurrenceId });
    const result = await data.caregiver.mutation(api.medicationSessions.respond, { occurrenceId: data.occurrenceId, intent: "NO", source: "VOICE" });
    expect(result.state).toBe("DECLINED");
    const evidence = await data.root.run(async (ctx) => ({
      commands: await ctx.db.query("dispenseCommands").take(10),
      occurrence: await ctx.db.get("doseOccurrences", data.occurrenceId),
    }));
    expect(evidence.commands).toHaveLength(0);
    expect(evidence.occurrence?.ingestionReport).toBe("UNREPORTED");
  });

  it("authorizes one armed voice Slot 6 command and persists actual browser BLE outcomes", async () => {
    const data = await dueDose("issuer|voice-hardware-success");
    const connectionId = await arm(data);
    const ready = await readyByVoice(data);
    expect(ready.hardwareDispatchEligible).toBe(true);

    const prepared = await data.caregiver.mutation(api.medicationSessions.prepareHardwareDispatch, {
      occurrenceId: data.occurrenceId,
      connectionId,
    });
    expect(prepared).toMatchObject({ shouldDispatch: true, slot: 6, status: "AUTHORIZED" });
    await data.caregiver.mutation(api.medicationSessions.markHardwareDispatched, {
      commandId: prepared.commandId,
      connectionId,
    });
    await data.caregiver.mutation(api.medicationSessions.recordHardwareEvent, {
      commandId: prepared.commandId,
      operationId: prepared.operationId,
      type: "MOTOR_STARTED",
      occurredAt: 100,
    });
    await data.caregiver.mutation(api.medicationSessions.recordHardwareEvent, {
      commandId: prepared.commandId,
      operationId: prepared.operationId,
      type: "MOTOR_COMPLETED",
      occurredAt: 200,
    });

    const persisted = await data.caregiver.query(api.medicationSessions.getForOccurrence, { occurrenceId: data.occurrenceId });
    expect(persisted).toMatchObject({
      state: "AWAITING_PATIENT_REPORT",
      hardware: { operationId: prepared.operationId, status: "COMPLETED", motorCompletion: "COMPLETED", browserObserved: true },
    });
    const evidence = await data.root.run(async (ctx) => ({
      occurrence: await ctx.db.get("doseOccurrences", data.occurrenceId),
      events: await ctx.db.query("deviceEvents").withIndex("by_commandId", (q) => q.eq("commandId", prepared.commandId)).take(10),
      assignment: await ctx.db.query("compartmentAssignments").withIndex("by_device_and_slot", (q) => q.eq("deviceId", data.setup.device.id).eq("slot", 6)).order("desc").first(),
    }));
    expect(evidence.occurrence).toMatchObject({ attemptStatus: "COMPLETED", ingestionReport: "UNREPORTED" });
    expect(evidence.events.every((event) => event.source === "BROWSER_BLE_DEMO" && event.trustedHardwareEvidence === false)).toBe(true);
    expect(evidence.assignment?.demoInventory).toBe(1);

    const repeated = await data.caregiver.mutation(api.medicationSessions.prepareHardwareDispatch, {
      occurrenceId: data.occurrenceId,
      connectionId,
    });
    expect(repeated).toMatchObject({ shouldDispatch: false, status: "COMPLETED" });
  });

  it("resumes a ready voice session only when client preflight failed before any command existed", async () => {
    const data = await dueDose("issuer|voice-hardware-resume-preflight");
    const connectionId = await arm(data);
    const firstReady = await readyByVoice(data);
    expect(firstReady.hardwareDispatchEligible).toBe(true);

    const resumed = await data.caregiver.mutation(api.medicationSessions.respond, {
      occurrenceId: data.occurrenceId,
      intent: "READY",
      source: "VOICE",
    });
    expect(resumed).toMatchObject({
      state: "READY_FOR_SUPERVISED_ROUTINE",
      hardwareDispatchEligible: true,
    });
    expect(resumed.response).toContain("resuming");

    const prepared = await data.caregiver.mutation(api.medicationSessions.prepareHardwareDispatch, {
      occurrenceId: data.occurrenceId,
      connectionId,
    });
    const afterAuthorization = await data.caregiver.mutation(api.medicationSessions.respond, {
      occurrenceId: data.occurrenceId,
      intent: "READY",
      source: "VOICE",
    });
    expect(afterAuthorization.hardwareDispatchEligible).toBe(false);
    const commands = await data.root.run((ctx) => ctx.db.query("dispenseCommands")
      .withIndex("by_occurrence", (q) => q.eq("occurrenceId", data.occurrenceId)).take(2));
    expect(commands).toHaveLength(1);
    expect(commands[0]?.commandId).toBe(prepared.commandId);
  });

  it.each([0, 1])("allows an armed inert hardware demo independently of synthetic inventory %i", async (demoInventory) => {
    const data = await dueDose(`issuer|voice-inert-inventory-${demoInventory}`);
    await data.root.run(async (ctx) => {
      const assignment = await ctx.db.query("compartmentAssignments")
        .withIndex("by_device_and_slot", (q) => q.eq("deviceId", data.setup.device.id).eq("slot", 6))
        .order("desc").first();
      if (!assignment) throw new Error("Assignment unavailable");
      await ctx.db.patch("compartmentAssignments", assignment._id, { demoInventory, estimatedSupplyCount: 50 });
    });
    const connectionId = await arm(data);
    await readyByVoice(data);
    const prepared = await data.caregiver.mutation(api.medicationSessions.prepareHardwareDispatch, {
      occurrenceId: data.occurrenceId, connectionId,
    });
    expect(prepared).toMatchObject({ shouldDispatch: true, slot: 6 });
    const repeated = await data.caregiver.mutation(api.medicationSessions.prepareHardwareDispatch, {
      occurrenceId: data.occurrenceId, connectionId,
    });
    expect(repeated.shouldDispatch).toBe(false);
    const assignment = await data.root.run((ctx) => ctx.db.query("compartmentAssignments")
      .withIndex("by_device_and_slot", (q) => q.eq("deviceId", data.setup.device.id).eq("slot", 6))
      .order("desc").first());
    expect(assignment).toMatchObject({ demoInventory, estimatedSupplyCount: 50 });
  });

  it("rejects unarmed, unauthorized, and wrong-slot voice hardware preparation", async () => {
    const data = await dueDose("issuer|voice-hardware-blocked");
    await readyByVoice(data);
    await expect(data.caregiver.mutation(api.medicationSessions.prepareHardwareDispatch, {
      occurrenceId: data.occurrenceId,
      connectionId: "connection-demo-1",
    })).rejects.toThrow("not armed");

    const other = data.root.withIdentity({ tokenIdentifier: "issuer|not-configured-operator" });
    await expect(other.mutation(api.hardwareLab.armVoiceDemo, {
      connectionId: "connection-other-1",
      observedStatus: "READY",
      emptyOrInertConfirmed: true,
      manualHomeConfirmed: true,
      movingPartsClear: true,
    })).rejects.toThrow("not configured");

    const connectionId = await arm(data);
    await data.root.run(async (ctx) => {
      const assignment = await ctx.db.query("compartmentAssignments")
        .withIndex("by_device_and_slot", (q) => q.eq("deviceId", data.setup.device.id).eq("slot", 6))
        .order("desc").first();
      if (!assignment) throw new Error("Assignment unavailable");
      await ctx.db.patch("compartmentAssignments", assignment._id, { slot: 4 });
    });
    await expect(data.caregiver.mutation(api.medicationSessions.prepareHardwareDispatch, {
      occurrenceId: data.occurrenceId,
      connectionId,
    })).rejects.toThrow("only the armed Slot 6 demo");
  });

  it("survives refresh during movement without authorizing a repeat command", async () => {
    const data = await dueDose("issuer|voice-hardware-refresh");
    const connectionId = await arm(data);
    await readyByVoice(data);
    const prepared = await data.caregiver.mutation(api.medicationSessions.prepareHardwareDispatch, {
      occurrenceId: data.occurrenceId,
      connectionId,
    });
    await data.caregiver.mutation(api.medicationSessions.markHardwareDispatched, {
      commandId: prepared.commandId,
      connectionId,
    });

    const refreshed = await data.caregiver.query(api.medicationSessions.getForOccurrence, { occurrenceId: data.occurrenceId });
    expect(refreshed).toMatchObject({ state: "MOVEMENT_IN_PROGRESS", hardware: { status: "DISPATCHED" } });
    const duplicateVoice = await data.caregiver.mutation(api.medicationSessions.respond, {
      occurrenceId: data.occurrenceId,
      intent: "YES",
      source: "VOICE",
    });
    expect(duplicateVoice.hardwareDispatchEligible).toBe(false);
    const repeated = await data.caregiver.mutation(api.medicationSessions.prepareHardwareDispatch, {
      occurrenceId: data.occurrenceId,
      connectionId,
    });
    expect(repeated).toMatchObject({ shouldDispatch: false, status: "DISPATCHED" });
    const commands = await data.root.run((ctx) => ctx.db.query("dispenseCommands").withIndex("by_occurrence", (q) => q.eq("occurrenceId", data.occurrenceId)).take(2));
    expect(commands).toHaveLength(1);
  });
});
