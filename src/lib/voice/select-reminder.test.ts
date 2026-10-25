import { describe, expect, it } from "vitest";
import { selectFreshVoiceReminder } from "./select-reminder";

const now = 10_000;
const dose = (id: string, fields = {}) => ({ id, mode: "demo", slot: 6, medicationName: "Iron Pills", scheduledFor: 9_000, eligibleFrom: 8_000, expiresAt: 20_000, attemptStatus: "NONE", ingestionReport: "UNREPORTED", commandId: null as string | null, eligibility: "ELIGIBLE", ...fields });

describe("voice visual demo reminder selection", () => {
  it("picks the fresh Iron Pills occurrence instead of an older completed or unrelated dose", () => {
    const rows = [dose("old", { attemptStatus: "COMPLETED" }), dose("ibuprofen", { medicationName: "Ibuprofen", slot: 2 }), dose("fresh")];
    expect(selectFreshVoiceReminder(rows, now, true)?.id).toBe("fresh");
  });
  it("prefers the newest fresh scenario regardless of backend list order", () => {
    expect(selectFreshVoiceReminder([dose("older"), dose("new", { scheduledFor: 9_500 })], now, true)?.id).toBe("new");
  });
  it.each(["AUTHORIZED", "DISPATCHED", "COMPLETED", "UNKNOWN"])("never presents a %s occurrence as a new orb-triggered attempt", (attemptStatus) => {
    expect(selectFreshVoiceReminder([dose("attempted", { attemptStatus })], now, true)).toBeUndefined();
  });
  it("rejects expired, reported, stale, future, and already-commanded reminders", () => {
    const rows = [dose("expired", { expiresAt: 9_999 }), dose("reported", { ingestionReport: "TAKEN" }), dose("stale", { eligibility: "STALE" }), dose("future", { eligibleFrom: 10_001 }), dose("command", { commandId: "existing-command" })];
    expect(selectFreshVoiceReminder(rows, now, true)).toBeUndefined();
  });
  it("does not select a scheduled/non-Iron record in the dedicated demo mode", () => {
    const rows = [dose("regular", { mode: "scheduled" }), dose("other", { medicationName: "Vitamin D" })];
    expect(selectFreshVoiceReminder(rows, now, true)).toBeUndefined();
    expect(selectFreshVoiceReminder(rows, now, false)).toBeDefined();
  });
});
