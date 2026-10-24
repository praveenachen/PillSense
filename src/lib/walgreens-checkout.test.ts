import { describe, expect, it, vi } from "vitest";
import { prepareWalgreensCheckout, SANDBOX_TEST_RX } from "./walgreens-checkout";

describe("caregiver Walgreens checkout action", () => {
  it("approves first and creates one session with an official synthetic Rx", async () => {
    const approve = vi.fn(async () => ({ checkoutId: "checkout_1" }));
    const createSession = vi.fn(async () => ({ status: "CHECKOUT_READY", landingUrl: "https://example.walgreens.com/checkout", environment: "SANDBOX" as const }));
    const result = await prepareWalgreensCheckout({ caseId: "case_1", approve, createSession });
    expect(approve).toHaveBeenCalledWith("case_1");
    expect(createSession).toHaveBeenCalledWith("checkout_1", "caregiver-ui:checkout_1", SANDBOX_TEST_RX);
    expect(result.status).toBe("CHECKOUT_READY");
  });

  it("does not create a session when approval fails", async () => {
    const createSession = vi.fn();
    await expect(prepareWalgreensCheckout({ caseId: "case_1", approve: async () => { throw new Error("Not eligible"); }, createSession })).rejects.toThrow("Not eligible");
    expect(createSession).not.toHaveBeenCalled();
  });
});
