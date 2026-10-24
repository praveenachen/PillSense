import { describe, expect, it, vi } from "vitest";
import { createVisionSessionId, parseVisionSnapshot, VISION_SOURCE } from "./types";

describe("vision event protocol", () => {
  it("accepts an observation without clinical claims", () => {
    const value = parseVisionSnapshot({ sessionId: "vision_session_01", status: "ACTIVE", events: [{
      eventId: "vision_event_01", sessionId: "vision_session_01", timestamp: 1,
      type: "HAND_AT_MOUTH_DETECTED", source: VISION_SOURCE,
    }] });
    expect(value.events[0].type).toBe("HAND_AT_MOUTH_DETECTED");
    expect(value.events[0]).not.toHaveProperty("ingestion");
    expect(value.events[0]).not.toHaveProperty("confidence");
  });

  it("rejects unknown or cross-session events", () => {
    for (const event of [
      { eventId: "e", sessionId: "s", timestamp: 1, type: "INGESTED", source: VISION_SOURCE },
      { eventId: "e", sessionId: "s", timestamp: 1, type: "CAMERA_STARTED", source: "REMOTE" },
      { eventId: "e", sessionId: "other", timestamp: 1, type: "CAMERA_STARTED", source: VISION_SOURCE },
    ]) expect(() => parseVisionSnapshot({ sessionId: "s", status: "ACTIVE", events: [event] })).toThrow("Invalid vision event");
  });

  it("creates opaque session IDs with browser cryptography", () => {
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) });
    expect(createVisionSessionId()).toBe("vision_070707070707070707070707");
    vi.unstubAllGlobals();
  });
});
