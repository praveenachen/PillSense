import {
  PILLSENSE_BLE,
  buildSlot6MoveCommand,
  decodeBleText,
  normalizeArduinoOperationId,
  parseArduinoMotorResult,
  parseReportedDeviceState,
  type ArduinoMotorResult,
} from "./ble-protocol";
import type { DeviceState } from "./types";

export type ArduinoStatusReading = {
  response: DeviceState;
  observedAt: string;
  /** A browser observation is not trusted evidence of physical position or motor state. */
  trustedPhysicalEvidence: false;
};

export type BluetoothRequestOptionsLike = {
  filters: Array<{ name: string; services: string[] }>;
  optionalServices: string[];
};

export interface BluetoothCharacteristicLike {
  writeValueWithResponse?: (value: Uint8Array) => Promise<void>;
  writeValue?: (value: Uint8Array) => Promise<void>;
  readValue(): Promise<DataView>;
  startNotifications?: () => Promise<BluetoothCharacteristicLike>;
  addEventListener?: (
    type: "characteristicvaluechanged",
    listener: (event: BluetoothCharacteristicValueChangedEventLike) => void,
  ) => void;
  removeEventListener?: (
    type: "characteristicvaluechanged",
    listener: (event: BluetoothCharacteristicValueChangedEventLike) => void,
  ) => void;
}

export type BluetoothCharacteristicValueChangedEventLike = {
  target: { value?: DataView } | null;
};

export interface BluetoothServiceLike {
  getCharacteristic(uuid: string): Promise<BluetoothCharacteristicLike>;
}

export interface BluetoothServerLike {
  connected: boolean;
  getPrimaryService(uuid: string): Promise<BluetoothServiceLike>;
  disconnect?: () => void;
}

export interface BluetoothDeviceLike {
  id?: string;
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<BluetoothServerLike>;
    disconnect(): void;
  };
  addEventListener(type: "gattserverdisconnected", listener: () => void): void;
  removeEventListener(type: "gattserverdisconnected", listener: () => void): void;
}

export interface WebBluetoothLike {
  requestDevice(options: BluetoothRequestOptionsLike): Promise<BluetoothDeviceLike>;
  getDevices?: () => Promise<BluetoothDeviceLike[]>;
}

type TransportOptions = {
  bluetooth?: WebBluetoothLike;
  delay?: (milliseconds: number) => Promise<void>;
  diagnostic?: (entry: H3DiagnosticEntry) => void;
};

export type H3DiagnosticEntry = {
  event:
    | "ble_write_started"
    | "ble_write_resolved"
    | "ble_write_rejected"
    | "motor_dispatch_lock_armed"
    | "status_notification_received"
    | "get_last_result_response_received"
    | "motor_result_correlated"
    | "firmware_rejected"
    | "parser_or_reconciliation_failed";
  command?: "GET_STATUS" | "GET_LAST_RESULT" | "MOVE_SLOT_6";
  operationId?: string;
  response?: string;
  attempt?: number;
  writeAccepted?: boolean;
  errorName?: string;
  errorMessage?: string;
};

export type ArduinoMotorDispatchStage =
  | "COMMAND_NOT_SENT"
  | "WRITE_REJECTED_DELIVERY_UNCERTAIN"
  | "WRITE_ACCEPTED_EXECUTION_UNCONFIRMED";

function browserBluetooth(): WebBluetoothLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { bluetooth?: WebBluetoothLike }).bluetooth;
}

function defaultDelay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

export class ArduinoMotorOutcomeUncertainError extends Error {
  constructor(
    message: string,
    readonly dispatchStage: ArduinoMotorDispatchStage = "WRITE_ACCEPTED_EXECUTION_UNCONFIRMED",
  ) {
    super(message);
    this.name = "ArduinoMotorOutcomeUncertainError";
  }
}

/** Browser-only transport for status and one guarded Slot 6 hardware test. */
export class WebBluetoothDispenserStatusTransport {
  private readonly suppliedBluetooth: WebBluetoothLike | undefined;
  private readonly delay: (milliseconds: number) => Promise<void>;
  private readonly diagnostic: ((entry: H3DiagnosticEntry) => void) | undefined;
  private device: BluetoothDeviceLike | null = null;
  private server: BluetoothServerLike | null = null;
  private commandCharacteristic: BluetoothCharacteristicLike | null = null;
  private statusCharacteristic: BluetoothCharacteristicLike | null = null;
  private motorCommandDispatched = false;
  private readonly notificationResponses: string[] = [];
  private readonly connectionListeners = new Set<(connected: boolean) => void>();

