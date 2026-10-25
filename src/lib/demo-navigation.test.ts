import { describe, expect, it, vi } from "vitest";
import { demoTabs, getDemoPanelStates, isDemoTabId, medicationCardAction } from "./demo-navigation";

describe("mobile demo navigation", () => {
  it("opens Voice when the next medication does not yet have an eligible reminder", () => {
    const voice = vi.fn();
    const schedule = vi.fn();
    const reminder = vi.fn();
    medicationCardAction({ occurrenceId: null, onOpenVoice: voice, onOpenSchedule: schedule, onOpenReminder: reminder })?.();
    expect(voice).toHaveBeenCalledOnce();
    expect(schedule).not.toHaveBeenCalled();
    expect(reminder).not.toHaveBeenCalled();
  });
  it("starts only the matching eligible occurrence and never a different reminder", () => {
    const voice = vi.fn();
    const reminder = vi.fn();
    medicationCardAction({ occurrenceId: "iron-6", dueReminderId: "iron-6", onOpenVoice: voice, onOpenReminder: reminder })?.();
    expect(reminder).toHaveBeenCalledWith("iron-6");
    expect(voice).not.toHaveBeenCalled();
    medicationCardAction({ occurrenceId: "other", dueReminderId: "iron-6", onOpenVoice: voice, onOpenReminder: reminder })?.();
    expect(voice).toHaveBeenCalledOnce();
    expect(reminder).toHaveBeenCalledTimes(1);
  });
  it("exposes the five presentation sections in their intended order", () => {
    expect(demoTabs.map(({ id }) => id)).toEqual([
      "today",
      "dispenser",
      "voice",
      "schedule",
      "care",
    ]);
  });

  it("keeps every panel mounted while changing which panel is visible", () => {
    const voice = getDemoPanelStates("voice");
    expect(voice).toHaveLength(5);
    expect(voice.every(({ mounted }) => mounted)).toBe(true);
    expect(voice.find(({ id }) => id === "voice")).toMatchObject({
      active: true,
      className: "block",
      ariaHidden: false,
    });
    expect(voice.find(({ id }) => id === "dispenser")).toMatchObject({
      active: false,
      className: "hidden",
      ariaHidden: true,
      mounted: true,
    });
  });

  it("accepts only known tabs", () => {
    expect(isDemoTabId("care")).toBe(true);
    expect(isDemoTabId("debug")).toBe(false);
  });
});
