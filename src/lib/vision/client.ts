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

  async start(sessionId: string, cameraIndex = 0): Promise<VisionSnapshot> {
    const capability = await this.request<{ capabilityToken: string }>("/v1/capabilities", { method: "POST" }, false);
    if (!capability.capabilityToken) throw new Error("Vision bridge did not grant a capability");
    this.capability = capability.capabilityToken;
    return parseVisionSnapshot(await this.request(`/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, cameraIndex }),
    }));
  }

  async events(sessionId: string, after?: string): Promise<VisionSnapshot> {
    const query = after ? `?after=${encodeURIComponent(after)}` : "";
    return parseVisionSnapshot(await this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/events${query}`));
  }

  async stop(sessionId: string): Promise<VisionSnapshot> {
    return parseVisionSnapshot(await this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/stop`, { method: "POST" }));
  }

  async preview(sessionId: string): Promise<Blob | null> {
    const response = await this.fetchWithCapability(
      `/v1/sessions/${encodeURIComponent(sessionId)}/preview.jpg?at=${Date.now()}`,
      { cache: "no-store" },
    );
    if (response.status === 204) return null;
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { detail?: string } | null;
      throw new Error(body?.detail ?? `Vision preview failed (${response.status})`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/jpeg")) throw new Error("Invalid vision preview response");
    return response.blob();
  }

  releaseOnUnload(sessionId: string) {
    if (!this.capability) return;
    void fetch(`${this.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/stop`, {
      method: "POST", headers: { [CAPABILITY_HEADER]: this.capability }, keepalive: true,
    });
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}, includeCapability = true): Promise<T> {
    const response = includeCapability
      ? await this.fetchWithCapability(path, init)
      : await this.fetchRaw(path, init);
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    if (!response.ok) throw new Error(body?.detail ?? `Vision bridge request failed (${response.status})`);
    return body as T;
  }


  private async fetchWithCapability(path: string, init: RequestInit = {}) {
    if (!this.capability) throw new Error("Vision capability is unavailable");
    const headers = new Headers(init.headers);
    headers.set(CAPABILITY_HEADER, this.capability);
    return this.fetchRaw(path, { ...init, headers });
  }

  private async fetchRaw(path: string, init: RequestInit = {}) {
    try {
      return await fetch(`${this.baseUrl}${path}`, init);
    } catch {
      throw new Error("Local vision service is unavailable. Start the Python bridge on this computer.");
    }
  }
}
