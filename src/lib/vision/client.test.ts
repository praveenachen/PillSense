import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalVisionClient } from "./client";
import { VISION_SOURCE } from "./types";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("local vision client", () => {
  it("obtains a capability before lifecycle requests", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ capabilityToken: "short-lived-token" }))
      .mockResolvedValueOnce(response({ sessionId: "vision_session_01", status: "ACTIVE", events: [] }))
      .mockResolvedValueOnce(response({ sessionId: "vision_session_01", status: "ACTIVE", events: [{
        eventId: "vision_event_01", sessionId: "vision_session_01", timestamp: 1, type: "CAMERA_STARTED", source: VISION_SOURCE,
      }] }))
      .mockResolvedValueOnce(response({ sessionId: "vision_session_01", status: "STOPPED", events: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new LocalVisionClient("http://127.0.0.1:8101");
    await client.start("vision_session_01");
    await client.events("vision_session_01", "vision_event_00");
    await client.stop("vision_session_01");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("X-PillSense-Vision-Capability")).toBe("short-lived-token");
    expect(String(fetchMock.mock.calls[2][0])).toContain("after=vision_event_00");
  });

  it("reports an unavailable local service", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    await expect(new LocalVisionClient().start("vision_session_02")).rejects.toThrow("Local vision service is unavailable");
  });
});