  constructor(options: TransportOptions = {}) {
    this.suppliedBluetooth = options.bluetooth;
    this.delay = options.delay ?? defaultDelay;
    this.diagnostic = options.diagnostic;
  }

  isSupported(): boolean {
    return Boolean(this.suppliedBluetooth ?? browserBluetooth());
  }

  isConnected(): boolean {
    return Boolean(this.server?.connected && this.device?.gatt?.connected);
  }

  subscribe(listener: (connected: boolean) => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  async connect(): Promise<void> {
    const bluetooth = this.suppliedBluetooth ?? browserBluetooth();
    if (!bluetooth) {
      throw new Error("Web Bluetooth is unavailable. Use desktop Chrome on HTTPS or localhost.");
    }

    const device = await bluetooth.requestDevice({
      filters: [{ name: PILLSENSE_BLE.deviceName, services: [PILLSENSE_BLE.serviceUuid] }],
      optionalServices: [PILLSENSE_BLE.serviceUuid],
    });
    await this.connectDevice(device, true);
  }

  /**
   * Reconnects only a device for which this origin already has permission.
   * It never opens the chooser and never writes a motor command.
   */
  async reconnectPreviouslyAuthorizedDevice(expectedDeviceId: string): Promise<void> {
    const bluetooth = this.suppliedBluetooth ?? browserBluetooth();
    if (!bluetooth) {
      throw new Error("Web Bluetooth is unavailable. Use desktop Chrome on HTTPS or localhost.");
    }
    if (this.isConnected() && this.device?.id === expectedDeviceId) return;

    let device = this.device?.id === expectedDeviceId ? this.device : null;
    if (!device) {
      if (!bluetooth.getDevices) {
        throw new Error("Chrome cannot restore the previously paired Arduino in this browser session.");
      }
      const permitted = await bluetooth.getDevices();
      device = permitted.find((candidate) => candidate.id === expectedDeviceId) ?? null;
    }
    if (!device) {
      throw new Error("The previously paired Arduino is no longer authorized for this site.");
    }
    await this.connectDevice(device, false);
  }

  getDeviceId(): string | null {
    return this.device?.id ?? null;
  }

  async getStatus(): Promise<ArduinoStatusReading> {
    try {
      await this.writeCommand(PILLSENSE_BLE.getStatusCommand);
      await this.delay(PILLSENSE_BLE.statusReadDelayMs);
      const value = await this.readStatusValue();
      return {
        response: parseReportedDeviceState(value),
        observedAt: new Date().toISOString(),
        trustedPhysicalEvidence: false,
      };
    } catch (error) {
      this.handleOperationError();
      throw error;
    }
  }

  hasDispatchedMotorCommand(): boolean {
    return this.motorCommandDispatched;
  }

  async runSupervisedSlot6MotorTest(operationId: string): Promise<ArduinoMotorResult> {
    this.requireConnection("running the supervised motor test");
    if (this.motorCommandDispatched) {
      throw new Error("A motor test was already dispatched in this page session. It will not be resent.");
    }

    const command = buildSlot6MoveCommand(operationId);
    const expectedOperationId = normalizeArduinoOperationId(operationId);
    const notificationStart = this.notificationResponses.length;
    // Lock before the first asynchronous write. It intentionally survives reconnects.
    this.motorCommandDispatched = true;
    this.emitDiagnostic({
      event: "motor_dispatch_lock_armed",
      command: "MOVE_SLOT_6",
      operationId: expectedOperationId,
      writeAccepted: false,
    });
    let writeAccepted = false;
    try {
      await this.writeCommand(command);
      writeAccepted = true;
      await this.delay(PILLSENSE_BLE.statusReadDelayMs);
      const notified = this.findNotifiedMotorResult(expectedOperationId, notificationStart);
      if (notified) return this.recordMotorResult(notified);

      const result = parseArduinoMotorResult(await this.readStatusValue());
      this.requireMatchingOperation(result, expectedOperationId);
      return this.recordMotorResult(result);
    } catch (error) {
      this.handleOperationError();
      this.emitDiagnostic({
        event: "parser_or_reconciliation_failed",
        command: "MOVE_SLOT_6",
        operationId: expectedOperationId,
        writeAccepted,
        ...this.safeError(error),
      });
      throw new ArduinoMotorOutcomeUncertainError(
        writeAccepted
          ? "The BLE write was accepted, but motor execution is unconfirmed. Do not resend MOVE; use Get last result."
          : "The BLE write was rejected, so delivery is uncertain. Do not resend MOVE; reconnect and use Get last result.",
        writeAccepted
          ? "WRITE_ACCEPTED_EXECUTION_UNCONFIRMED"
          : "WRITE_REJECTED_DELIVERY_UNCERTAIN",
      );
    }
  }

  async getLastMotorResult(operationId: string): Promise<ArduinoMotorResult> {
    this.requireConnection("reconciling the motor result");
    const expectedOperationId = normalizeArduinoOperationId(operationId);
    let latestStarted: ArduinoMotorResult | null = null;
    try {
      for (let attempt = 0; attempt < PILLSENSE_BLE.reconciliationAttempts; attempt += 1) {
        await this.writeCommand(PILLSENSE_BLE.getLastResultCommand);
        await this.delay(PILLSENSE_BLE.statusReadDelayMs);

        const notified = this.findNotifiedMotorResult(expectedOperationId, 0);
        if (notified?.kind === "STARTED") latestStarted = notified;
        else if (notified) return this.recordMotorResult(notified);

        const value = await this.readStatusValue();
        this.emitDiagnostic({
          event: "get_last_result_response_received",
          command: "GET_LAST_RESULT",
          operationId: expectedOperationId,
          response: this.safeResponse(decodeBleText(value)),
          attempt: attempt + 1,
        });
        const result = this.parseReconciliationValue(value, expectedOperationId);
        if (result?.kind === "STARTED") latestStarted = result;
        else if (result) return this.recordMotorResult(result);

        if (attempt + 1 < PILLSENSE_BLE.reconciliationAttempts) {
          await this.delay(PILLSENSE_BLE.reconciliationRetryDelayMs);
        }
      }

      if (latestStarted) return this.recordMotorResult(latestStarted);
      throw new ArduinoMotorOutcomeUncertainError(
        "No correlated motor result is available yet. READY is not completion; Get last result may be queried again without resending MOVE.",
      );
    } catch (error) {
      this.handleOperationError();
      this.emitDiagnostic({
        event: "parser_or_reconciliation_failed",
        command: "GET_LAST_RESULT",
        operationId: expectedOperationId,
        ...this.safeError(error),
      });
      throw error;
    }
  }

  private async writeCommand(commandText: string): Promise<void> {
    this.requireConnection("using the Arduino");
    const commandCharacteristic = this.commandCharacteristic!;
    const command = new TextEncoder().encode(commandText);
    const diagnosticCommand = this.describeCommand(commandText);
    this.emitDiagnostic({ event: "ble_write_started", ...diagnosticCommand });
    try {
      if (commandCharacteristic.writeValueWithResponse) {
        await commandCharacteristic.writeValueWithResponse(command);
      } else if (commandCharacteristic.writeValue) {
        await commandCharacteristic.writeValue(command);
      } else {
        throw new Error("The Arduino command characteristic does not support writes.");
      }
      this.emitDiagnostic({ event: "ble_write_resolved", ...diagnosticCommand });
    } catch (error) {
      this.emitDiagnostic({
        event: "ble_write_rejected",
        ...diagnosticCommand,
        ...this.safeError(error),
      });
      this.clearConnection();
      this.notifyConnection(false);
      throw error;
    }
  }

  private async readStatusValue(): Promise<DataView> {
    this.requireConnection("reading the Arduino response");
    try {
      return await this.statusCharacteristic!.readValue();
    } catch (error) {
      this.clearConnection();
      this.notifyConnection(false);
      throw error;
    }
  }

  private parseReconciliationValue(
    value: DataView,
    expectedOperationId: string,
  ): ArduinoMotorResult | null {
    const response = decodeBleText(value);
    if (response === "READY" || response === "DISPENSING") return null;

    const result = parseArduinoMotorResult(value);
    this.requireMatchingOperation(result, expectedOperationId);
    return result;
  }

  private findNotifiedMotorResult(
    expectedOperationId: string,
    startIndex: number,
  ): ArduinoMotorResult | null {
    for (let index = this.notificationResponses.length - 1; index >= startIndex; index -= 1) {
      try {
        const result = parseArduinoMotorResult(this.textDataView(this.notificationResponses[index]));
        if (result.operationId === expectedOperationId) return result;
      } catch {
        // READY and unrelated shared-characteristic notifications are not motor results.
      }
    }
    return null;
  }

  private textDataView(text: string): DataView {
    const bytes = new TextEncoder().encode(text);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private async enableStatusNotifications(characteristic: BluetoothCharacteristicLike) {
    if (!characteristic.startNotifications || !characteristic.addEventListener) return;
    characteristic.addEventListener("characteristicvaluechanged", this.handleStatusNotification);
    try {
      await characteristic.startNotifications();
    } catch {
      characteristic.removeEventListener?.("characteristicvaluechanged", this.handleStatusNotification);
    }
  }

  private async connectDevice(device: BluetoothDeviceLike, replaceDevice: boolean) {
    if (!device.gatt) throw new Error("The selected device does not expose a Bluetooth GATT server.");
    // Re-selecting the same live Arduino must not tear down its GATT connection.
    if (device.id && this.isConnected() && this.device?.id === device.id) return;
    if (replaceDevice) this.detachDevice();
    else {
      this.statusCharacteristic?.removeEventListener?.(
        "characteristicvaluechanged",
        this.handleStatusNotification,
      );
      this.clearConnection();
    }

    this.device?.removeEventListener("gattserverdisconnected", this.handleDisconnected);
    this.device = device;
    device.addEventListener("gattserverdisconnected", this.handleDisconnected);
    try {
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(PILLSENSE_BLE.serviceUuid);
      const [commandCharacteristic, statusCharacteristic] = await Promise.all([
        service.getCharacteristic(PILLSENSE_BLE.commandCharacteristicUuid),
        service.getCharacteristic(PILLSENSE_BLE.statusCharacteristicUuid),
      ]);
      this.server = server;
      this.commandCharacteristic = commandCharacteristic;
      this.statusCharacteristic = statusCharacteristic;
      await this.enableStatusNotifications(statusCharacteristic);
      this.notifyConnection(true);
    } catch (error) {
      device.gatt.disconnect();
      this.clearConnection();
      this.notifyConnection(false);
      throw error;
    }
  }

  private readonly handleStatusNotification = (event: BluetoothCharacteristicValueChangedEventLike) => {
    if (!event.target?.value) return;
    try {
      const response = decodeBleText(event.target.value);
      this.emitDiagnostic({
        event: "status_notification_received",
        response: this.safeResponse(response),
      });
      this.notificationResponses.push(response);
      if (this.notificationResponses.length > PILLSENSE_BLE.notificationHistoryLimit) {
        this.notificationResponses.shift();
      }
    } catch {
      // Invalid UTF-8 is ignored here and remains fail-closed on an explicit read.
    }
  };

  private requireConnection(action: string) {
    if (!this.isConnected() || !this.commandCharacteristic || !this.statusCharacteristic) {
      throw new Error(`Connect to the PillSense Arduino before ${action}.`);
    }
  }

  private requireMatchingOperation(result: ArduinoMotorResult, expectedOperationId: string) {
    if (result.operationId !== normalizeArduinoOperationId(expectedOperationId)) {
      throw new ArduinoMotorOutcomeUncertainError(
        "The Arduino result did not match this test's operation ID. Treat the outcome as uncertain.",
      );
    }
  }

  private recordMotorResult(result: ArduinoMotorResult): ArduinoMotorResult {
    this.emitDiagnostic({
      event: result.kind === "REJECTED" ? "firmware_rejected" : "motor_result_correlated",
      operationId: result.operationId ?? undefined,
      response: this.safeResponse(result.response),
    });
    return result;
  }

  private describeCommand(commandText: string): Pick<H3DiagnosticEntry, "command" | "operationId"> {
    if (commandText.startsWith("MOVE,6,")) {
      return {
        command: "MOVE_SLOT_6",
        operationId: commandText.slice("MOVE,6,".length),
      };
    }
    return {
      command: commandText === PILLSENSE_BLE.getLastResultCommand
        ? "GET_LAST_RESULT"
        : "GET_STATUS",
    };
  }

  private safeResponse(response: string): string {
    return /^[A-Za-z0-9,_-]{1,64}$/.test(response) ? response : "[INVALID_BLE_RESPONSE]";
  }

  private safeError(error: unknown): Pick<H3DiagnosticEntry, "errorName" | "errorMessage"> {
    if (!(error instanceof Error)) return { errorName: "UnknownError" };
    return {
      errorName: error.name,
      errorMessage: error.message.slice(0, 160),
    };
  }

  private emitDiagnostic(entry: H3DiagnosticEntry) {
    this.diagnostic?.(entry);
  }

  private handleOperationError() {
    if (!this.server?.connected || !this.device?.gatt?.connected) {
      this.clearConnection();
      this.notifyConnection(false);
    }
  }

  private readonly handleDisconnected = () => {
    this.clearConnection();
    this.notifyConnection(false);
  };

  private notifyConnection(connected: boolean) {
    for (const listener of this.connectionListeners) listener(connected);
  }

  private detachDevice() {
    this.device?.removeEventListener("gattserverdisconnected", this.handleDisconnected);
    this.statusCharacteristic?.removeEventListener?.(
      "characteristicvaluechanged",
      this.handleStatusNotification,
    );
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.device = null;
    this.clearConnection();
  }

  private clearConnection() {
    this.server = null;
    this.commandCharacteristic = null;
    this.statusCharacteristic = null;
  }
}
