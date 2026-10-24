import { parseVisionSnapshot, type VisionSnapshot } from "./types";

const CAPABILITY_HEADER = "X-PillSense-Vision-Capability";

export class LocalVisionClient {
  private capability: string | null = null;
  private readonly baseUrl: string;

  constructor(baseUrl = process.env.NEXT_PUBLIC_VISION_BRIDGE_URL ?? "http://127.0.0.1:8101") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async health(): Promise<{ service: "ready"; cameraOwnerActive: boolean }> {
    const value = await this.request<{ service?: unknown; cameraOwnerActive?: unknown }>("/health", {}, false);
    if (value.service !== "ready" || typeof value.cameraOwnerActive !== "boolean") {
      throw new Error("Invalid vision bridge health response");
    }
    return { service: "ready", cameraOwnerActive: value.cameraOwnerActive };
  }

  async start(sessionId: string): Promise<VisionSnapshot> {
    const capability = await this.request<{ capabilityToken: string }>("/v1/capabilities", { method: "POST" }, false);
    if (!capability.capabilityToken) throw new Error("Vision bridge did not grant a capability");
    this.capability = capability.capabilityToken;
    return parseVisionSnapshot(await this.request(`/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    }));
  }

  async events(sessionId: string, after?: string): Promise<VisionSnapshot> {
    const query = after ? `?after=${encodeURIComponent(after)}` : "";
    return parseVisionSnapshot(await this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/events${query}`));
  }

  async stop(sessionId: string): Promise<VisionSnapshot> {
    return parseVisionSnapshot(await this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/stop`, { method: "POST" }));
  }

  releaseOnUnload(sessionId: string) {
    if (!this.capability) return;
    void fetch(`${this.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/stop`, {
      method: "POST", headers: { [CAPABILITY_HEADER]: this.capability }, keepalive: true,
    });
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}, includeCapability = true): Promise<T> {
    const headers = new Headers(init.headers);
    if (includeCapability) {
      if (!this.capability) throw new Error("Vision capability is unavailable");
      headers.set(CAPABILITY_HEADER, this.capability);
    }
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    } catch {
      throw new Error("Local vision service is unavailable. Start the Python bridge on this computer.");
    }
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    if (!response.ok) throw new Error(body?.detail ?? `Vision bridge request failed (${response.status})`);
    return body as T;
  }
}
