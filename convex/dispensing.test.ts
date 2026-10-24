/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const medication = {
  name: "Iron Pills",
  instructions: "Synthetic demo only",
  slot: 6,
  localTime: "09:00",
  weekdays: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as (
    | "SUN" | "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT"
  )[],
  timezone: "America/Toronto",
  demoInventory: 1,
};

async function setupDose(tokenIdentifier: string) {
  const root = convexTest(schema, modules);
  const actor = root.withIdentity({ tokenIdentifier, name: "Demo Caregiver" });
  await actor.mutation(api.demo.ensureCareTeam, {});
  const setup = await actor.query(api.caregiver.setup, {});
  if (setup.status !== "ready") throw new Error("Care team was not ready");
  await actor.mutation(api.medications.createWithAssignment, {
    ...medication,
    patientId: setup.patient.id,
  });
  const occurrenceId = await actor.mutation(api.occurrences.createDemoDue, {});
  return { root, actor, patientId: setup.patient.id, occurrenceId, tokenIdentifier };
}

async function readyDevice(actor: Awaited<ReturnType<typeof setupDose>>["actor"]) {
  await actor.mutation(api.device.connectMock, {});
  await actor.mutation(api.device.confirmMockHome, {});
}

async function authorizeAndDispatch(
  actor: Awaited<ReturnType<typeof setupDose>>["actor"],
  occurrenceId: Awaited<ReturnType<typeof setupDose>>["occurrenceId"],
) {
  const command = await actor.mutation(api.dispensing.authorize, { occurrenceId });
  await actor.mutation(api.dispensing.markDispatched, { commandId: command.commandId });
  return command;
}

describe("M2 dispense authorization", () => {
  it("denies another caregiver from issuing or observing a patient's dispense", async () => {
    const { root, actor, occurrenceId } = await setupDose("issuer|owner");
    await readyDevice(actor);
    const other = root.withIdentity({ tokenIdentifier: "issuer|other" });
    await other.mutation(api.demo.ensureCareTeam, {});

    await expect(
      other.mutation(api.dispensing.authorize, { occurrenceId }),
    ).rejects.toThrow("Patient access denied");
    const otherActivity = await other.query(api.activity.latestForCaregiver, {});
    expect(otherActivity.status).toBe("ready");
    expect(otherActivity.activity).toEqual([]);
  });

  it("rejects non-due and stale occurrences", async () => {
    const first = await setupDose("issuer|not-due");
    await readyDevice(first.actor);
    await first.root.run(async (ctx) => {
      await ctx.db.patch("doseOccurrences", first.occurrenceId, {
        eligibleFrom: Date.now() + 60_000,
      });
    });
    await expect(
      first.actor.mutation(api.dispensing.authorize, { occurrenceId: first.occurrenceId }),
    ).rejects.toThrow("not due yet");

    const second = await setupDose("issuer|stale");
    await readyDevice(second.actor);
    await second.root.run(async (ctx) => {
      const occurrence = await ctx.db.get("doseOccurrences", second.occurrenceId);
      if (!occurrence) throw new Error("Occurrence missing");
      await ctx.db.patch("medicationSchedules", occurrence.scheduleId, { active: false });
    });
    await expect(
      second.actor.mutation(api.dispensing.authorize, { occurrenceId: second.occurrenceId }),
    ).rejects.toThrow("inactive medication schedule");
  });

  it("blocks an uncalibrated or faulted mock device", async () => {
    const uncalibrated = await setupDose("issuer|uncalibrated");
    await uncalibrated.actor.mutation(api.device.connectMock, {});
    await expect(
      uncalibrated.actor.mutation(api.dispensing.authorize, {
        occurrenceId: uncalibrated.occurrenceId,
      }),
    ).rejects.toThrow("connected, calibrated, and ready");

    const faulted = await setupDose("issuer|faulted");
    await readyDevice(faulted.actor);
    await faulted.actor.mutation(api.device.setDemoCondition, { condition: "FAULT" });
    await expect(
      faulted.actor.mutation(api.dispensing.authorize, {
        occurrenceId: faulted.occurrenceId,
      }),
    ).rejects.toThrow("connected, calibrated, and ready");
  });

  it("blocks dispensing when demo inventory is empty", async () => {
    const data = await setupDose("issuer|empty");
    await readyDevice(data.actor);
    await data.root.run(async (ctx) => {
      const assignments = await ctx.db.query("compartmentAssignments").take(10);
      const assignment = assignments.find((row) => row.patientId === data.patientId);
      if (!assignment) throw new Error("Assignment missing");
      await ctx.db.patch("compartmentAssignments", assignment._id, { demoInventory: 0 });
    });
    await expect(
      data.actor.mutation(api.dispensing.authorize, { occurrenceId: data.occurrenceId }),
    ).rejects.toThrow("no demo pill loaded");
  });
});

