import { describe, expect, it } from "vitest";
import { getAvailableSlots } from "./slots";

describe("caregiver slot availability", () => {
  it("excludes occupied slots and never exposes home position 0", () => {
    expect(getAvailableSlots([2, 6])).toEqual([1, 3, 4, 5, 7]);
    expect(getAvailableSlots([])).not.toContain(0);
  });
});
