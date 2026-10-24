import type { DeviceState } from "./types";

/**
 * Provisional status-only ArduinoBLE contract verified with the Uno R4 WiFi.
 * Keep these values together until the firmware protocol is finalized.
 */
export const PILLSENSE_BLE = {
  deviceName: "PillSense",
  serviceUuid: "19b10000-e8f2-537e-4f6c-d104768a1214",
  commandCharacteristicUuid: "19b10001-e8f2-537e-4f6c-d104768a1214",
  statusCharacteristicUuid: "19b10002-e8f2-537e-4f6c-d104768a1214",
  getStatusCommand: "GET_STATUS",
  getLastResultCommand: "GET_LAST_RESULT",
  supervisedMotorSlot: 6,
  operationIdMaxLength: 12,
  statusReadDelayMs: 150,
  reconciliationRetryDelayMs: 250,
  reconciliationAttempts: 3,
  notificationHistoryLimit: 16,
} as const;

export type ArduinoMotorResultKind = "STARTED" | "DONE" | "UNKNOWN" | "REJECTED";

export type ArduinoMotorResult = {
  kind: ArduinoMotorResultKind;
  operationId: string | null;
  response: string;
  observedAt: string;
  /** A browser observation is not authenticated hardware evidence. */
  trustedPhysicalEvidence: false;
};

const operationIdPattern = /^[A-Za-z0-9]{1,12}$/;

export function isValidArduinoOperationId(value: string): boolean {
  return operationIdPattern.test(value);
}

export function normalizeArduinoOperationId(value: string): string {
  if (!isValidArduinoOperationId(value)) {
    throw new Error("Arduino operation IDs must be 1-12 alphanumeric characters.");
  }
  return value.toUpperCase();
}

export function createArduinoOperationId(randomUuid = globalThis.crypto.randomUUID()): string {
  const operationId = randomUuid.replaceAll("-", "").slice(0, PILLSENSE_BLE.operationIdMaxLength);
  return normalizeArduinoOperationId(operationId);
}

export function buildSlot6MoveCommand(operationId: string): string {
  return `MOVE,${PILLSENSE_BLE.supervisedMotorSlot},${normalizeArduinoOperationId(operationId)}`;
}

export function decodeBleText(value: DataView): string {
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .replaceAll("\0", "")
    .trim();
}

export function parseArduinoMotorResult(value: DataView): ArduinoMotorResult {
  const response = decodeBleText(value);
  const [kind, operationId, ...detail] = response.split(",");

  if (kind === "REJECTED") {
    const rejectedId = operationId && isValidArduinoOperationId(operationId)
      ? normalizeArduinoOperationId(operationId)
      : null;
    return {
      kind,
      operationId: rejectedId,
      response: [kind, operationId, ...detail].filter(Boolean).join(","),
      observedAt: new Date().toISOString(),
      trustedPhysicalEvidence: false,
    };
  }

  if (
    (kind !== "STARTED" && kind !== "DONE" && kind !== "UNKNOWN") ||
    detail.length > 0 ||
    !operationId ||
    !isValidArduinoOperationId(operationId)
  ) {
    throw new Error("Arduino returned an invalid motor result.");
  }

  return {
    kind,
    operationId: normalizeArduinoOperationId(operationId),
    response,
    observedAt: new Date().toISOString(),
    trustedPhysicalEvidence: false,
  };
}

const reportedStates = new Set<DeviceState>([
  "CALIBRATION_REQUIRED",
  "READY",
  "DISPENSING",
  "FAULT",
]);

export function parseReportedDeviceState(value: DataView): DeviceState {
  const response = decodeBleText(value);

  if (!reportedStates.has(response as DeviceState)) {
    throw new Error("Arduino returned an unsupported device status.");
  }

  return response as DeviceState;
}
