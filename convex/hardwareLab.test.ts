/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("hardware lab authorization", () => {
  it("rejects unauthenticated access", async () => {
    const root = convexTest(schema, modules);
    await expect(root.query(api.hardwareLab.access, {})).rejects.toThrow("Authentication required");
  });

  it("does not authorize a patient account", async () => {
    const root = convexTest(schema, modules);
    const actor = root.withIdentity({ tokenIdentifier: "issuer|patient-operator", name: "Patient" });
    await root.run(async (ctx) => {
      await ctx.db.insert("appUsers", {
        tokenIdentifier: "issuer|patient-operator", displayName: "Patient", role: "patient",
        isSynthetic: true, createdAt: Date.now(),
      });
    });
    await expect(actor.query(api.hardwareLab.access, {})).resolves.toMatchObject({ authorized: false, reason: "CAREGIVER_REQUIRED" });
  });

  it("authorizes only a caregiver explicitly paired to a synthetic patient", async () => {
    const root = convexTest(schema, modules);
    const actor = root.withIdentity({ tokenIdentifier: "issuer|lab-caregiver", name: "Lab caregiver" });
    await actor.mutation(api.demo.ensureCareTeam, {});
    await expect(actor.query(api.hardwareLab.access, {})).resolves.toMatchObject({
      authorized: true,
      scope: "SYNTHETIC_PATIENT_LAB",
    });
  });

  it("does not authorize an unpaired caregiver", async () => {
    const root = convexTest(schema, modules);
    const actor = root.withIdentity({ tokenIdentifier: "issuer|unpaired-caregiver", name: "Unpaired" });
    await root.run(async (ctx) => {
      await ctx.db.insert("appUsers", {
        tokenIdentifier: "issuer|unpaired-caregiver", displayName: "Unpaired", role: "caregiver",
        isSynthetic: false, createdAt: Date.now(),
      });
    });
    await expect(actor.query(api.hardwareLab.access, {})).resolves.toMatchObject({ authorized: false, reason: "SYNTHETIC_RELATIONSHIP_REQUIRED" });
  });
});
