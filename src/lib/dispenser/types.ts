export const SLOT_IDS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Physical medication positions. Position 0 is reserved for manual homing. */
export type SlotId = (typeof SLOT_IDS)[number];

export function isSlotId(value: unknown): value is SlotId {
  return typeof value === "number" && SLOT_IDS.some((slot) => slot === value);
}

export function toSlotId(value: number): SlotId {
  if (!isSlotId(value)) {
    throw new RangeError("A medication slot must be an integer from 1 through 7.");
  }

  return value;
}

export type DeviceState =
  | "DISCONNECTED"
  | "CALIBRATION_REQUIRED"
  | "READY"
  | "DISPENSING"
  | "FAULT";

export interface DispenseCommand {
  /** Stable idempotency key. A caller must reuse it for the same logical request. */
  commandId: string;
  slotId: SlotId;
  requestedAt: string;
}

export type DispenseOutcome = "COMPLETED" | "REJECTED" | "UNKNOWN";

export interface DispenseEvent {
  commandId: string;
  slotId: SlotId;
  outcome: DispenseOutcome;
  motorCompletion: "COMPLETED" | "NOT_STARTED" | "UNKNOWN";
  pillRelease: "CONFIRMED" | "NOT_CONFIRMED" | "UNKNOWN";
  pillCollection: "CONFIRMED" | "NOT_CONFIRMED" | "UNKNOWN";
  ingestion: "CONFIRMED" | "NOT_CONFIRMED" | "UNKNOWN";
  occurredAt: string;
  reason?: string;
}

export interface DoseOccurrence {
  occurrenceId: string;
  slotId: SlotId;
  scheduledFor: string;
  commandId: string | null;
  status: "SCHEDULED" | "DISPENSE_REQUESTED" | "DISPENSED" | "MISSED" | "UNKNOWN";
}

export interface DeviceStatus {
  state: DeviceState;
  connected: boolean;
  homeAligned: boolean;
  activeCommandId: string | null;
  faultCode: string | null;
}
