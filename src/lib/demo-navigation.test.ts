import { describe, expect, it } from "vitest";
import { demoTabs, getDemoPanelStates, isDemoTabId } from "./demo-navigation";

describe("mobile demo navigation", () => {
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