describe("M2 persistent results", () => {
  it("deduplicates MOTOR_COMPLETED and deducts inventory exactly once", async () => {
    const data = await setupDose("issuer|complete");
    await readyDevice(data.actor);
    const command = await authorizeAndDispatch(data.actor, data.occurrenceId);
    const event = {
      eventId: `${command.commandId}:MOTOR_COMPLETED`,
      commandId: command.commandId,
      type: "MOTOR_COMPLETED" as const,
      occurredAt: Date.now(),
    };
    await expect(data.actor.mutation(api.dispensing.ingestMockEvent, event)).resolves.toMatchObject({
      duplicate: false,
      commandStatus: "COMPLETED",
    });
    await expect(data.actor.mutation(api.dispensing.ingestMockEvent, event)).resolves.toMatchObject({
      duplicate: true,
      commandStatus: "COMPLETED",
    });
    const activity = await data.actor.query(api.activity.latestForCaregiver, {});
    expect(activity.status).toBe("ready");
    expect(activity.activity[0]).toMatchObject({
      status: "COMPLETED",
      motorCompletion: "COMPLETED",
      demoInventory: 0,
      pillRelease: "UNKNOWN",
      pillCollection: "UNKNOWN",
    });
  });

  it("preserves UNKNOWN and blocks automatic retry", async () => {
    const data = await setupDose("issuer|unknown");
    await readyDevice(data.actor);
    const command = await authorizeAndDispatch(data.actor, data.occurrenceId);
    await data.actor.mutation(api.dispensing.ingestMockEvent, {
      eventId: `${command.commandId}:UNKNOWN`,
      commandId: command.commandId,
      type: "UNKNOWN",
      occurredAt: Date.now(),
    });
    await expect(
      data.actor.mutation(api.dispensing.authorize, { occurrenceId: data.occurrenceId }),
    ).rejects.toThrow("already been attempted");
    const activity = await data.actor.query(api.activity.latestForCaregiver, {});
    expect(activity.status).toBe("ready");
    expect(activity.activity[0]).toMatchObject({
      status: "UNKNOWN",
      motorCompletion: "UNKNOWN",
      demoInventory: 1,
      requiresReview: true,
    });
  });

  it("keeps motor evidence unchanged when Taken or Not Taken is reported", async () => {
    const data = await setupDose("issuer|report");
    await readyDevice(data.actor);
    const command = await authorizeAndDispatch(data.actor, data.occurrenceId);
    await data.actor.mutation(api.dispensing.ingestMockEvent, {
      eventId: `${command.commandId}:MOTOR_COMPLETED`,
      commandId: command.commandId,
      type: "MOTOR_COMPLETED",
      occurredAt: Date.now(),
    });
    await data.actor.mutation(api.dispensing.reportIngestion, {
      occurrenceId: data.occurrenceId,
      report: "NOT_TAKEN",
    });
    const activity = await data.actor.query(api.activity.latestForCaregiver, {});
    expect(activity.status).toBe("ready");
    expect(activity.activity[0]).toMatchObject({
      motorCompletion: "COMPLETED",
      ingestionReport: "NOT_TAKEN",
    });
  });

  it("deduplicates a repeated patient ingestion report", async () => {
    const data = await setupDose("issuer|repeat-report");
    const first = await data.actor.mutation(api.dispensing.reportIngestion, { occurrenceId: data.occurrenceId, report: "TAKEN" });
    const second = await data.actor.mutation(api.dispensing.reportIngestion, { occurrenceId: data.occurrenceId, report: "TAKEN" });
    expect(first).toMatchObject({ duplicate: false });
    expect(second).toMatchObject({ duplicate: true });
  });

  it("retains the attempted command across a simulated browser refresh", async () => {
    const data = await setupDose("issuer|refresh");
    await readyDevice(data.actor);
    const command = await authorizeAndDispatch(data.actor, data.occurrenceId);
    const refreshedClient = data.root.withIdentity({ tokenIdentifier: data.tokenIdentifier });
    const activity = await refreshedClient.query(api.activity.latestForCaregiver, {});
    expect(activity.status).toBe("ready");
    expect(activity.activity[0]?.commandId).toBe(command.commandId);
    await expect(
      refreshedClient.mutation(api.dispensing.authorize, {
        occurrenceId: data.occurrenceId,
      }),
    ).rejects.toThrow("already been attempted");
  });

  it("creates a stable demo occurrence idempotently within its time bucket", async () => {
    const data = await setupDose("issuer|occurrence-idempotency");
    const again = await data.actor.mutation(api.occurrences.createDemoDue, {});
    expect(again).toBe(data.occurrenceId);
  });

  it("generates the next seven days of scheduled occurrences idempotently", async () => {
    const data = await setupDose("issuer|scheduled-generation");
    const first = await data.actor.mutation(api.occurrences.generateUpcoming, {});
    const second = await data.actor.mutation(api.occurrences.generateUpcoming, {});
    expect(first.created).toBeGreaterThan(0);
    expect(second.created).toBe(0);
    const keys = await data.root.run(async (ctx) => {
      const rows = await ctx.db.query("doseOccurrences").take(20);
      return rows.map((row) => row.occurrenceKey);
    });
    expect(new Set(keys).size).toBe(keys.length);
  });
});
