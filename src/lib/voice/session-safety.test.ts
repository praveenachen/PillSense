import { describe, expect, it } from "vitest";
import { canCommitVoiceAction, canProcessRecording, MICROPHONE_UNAVAILABLE_MESSAGE, TRANSCRIPTION_UNAVAILABLE_MESSAGE } from "./session-safety";

describe("voice session safety", () => {
  it("drops cancelled, empty, and oversized recordings", () => {
    expect(canProcessRecording(true, 100)).toBe(false);
    expect(canProcessRecording(false, 0)).toBe(false);
    expect(canProcessRecording(false, 2_500_001)).toBe(false);
    expect(canProcessRecording(false, 100)).toBe(true);
  });

  it("never commits from transcription without a pending action and explicit confirmation", () => {
    expect(canCommitVoiceAction(false, true)).toBe(false);
    expect(canCommitVoiceAction(true, false)).toBe(false);
    expect(canCommitVoiceAction(true, true)).toBe(true);
  });

  it("keeps microphone and transcription failures actionable", () => {
    expect(MICROPHONE_UNAVAILABLE_MESSAGE).toContain("text and touch");
    expect(TRANSCRIPTION_UNAVAILABLE_MESSAGE).toContain("Type or choose");
  });
});
