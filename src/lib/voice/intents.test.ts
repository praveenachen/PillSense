import { describe, expect, it } from "vitest";
import { parseConfirmation, parseVoiceIntent } from "./intents";

describe("voice intent parser", () => {
  it.each([
    ["I'm ready for my medication", { type: "SCHEDULED_DOSE_ASSISTANCE" }],
    ["I took my medication", { type: "REPORT_TAKEN_OR_NOT_TAKEN", report: "TAKEN" }],
    ["I haven't taken it yet", { type: "REPORT_TAKEN_OR_NOT_TAKEN", report: "NOT_TAKEN" }],
    ["My dispenser isn't working", { type: "REPORT_DEVICE_PROBLEM" }],
  ])("matches supported phrase %s", (phrase, expected) => expect(parseVoiceIntent(phrase)).toMatchObject(expected));

  it.each(["Maybe I took it", "I took it but I haven't taken it", "Tell me what dose I should take", "Order my refill"])("does not turn ambiguous or unsupported speech into a mutation: %s", (phrase) => {
    expect(["AMBIGUOUS", "UNSUPPORTED"]).toContain(parseVoiceIntent(phrase).type);
  });

  it("requires an explicit confirmation phrase", () => {
    expect(parseConfirmation("confirm")).toBe("CONFIRM");
    expect(parseConfirmation("yes that is correct")).toBe("CONFIRM");
    expect(parseConfirmation("maybe")).toBeNull();
    expect(parseConfirmation("cancel")).toBe("CANCEL");
  });
});
