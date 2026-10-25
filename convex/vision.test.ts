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

  it("requires an authorized synthetic caregiver operator", async () => {
    const root = convexTest(schema, modules);
    const patient = root.withIdentity({ tokenIdentifier: "issuer|vision-patient", name: "Patient" });
    await root.run(async (ctx) => {
      await ctx.db.insert("appUsers", {
        tokenIdentifier: "issuer|vision-patient", displayName: "Patient", role: "patient",
        isSynthetic: true, createdAt: Date.now(),
      });
    });
    await expect(patient.mutation(api.vision.beginSession, {
      sessionId: "vision_patient_01", startedAt: Date.now(),
    })).rejects.toThrow("Hardware Lab caregiver access required");
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

  it("recovers the current operator's active session instead of creating an overlap", async () => {
    const { root, actor } = await setup();
    const startedAt = Date.now();
    const created = await actor.mutation(api.vision.beginSession, {
      sessionId: "vision_recover_01", startedAt,
    });
    const recovered = await actor.mutation(api.vision.beginSession, {
      sessionId: "vision_recover_02", startedAt: startedAt + 1,
    });
    expect(created.kind).toBe("CREATED");
    expect(recovered).toMatchObject({ kind: "RECOVER_EXISTING", sessionId: "vision_recover_01" });
    const active = await root.run((ctx) => ctx.db
      .query("cameraObservationSessions")
      .filter((q) => q.eq(q.field("status"), "ACTIVE"))
      .collect());
    expect(active).toHaveLength(1);
  });

  it("expires a stale owned session before permitting a new one", async () => {
    const { root, actor } = await setup();
    const now = Date.now();
    const { viewerId, patientId } = await root.run(async (ctx) => {
      const viewer = await ctx.db.query("appUsers")
        .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", "issuer|vision-owner"))
        .unique();
      if (!viewer) throw new Error("Missing test viewer");
      const relationship = await ctx.db.query("careRelationships")
        .withIndex("by_caregiver", (q) => q.eq("caregiverId", viewer._id))
        .first();
      if (!relationship) throw new Error("Missing test relationship");
      return { viewerId: viewer._id, patientId: relationship.patientId };
    });
    await root.run((ctx) => ctx.db.insert("cameraObservationSessions", {
      sessionId: "vision_stale_01", patientId, initiatedBy: viewerId,
      source, status: "ACTIVE", startedAt: now - 300_001, createdAt: now - 300_001,
      updatedAt: now - 300_001,
    }));
    await expect(actor.mutation(api.vision.inspectSession, {})).resolves.toEqual({ kind: "NONE", reconciled: true });
    const stale = await root.run((ctx) => ctx.db.query("cameraObservationSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", "vision_stale_01"))
      .unique());
    expect(stale?.status).toBe("EXPIRED");
    await expect(actor.mutation(api.vision.beginSession, {
      sessionId: "vision_after_stale", startedAt: now,
    })).resolves.toMatchObject({ kind: "CREATED" });
  });

  it("does not disclose or terminate another operator's active session", async () => {
    const { root, actor } = await setup();
    const startedAt = Date.now();
    await actor.mutation(api.vision.beginSession, { sessionId: "vision_owned_01", startedAt });
    await root.run(async (ctx) => {
      const owner = await ctx.db.query("appUsers")
        .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", "issuer|vision-owner"))
        .unique();
      if (!owner) throw new Error("Missing owner");
      const relationship = await ctx.db.query("careRelationships")
        .withIndex("by_caregiver", (q) => q.eq("caregiverId", owner._id))
        .first();
      if (!relationship) throw new Error("Missing patient");
      const otherId = await ctx.db.insert("appUsers", {
        tokenIdentifier: "issuer|vision-same-patient", displayName: "Second operator",
        role: "caregiver", isSynthetic: false, createdAt: startedAt,
      });
      await ctx.db.insert("careRelationships", {
        caregiverId: otherId, patientId: relationship.patientId, status: "active", createdAt: startedAt,
      });
    });
    const other = root.withIdentity({ tokenIdentifier: "issuer|vision-same-patient", name: "Second operator" });
    const inspected = await other.mutation(api.vision.inspectSession, {});
    expect(inspected.kind).toBe("OTHER_OPERATOR_ACTIVE");
    expect(inspected).not.toHaveProperty("sessionId");
    await expect(other.mutation(api.vision.closeSession, {
      sessionId: "vision_owned_01", status: "STOPPED", endedAt: startedAt + 1,
    })).rejects.toThrow("Camera session access denied");
  });

  it("closes an owned orphan idempotently and permits a fresh session", async () => {
    const { root, actor } = await setup();
    const startedAt = Date.now();
    await actor.mutation(api.vision.beginSession, { sessionId: "vision_orphan_01", startedAt });
    await actor.mutation(api.vision.closeSession, {
      sessionId: "vision_orphan_01", status: "STOPPED", endedAt: startedAt + 1,
    });
    await expect(actor.mutation(api.vision.closeSession, {
      sessionId: "vision_orphan_01", status: "STOPPED", endedAt: startedAt + 2,
    })).resolves.toEqual({ closed: true });
    await expect(actor.mutation(api.vision.beginSession, {
      sessionId: "vision_fresh_01", startedAt: startedAt + 3,
    })).resolves.toMatchObject({ kind: "CREATED", sessionId: "vision_fresh_01" });
    const sessions = await root.run((ctx) => ctx.db.query("cameraObservationSessions").collect());
    expect(sessions.map((session) => [session.sessionId, session.status])).toEqual([
      ["vision_orphan_01", "STOPPED"],
      ["vision_fresh_01", "ACTIVE"],
    ]);
  });
});
