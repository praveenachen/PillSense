import { describe, expect, it } from "vitest";

import { MockDispenserAdapter } from "./mock-dispenser-adapter";
import { isSlotId, toSlotId } from "./types";
import type { DispenseCommand, SlotId } from "./types";

const command = (commandId: string, slotId: SlotId = 1): DispenseCommand => ({
  commandId,
  slotId,
  requestedAt: "2026-10-22T12:00:00.000Z",
});

describe("slot validation", () => {
  it("accepts only medication positions 1 through 7", () => {
    expect([1, 2, 3, 4, 5, 6, 7].every(isSlotId)).toBe(true);
    expect(isSlotId(0)).toBe(false);
    expect(isSlotId(8)).toBe(false);
    expect(isSlotId(1.5)).toBe(false);
    expect(() => toSlotId(0)).toThrow(RangeError);
  });
});

describe("MockDispenserAdapter", () => {
  it("gates dispensing until manual home alignment is confirmed", async () => {
    const adapter = new MockDispenserAdapter();

    expect((await adapter.getStatus()).state).toBe("CALIBRATION_REQUIRED");
    expect((await adapter.connect()).state).toBe("CALIBRATION_REQUIRED");
    expect((await adapter.dispense(command("before-home"))).outcome).toBe("REJECTED");
    expect(adapter.getSimulatedMotorOperationCount()).toBe(0);

    expect((await adapter.confirmHomeAligned()).state).toBe("READY");
    expect((await adapter.dispense(command("after-home"))).outcome).toBe("COMPLETED");
  });

  it("suppresses duplicate command IDs and performs one motor operation", async () => {
    const adapter = new MockDispenserAdapter();
    await adapter.connect();
    await adapter.confirmHomeAligned();

    const first = await adapter.dispense(command("stable-id", 3));
    const duplicate = await adapter.dispense(command("stable-id", 3));

    expect(duplicate).toEqual(first);
    expect(adapter.getSimulatedMotorOperationCount()).toBe(1);
  });

  it("keeps an ambiguous result UNKNOWN and never retries it", async () => {
    const adapter = new MockDispenserAdapter();
    await adapter.connect();
    await adapter.confirmHomeAligned();
    adapter.simulateNextOutcome("UNKNOWN");

    const first = await adapter.dispense(command("ambiguous", 7));
    const duplicate = await adapter.dispense(command("ambiguous", 7));

    expect(first).toMatchObject({
      outcome: "UNKNOWN",
      motorCompletion: "UNKNOWN",
      pillRelease: "UNKNOWN",
      pillCollection: "UNKNOWN",
      ingestion: "UNKNOWN",
    });
    expect(duplicate).toEqual(first);
    expect(adapter.getSimulatedMotorOperationCount()).toBe(1);
    expect((await adapter.getStatus()).faultCode).toBe("AMBIGUOUS_RESULT");
  });
});
