import { describe, expect, it } from "vitest";
import { reminderPrompt } from "./reminder-prompt";

const session = { patientFirstName: "Demo", isSynthetic: true, medicationName: "Iron Pills", state: "AWAITING_READINESS" };

describe("scheduled reminder prompts", () => {
  it("uses Praveena only for the synthetic demo and keeps the actual reminder medication", () => {
    expect(reminderPrompt(session)).toBe("Hello Praveena! It's time for your Iron Pills. Are you ready for your medication?");
    expect(reminderPrompt({ ...session, isSynthetic: false, patientFirstName: "Alex", medicationName: "Advil" })).toContain("Hello Alex! It's time for your Advil.");
  });
  it("resumes education and hardware states instead of presenting a fresh readiness prompt", () => {
    expect(reminderPrompt({ ...session, state: "AWAITING_EDUCATION_CHOICE" })).toContain("side effects");
    expect(reminderPrompt({ ...session, state: "AWAITING_SUPPLY_CHOICE" })).toBe("Any questions?");
    expect(reminderPrompt({ ...session, state: "AWAITING_CONTINUE" })).toBe("Are you ready to dispense your medication?");
    for (const state of ["MOVEMENT_IN_PROGRESS", "AWAITING_PATIENT_REPORT", "COMPLETED", "DECLINED", "HARDWARE_UNKNOWN"]) {
      expect(reminderPrompt({ ...session, state })).not.toContain("Are you ready");
    }
  });
  it("greets on an explicit orb opening without resetting a completed movement", () => {
    const prompt = reminderPrompt({ ...session, state: "AWAITING_PATIENT_REPORT" }, true);
    expect(prompt).toContain("Hello Praveena!");
    expect(prompt).toContain("motor sequence has finished");
    expect(prompt).not.toContain("Are you ready");
  });
});
