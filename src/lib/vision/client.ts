import { parseVisionSnapshot, type VisionSnapshot } from "./types";

const CAPABILITY_HEADER = "X-PillSense-Vision-Capability";

export type VisionHealth = {
  service: "ready";
  cameraOwnerActive: boolean;
  activeSessionId: string | null;
  cameraIndex: number;
};

export class VisionBridgeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "VisionBridgeError";
  }
}

export type StopIfPresentResult =
  | { outcome: "NOT_FOUND" }
  | { outcome: "STOPPED"; snapshot: VisionSnapshot };

export class LocalVisionClient {
  private capability: string | null = null;
  private initializationController: AbortController | null = null;
  private readonly baseUrl: string;

  constructor(baseUrl = process.env.NEXT_PUBLIC_VISION_BRIDGE_URL ?? "http://127.0.0.1:8101") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async health(): Promise<VisionHealth> {
    const value = await this.request<{
      service?: unknown;
      cameraOwnerActive?: unknown;
      activeSessionId?: unknown;
      cameraIndex?: unknown;
    }>("/health", {}, false);
    if (
      value.service !== "ready" ||
      typeof value.cameraOwnerActive !== "boolean" ||
      !(typeof value.activeSessionId === "string" || value.activeSessionId === null) ||
      !Number.isInteger(value.cameraIndex) || Number(value.cameraIndex) < 0
    ) {
      throw new Error("Invalid vision bridge health response");
    }
    return {
      service: "ready",
      cameraOwnerActive: value.cameraOwnerActive,
      activeSessionId: value.activeSessionId,
      cameraIndex: Number(value.cameraIndex),
    };
  }

  async start(sessionId: string, cameraIndex = 0): Promise<VisionSnapshot> {
    return this.withInitialization(async (signal) => {
      await this.issueCapability(signal);
      return parseVisionSnapshot(await this.request(`/v1/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, cameraIndex }),
        signal,
      }));
    });
  }

  async attach(sessionId: string): Promise<VisionSnapshot> {
    return this.withInitialization(async (signal) => {
      await this.issueCapability(signal);
      return parseVisionSnapshot(await this.request(
        `/v1/sessions/${encodeURIComponent(sessionId)}/recover`,
        { method: "POST", signal },
      ));
    });
  }

  async stopIfPresent(sessionId: string): Promise<StopIfPresentResult> {
    await this.issueCapability();
    let value: { outcome?: unknown; snapshot?: unknown };
    try {
      value = await this.request(
        `/v1/sessions/${encodeURIComponent(sessionId)}/stop-if-present`,
        { method: "POST" },
      );
    } catch (error) {
      // A restarted service has no in-memory record for the persisted Convex
      // session. Treat its 404 as already stopped locally, never as a blocker.
      if (error instanceof VisionBridgeError && error.status === 404) {
        return { outcome: "NOT_FOUND" };
      }
      throw error;
    }
    if (value.outcome === "NOT_FOUND") return { outcome: "NOT_FOUND" };
    if (value.outcome === "STOPPED") {
      return { outcome: "STOPPED", snapshot: parseVisionSnapshot(value.snapshot) };
    }
    throw new Error("Invalid vision stop response");
  }

  cancelInitialization() {
    this.initializationController?.abort();
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
    if (!response.ok) throw new VisionBridgeError(
      body?.detail ?? `Vision bridge request failed (${response.status})`,
      response.status,
    );
    return body as T;
  }

  private async issueCapability(signal?: AbortSignal) {
    const capability = await this.request<{ capabilityToken: string }>(
      "/v1/capabilities",
      { method: "POST", signal },
      false,
    );
    if (!capability.capabilityToken) throw new Error("Vision bridge did not grant a capability");
    this.capability = capability.capabilityToken;
  }

  private async withInitialization<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.cancelInitialization();
    const controller = new AbortController();
    this.initializationController = controller;
    try {
      return await operation(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Camera initialization was cancelled.");
      throw error;
    } finally {
      if (this.initializationController === controller) this.initializationController = null;
    }
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
