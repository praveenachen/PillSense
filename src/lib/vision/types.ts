export const VISION_SOURCE = "WINDOWS_OPENCV_MEDIAPIPE" as const;

export const observationTypes = [
  "CAMERA_STARTED",
  "CAMERA_STOPPED",
  "PERSON_VISIBLE",
  "PERSON_NOT_VISIBLE",
  "HAND_AT_MOUTH_DETECTED",
  "CAMERA_ERROR",
] as const;

export type ObservationType = (typeof observationTypes)[number];
export type LocalSessionStatus = "ACTIVE" | "STOPPED" | "ERROR" | "EXPIRED";

export type VisionObservation = {
  eventId: string;
  sessionId: string;
  timestamp: number;
  type: ObservationType;
  source: typeof VISION_SOURCE;
  diagnostic?: string;
};

export type VisionSnapshot = {
  sessionId: string;
  status: LocalSessionStatus;
  events: VisionObservation[];
};

const validTypes = new Set<string>(observationTypes);

export function parseVisionSnapshot(value: unknown): VisionSnapshot {
  if (!value || typeof value !== "object") throw new Error("Invalid vision bridge response");
  const data = value as Record<string, unknown>;
  if (typeof data.sessionId !== "string" || !["ACTIVE", "STOPPED", "ERROR", "EXPIRED"].includes(String(data.status))) {
    throw new Error("Invalid vision session response");
  }
  if (!Array.isArray(data.events)) throw new Error("Invalid vision event list");
  const events = data.events.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid vision event");
    const event = raw as Record<string, unknown>;
    if (
      typeof event.eventId !== "string" || event.sessionId !== data.sessionId ||
      typeof event.timestamp !== "number" || !validTypes.has(String(event.type)) ||
      event.source !== VISION_SOURCE ||
      (event.diagnostic !== undefined && typeof event.diagnostic !== "string")
    ) throw new Error("Invalid vision event");
    return event as VisionObservation;
  });
  return { sessionId: data.sessionId, status: data.status as LocalSessionStatus, events };
}

export function createVisionSessionId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `vision_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
