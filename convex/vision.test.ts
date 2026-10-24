/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const source = "WINDOWS_OPENCV_MEDIAPIPE" as const;

async function setup(token = "issuer|vision-owner") {
  const root = convexTest(schema, modules);
  const actor = root.withIdentity({ tokenIdentifier: token, name: "Vision demo caregiver" });
  await actor.mutation(api.demo.ensureCareTeam, {});
  return { root, actor };
}

describe("camera observations", () => {
  it("requires authentication", async () => {
    const root = convexTest(schema, modules);
    await expect(root.mutation(api.vision.beginSession, {
      sessionId: "vision_session_01", startedAt: Date.now(),
    })).rejects.toThrow("Authentication required");
  });

  it("persists an idempotent non-clinical observation lifecycle", async () => {
    const { root, actor } = await setup();
    const careTeam = await actor.query(api.caregiver.setup, {});
    if (careTeam.status !== "ready") throw new Error("Care team was not ready");
    await actor.mutation(api.medications.createWithAssignment, {
      patientId: careTeam.patient.id,
      name: "Iron Pills",
      instructions: "Synthetic demo only",
      slot: 6,
      localTime: "09:00",
      weekdays: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
      timezone: "America/Toronto",
      demoInventory: 1,
    });
    const occurrenceId = await actor.mutation(api.occurrences.createDemoDue, {});
    const startedAt = Date.now();
    await actor.mutation(api.vision.beginSession, { sessionId: "vision_session_02", startedAt });
    const first = await actor.mutation(api.vision.recordEvent, {
      sessionId: "vision_session_02", eventId: "vision_event_0001",
      type: "HAND_AT_MOUTH_DETECTED", source, occurredAt: startedAt + 1,
    });
    const duplicate = await actor.mutation(api.vision.recordEvent, {
      sessionId: "vision_session_02", eventId: "vision_event_0001",
      type: "HAND_AT_MOUTH_DETECTED", source, occurredAt: startedAt + 1,
    });
    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    await actor.mutation(api.vision.closeSession, {
      sessionId: "vision_session_02", status: "STOPPED", endedAt: startedAt + 2,
    });
    const observations = await root.run((ctx) => ctx.db.query("cameraObservationEvents").collect());
    const dose = await root.run((ctx) => ctx.db.get("doseOccurrences", occurrenceId));
    const assignments = await root.run((ctx) => ctx.db.query("compartmentAssignments").collect());
    expect(observations).toHaveLength(1);
    expect(observations[0]).not.toHaveProperty("ingestion");
    expect(dose).toMatchObject({ ingestionReport: "UNREPORTED", attemptStatus: "NONE" });
    expect(assignments[0].demoInventory).toBe(1);
  });

  it("enforces session ownership and patient isolation", async () => {
    const { root, actor } = await setup();
    const startedAt = Date.now();
    await actor.mutation(api.vision.beginSession, { sessionId: "vision_session_03", startedAt });
    const other = root.withIdentity({ tokenIdentifier: "issuer|vision-other", name: "Other caregiver" });
    await other.mutation(api.demo.ensureCareTeam, {});
    await expect(other.mutation(api.vision.recordEvent, {
      sessionId: "vision_session_03", eventId: "vision_event_0002",
      type: "PERSON_VISIBLE", source, occurredAt: startedAt + 1,
    })).rejects.toThrow("Camera session access denied");
    await expect(other.query(api.vision.latest, {})).resolves.toBeNull();
  });
});
