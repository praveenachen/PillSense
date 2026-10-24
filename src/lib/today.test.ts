import { describe, expect, it } from "vitest";
import { buildTodayTimeline, compactDoseLine, countdownLabel, firstName, greetingFor, pickNextDose, type DoseOccurrence, type ScheduledMedication } from "./today";

const NOW = new Date(2026, 9, 23, 9, 0, 0).getTime(); // a Friday, 9:00 local
const at = (h: number, m = 0) => new Date(2026, 9, 23, h, m, 0).getTime();

const meds: ScheduledMedication[] = [
  { id: "m1", name: "Vitamin D", instructions: "", slot: 2, localTime: "08:00", weekdays: ["FRI"] },
  { id: "m2", name: "Metformin", instructions: "With breakfast", slot: 1, localTime: "09:30", weekdays: ["FRI"] },
  { id: "m3", name: "Lisinopril", instructions: "", slot: 3, localTime: "12:30", weekdays: ["FRI"] },
  { id: "m4", name: "Weekend only", instructions: "", slot: 4, localTime: "10:00", weekdays: ["SAT"] },
];

function occurrence(partial: Partial<DoseOccurrence> & Pick<DoseOccurrence, "id" | "medicationName" | "scheduledFor">): DoseOccurrence {
  return {
    mode: "scheduled", instructions: "", slot: 1,
    eligibleFrom: partial.scheduledFor - 15 * 60_000, expiresAt: partial.scheduledFor + 15 * 60_000,
    attemptStatus: "NONE", ingestionReport: "UNREPORTED", ...partial,
  };
}

describe("today timeline", () => {
  it("lists only today's weekday schedules in time order", () => {
    const rows = buildTodayTimeline(meds, [], NOW);
    expect(rows.map((row) => row.medicationName)).toEqual(["Vitamin D", "Metformin", "Lisinopril"]);
  });

  it("never marks a dose taken without a persisted patient report", () => {
    const completedMotor = occurrence({ id: "o1", medicationName: "Vitamin D", scheduledFor: at(8), attemptStatus: "COMPLETED" });
    const rows = buildTodayTimeline(meds, [completedMotor], NOW);
    expect(rows[0].state).toBe("NEEDS_CONFIRMATION");
    expect(rows.some((row) => row.state === "TAKEN")).toBe(false);
  });

  it("uses only Taken, Needs confirmation and Upcoming", () => {
    const taken = occurrence({ id: "o1", medicationName: "Vitamin D", scheduledFor: at(8), ingestionReport: "TAKEN" });
    const notTaken = occurrence({ id: "o2", medicationName: "Metformin", scheduledFor: at(9, 30), ingestionReport: "NOT_TAKEN" });
    const rows = buildTodayTimeline(meds, [taken, notTaken], NOW + 60 * 60_000);
    expect(rows.map((row) => row.state)).toEqual(["TAKEN", "NEEDS_CONFIRMATION", "UPCOMING"]);
  });

  it("picks the next future dose and never pins an unreported past dose", () => {
    const overdue = occurrence({ id: "o1", medicationName: "Vitamin D", scheduledFor: at(8) });
    const rows = buildTodayTimeline(meds, [overdue], NOW);
    expect(rows[0].state).toBe("NEEDS_CONFIRMATION");
    const next = pickNextDose(rows);
    expect(next?.medicationName).toBe("Metformin");
    expect(next?.state).toBe("UPCOMING");
  });

  it("has no occurrence id (so no Mark-as-taken) for schedule-only rows", () => {
    const next = pickNextDose(buildTodayTimeline(meds, [], NOW));
    expect(next?.medicationName).toBe("Metformin");
    expect(next?.occurrenceId).toBeNull();
  });

  it("includes an unmatched demo occurrence and labels it", () => {
    const demo = occurrence({ id: "d1", mode: "demo", medicationName: "Demo Pill", scheduledFor: at(9, 1) });
    const rows = buildTodayTimeline(meds, [demo], NOW);
    expect(rows.find((row) => row.occurrenceId === "d1")?.isDemo).toBe(true);
  });

  it("returns nothing for an empty schedule", () => {
    expect(pickNextDose(buildTodayTimeline([], [], NOW))).toBeNull();
  });
});

describe("greeting helpers", () => {
  it("chooses a greeting by hour", () => {
    expect(greetingFor(8)).toBe("Good morning,");
    expect(greetingFor(14)).toBe("Good afternoon,");
    expect(greetingFor(20)).toBe("Good evening,");
  });
  it("extracts a first name", () => {
    expect(firstName("Eleanor Vance")).toBe("Eleanor");
    expect(firstName(undefined)).toBe("");
  });
});

describe("countdownLabel", () => {
  it("counts down only to a future scheduled time", () => {
    expect(countdownLabel(NOW + 12 * 60_000, NOW)).toBe("in 12 min");
    expect(countdownLabel(NOW + 11.2 * 60_000, NOW)).toBe("in 12 min");
    expect(countdownLabel(NOW + 60 * 60_000, NOW)).toBe("in 1 hr");
    expect(countdownLabel(NOW + 125 * 60_000, NOW)).toBe("in 2 hr 5 min");
    expect(countdownLabel(NOW, NOW)).toBeNull();
    expect(countdownLabel(NOW - 60_000, NOW)).toBeNull();
  });
});

describe("compactDoseLine", () => {
  it("joins dosage and the remaining instruction", () => {
    expect(compactDoseLine({ instructions: "Take 2 tablets with breakfast", slot: 1 })).toBe("2 tablets · With breakfast");
    expect(compactDoseLine({ instructions: "With water", slot: 6 })).toBe("1 dispenser dose · With water");
    expect(compactDoseLine({ instructions: "", slot: 6 })).toBe("1 dispenser dose");
  });
});
