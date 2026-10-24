/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup(token: string) {
  const root = convexTest(schema, modules);
  const actor = root.withIdentity({ tokenIdentifier: token, name: "Voice demo caregiver" });
  await actor.mutation(api.demo.ensureCareTeam, {});
  return { root, actor };
}

describe("patient device issue reporting", () => {
  it("requires authentication", async () => {
    const root = convexTest(schema, modules);
    await expect(root.mutation(api.deviceIssues.report, { idempotencyKey: "voice:unauthenticated", transcript: "My dispenser isn't working" })).rejects.toThrow("Authentication required");
  });

  it("deduplicates a confirmed report and preserves the actual runtime state", async () => {
    const data = await setup("issuer|voice-device");
    await data.actor.mutation(api.device.connectMock, {});
    const args = { idempotencyKey: "voice:device:one", transcript: "My dispenser isn't working" };
    const first = await data.actor.mutation(api.deviceIssues.report, args);
    const second = await data.actor.mutation(api.deviceIssues.report, args);
    expect(first).toMatchObject({ duplicate: false, observedState: "CALIBRATION_REQUIRED" });
    expect(second).toMatchObject({ issueId: first.issueId, duplicate: true, observedState: "CALIBRATION_REQUIRED" });
    const issues = await data.root.run((ctx) => ctx.db.query("patientDeviceIssues").take(10));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ observedFaultCode: null, reportedProblem: "PATIENT_REPORTED_DEVICE_PROBLEM" });
  });

  it("isolates caregiver issue lists by explicit relationship", async () => {
    const owner = await setup("issuer|voice-owner");
    await owner.actor.mutation(api.deviceIssues.report, { idempotencyKey: "voice:owned", transcript: "The device has a problem" });
    const other = owner.root.withIdentity({ tokenIdentifier: "issuer|voice-other", name: "Other caregiver" });
    await other.mutation(api.demo.ensureCareTeam, {});
    const result = await other.query(api.deviceIssues.listForCaregiver, {});
    expect(result.status).toBe("ready");
    expect(result.issues).toEqual([]);
  });
});
