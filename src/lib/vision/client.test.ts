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
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ sessionId: "vision_session_01", cameraIndex: 0 });
    expect(String(fetchMock.mock.calls[2][0])).toContain("after=vision_event_00");
  });

  it("reads a session-scoped JPEG preview with the same capability", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ capabilityToken: "preview-token" }))
      .mockResolvedValueOnce(response({ sessionId: "vision_session_03", status: "ACTIVE", events: [] }))
      .mockResolvedValueOnce(new Response(new Blob(["jpeg"]), { status: 200, headers: { "Content-Type": "image/jpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new LocalVisionClient("http://127.0.0.1:8101");
    await client.start("vision_session_03", 2);
    const preview = await client.preview("vision_session_03");
    expect(preview?.type).toBe("image/jpeg");
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get("X-PillSense-Vision-Capability")).toBe("preview-token");
    expect(String(fetchMock.mock.calls[2][0])).toContain("preview.jpg");
  });

  it("reports an unavailable local service", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    await expect(new LocalVisionClient().start("vision_session_02")).rejects.toThrow("Local vision service is unavailable");
  });

  it("reports the actual local owner and attaches with a fresh capability", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        service: "ready", cameraOwnerActive: true,
        activeSessionId: "vision_session_04", cameraIndex: 2,
      }))
      .mockResolvedValueOnce(response({ capabilityToken: "recovery-token" }))
      .mockResolvedValueOnce(response({ sessionId: "vision_session_04", status: "ACTIVE", events: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new LocalVisionClient("http://127.0.0.1:8101");
    await expect(client.health()).resolves.toEqual({
      service: "ready", cameraOwnerActive: true,
      activeSessionId: "vision_session_04", cameraIndex: 2,
    });
    await expect(client.attach("vision_session_04")).resolves.toMatchObject({ status: "ACTIVE" });
    expect(String(fetchMock.mock.calls[2][0])).toContain("/v1/sessions/vision_session_04/recover");
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get("X-PillSense-Vision-Capability")).toBe("recovery-token");
  });

  it("rejects ambiguous health responses instead of assuming a camera owner", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      service: "ready", cameraOwnerActive: true, activeSessionId: undefined, cameraIndex: 0,
    })));
    await expect(new LocalVisionClient().health()).rejects.toThrow("Invalid vision bridge health response");
  });

  it("stops a local session without using the recovery endpoint", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ capabilityToken: "stop-token" }))
      .mockResolvedValueOnce(response({
        outcome: "STOPPED",
        snapshot: { sessionId: "vision_session_05", status: "STOPPED", events: [] },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new LocalVisionClient("http://127.0.0.1:8101");
    await expect(client.stopIfPresent("vision_session_05")).resolves.toMatchObject({ outcome: "STOPPED" });
    expect(String(fetchMock.mock.calls[1][0])).toContain("/v1/sessions/vision_session_05/stop-if-present");
    expect(String(fetchMock.mock.calls[1][0])).not.toContain("recover");
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("X-PillSense-Vision-Capability")).toBe("stop-token");
  });

  it("treats a missing restarted-process session as already locally stopped", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ capabilityToken: "stop-token" }))
      .mockResolvedValueOnce(response({ outcome: "NOT_FOUND" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new LocalVisionClient().stopIfPresent("vision_session_06"))
      .resolves.toEqual({ outcome: "NOT_FOUND" });
  });

  it("treats the restarted bridge's legacy 404 as already locally stopped", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ capabilityToken: "stop-token" }))
      .mockResolvedValueOnce(response({ detail: "Unknown camera observation session" }, 404));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new LocalVisionClient().stopIfPresent("vision_session_07"))
      .resolves.toEqual({ outcome: "NOT_FOUND" });
  });

  it("cancels a hanging local initialization request", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ capabilityToken: "start-token" }))
      .mockImplementationOnce((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new LocalVisionClient();
    const pending = client.start("vision_session_08");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    client.cancelInitialization();
    await expect(pending).rejects.toThrow("Camera initialization was cancelled");
  });
});
