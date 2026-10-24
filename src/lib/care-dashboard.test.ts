import { describe, expect, it } from "vitest";
import { caregiverActivityState, caregiverNextAction, dedupeCaregiverActivity, getCareProgress, pickPriorityCase } from "./care-dashboard";

const NOW = new Date(2026, 9, 23, 14, 0).getTime();
const at = (hour: number) => new Date(2026, 9, 23, hour).getTime();

describe("care dashboard presentation", () => {
  it("uses only explicit patient reports for adherence progress", () => {
    const progress = getCareProgress([
      { scheduledFor: at(8), expiresAt: at(9), ingestionReport: "TAKEN" },
      { scheduledFor: at(10), expiresAt: at(11), ingestionReport: "UNREPORTED" },
      { scheduledFor: at(18), expiresAt: at(19), ingestionReport: "UNREPORTED" },
    ], NOW);
    expect(progress).toMatchObject({ total: 3, taken: 1, needsAttention: 1, awaiting: 1, percent: 33, state: "ACTION_NEEDED" });
  });

  it("does not count motor state as a patient report", () => {
    const progress = getCareProgress([{ scheduledFor: at(8), expiresAt: at(9), ingestionReport: "UNREPORTED" }], NOW);
    expect(progress.taken).toBe(0);
    expect(progress.state).toBe("ACTION_NEEDED");
  });

  it("selects the newest open case ahead of acknowledged cases", () => {
    const selected = pickPriorityCase([
      { id: "ack", status: "ACKNOWLEDGED", updatedAt: 30 },
      { id: "old", status: "OPEN", updatedAt: 10 },
      { id: "new", status: "OPEN", updatedAt: 20 },
      { id: "done", status: "RESOLVED", updatedAt: 40 },
    ]);
    expect(selected?.id).toBe("new");
  });

  it("collapses technical case states into three caregiver states", () => {
    expect(caregiverActivityState({ status: "OPEN", investigationStatus: "NOT_REQUESTED" })).toBe("NEEDS_ATTENTION");
    expect(caregiverActivityState({ status: "OPEN", investigationStatus: "COMPLETED" })).toBe("NEEDS_ATTENTION");
    expect(caregiverActivityState({ status: "OPEN", investigationStatus: "RUNNING" })).toBe("IN_PROGRESS");
    expect(caregiverActivityState({ status: "ACKNOWLEDGED", investigationStatus: "NOT_REQUESTED" })).toBe("IN_PROGRESS");
    expect(caregiverActivityState({ status: "RESOLVED", investigationStatus: "FAILED" })).toBe("RESOLVED");
  });

  it("turns investigation internals into a next action rather than another status", () => {
    expect(caregiverNextAction({ status: "OPEN", investigationStatus: "COMPLETED" })).toBe("Review findings");
    expect(caregiverNextAction({ status: "OPEN", investigationStatus: "FAILED" })).toBe("Review case manually");
    expect(caregiverNextAction({ status: "ACKNOWLEDGED", investigationStatus: "NOT_REQUESTED" })).toBe("Caregiver follow-up underway");
  });

  it("keeps only the newest repeated caregiver item", () => {
    const rows = dedupeCaregiverActivity([
      { id: "new", state: "NEEDS_ATTENTION" as const, title: "No response", medicationName: "Iron Pills" },
      { id: "old", state: "NEEDS_ATTENTION" as const, title: "No response", medicationName: "Iron Pills" },
      { id: "resolved", state: "RESOLVED" as const, title: "No response", medicationName: "Iron Pills" },
    ]);
    expect(rows.map((row) => row.id)).toEqual(["new", "resolved"]);
  });
});
