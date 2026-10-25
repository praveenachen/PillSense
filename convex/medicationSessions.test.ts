/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function dueDose(tokenIdentifier: string) {
  const root = convexTest(schema, modules);
  const caregiver = root.withIdentity({ tokenIdentifier, name: "Demo Caregiver" });
  await caregiver.mutation(api.demo.ensureCareTeam, {});
  const setup = await caregiver.query(api.caregiver.setup, {});
  if (setup.status !== "ready") throw new Error("Care team unavailable");
  await caregiver.mutation(api.medications.createWithAssignment, {
    patientId: setup.patient.id,
    name: "Advil 200 mg",
    instructions: "1 tablet · Follow the caregiver-approved package instructions",
    slot: 6,
    localTime: "09:00",
    weekdays: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
    timezone: "America/Toronto",
    demoInventory: 1,
  });
  const scenario = await caregiver.mutation(api.reminders.runDemoScenario, { scenario: "DUE_REMINDER" });
  return { root, caregiver, occurrenceId: scenario.occurrenceId };
}

describe("H6C medication interaction sessions", () => {
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
    expect(education.state).toBe("AWAITING_CONTINUE");
    expect(education.response).toContain("MedlinePlus");
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
});
