import { describe, expect, it } from "vitest";
import { buildSupplyForecast } from "./refillForecast";

const daily = [{
  localTime: "09:00",
  weekdays: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const,
  timezone: "America/Toronto",
}];

describe("buildSupplyForecast", () => {
  it("flags a verified three-dose daily supply conservatively", () => {
    const result = buildSupplyForecast({
      now: Date.parse("2026-10-23T12:00:00Z"), supplyCount: 3,
      source: "CAREGIVER_VERIFIED", schedules: daily.map((s) => ({ ...s, weekdays: [...s.weekdays] })),
    });
    expect(result.triggerReason).toBe("LOW_SUPPLY");
    expect(result.confidence).toBe("HIGH");
    expect(result.estimatedRunOutAt).not.toBeNull();
  });

  it("keeps local 9 AM occurrences stable across DST", () => {
    const result = buildSupplyForecast({
      now: Date.parse("2026-10-31T12:00:00Z"), supplyCount: 5,
      source: "CAREGIVER_VERIFIED", schedules: daily.map((s) => ({ ...s, weekdays: [...s.weekdays] })),
    });
    expect(result.estimatedRunOutAt).not.toBeNull();
    const local = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(result.estimatedRunOutAt!);
    expect(local).toBe("09:00");
  });

  it("labels missing supply unknown", () => {
    expect(buildSupplyForecast({ now: Date.now(), supplyCount: null, source: null, schedules: daily.map((s) => ({ ...s, weekdays: [...s.weekdays] })) })).toMatchObject({
      confidence: "UNKNOWN", triggerReason: "UNKNOWN_SUPPLY",
    });
  });

  it("downgrades confidence for unresolved missed-dose evidence", () => {
    expect(buildSupplyForecast({ now: Date.now(), supplyCount: 10, source: "CAREGIVER_VERIFIED", schedules: daily.map((s) => ({ ...s, weekdays: [...s.weekdays] })), hasMissedDoseUncertainty: true }).confidence).toBe("MEDIUM");
  });
});
