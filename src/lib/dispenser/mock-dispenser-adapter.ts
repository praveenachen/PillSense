import type { DispenserAdapter } from "./adapter";
import { isSlotId } from "./types";
import type {
  DeviceStatus,
  DispenseCommand,
  DispenseEvent,
  DispenseOutcome,
} from "./types";

/** In-memory simulator. Its control methods are intentionally outside the transport interface. */
export class MockDispenserAdapter implements DispenserAdapter {
  private status: DeviceStatus = {
    state: "CALIBRATION_REQUIRED",
    connected: true,
    homeAligned: false,
    activeCommandId: null,
    faultCode: null,
  };

  private readonly results = new Map<string, DispenseEvent>();
  private lastResult: DispenseEvent | null = null;
  private nextOutcome: DispenseOutcome = "COMPLETED";
  private motorOperations = 0;

  async connect(): Promise<DeviceStatus> {
    this.status.connected = true;
    this.status.state = this.status.faultCode
      ? "FAULT"
      : this.status.homeAligned
        ? "READY"
        : "CALIBRATION_REQUIRED";
    return this.snapshotStatus();
  }

  async getStatus(): Promise<DeviceStatus> {
    return this.snapshotStatus();
  }

  async confirmHomeAligned(): Promise<DeviceStatus> {
    if (!this.status.connected) {
      return this.snapshotStatus();
    }

    this.status.homeAligned = true;
    if (!this.status.faultCode) {
      this.status.state = "READY";
    }
    return this.snapshotStatus();
  }

  async dispense(command: DispenseCommand): Promise<DispenseEvent> {
    const duplicate = this.results.get(command.commandId);
    if (duplicate) {
      return { ...duplicate };
    }

    if (!command.commandId.trim()) {
      return this.record(command, "REJECTED", "NOT_STARTED", "commandId is required");
    }

    if (!isSlotId(command.slotId)) {
      return this.record(command, "REJECTED", "NOT_STARTED", "slot must be 1 through 7");
    }

    if (!this.status.connected) {
      return this.record(command, "REJECTED", "NOT_STARTED", "device is disconnected");
    }

    if (!this.status.homeAligned || this.status.state === "CALIBRATION_REQUIRED") {
      return this.record(command, "REJECTED", "NOT_STARTED", "manual home alignment is required");
    }

    if (this.status.state !== "READY") {
      return this.record(command, "REJECTED", "NOT_STARTED", "device is not ready");
    }

    this.status.state = "DISPENSING";
    this.status.activeCommandId = command.commandId;
    this.motorOperations += 1;

    const outcome = this.nextOutcome;
    this.nextOutcome = "COMPLETED";
    const motorCompletion = outcome === "COMPLETED" ? "COMPLETED" : "UNKNOWN";
    const event = this.record(
      command,
      outcome,
      motorCompletion,
      outcome === "UNKNOWN" ? "motor result was not acknowledged" : undefined,
    );

    this.status.activeCommandId = null;
    if (outcome === "UNKNOWN") {
      this.status.state = "FAULT";
      this.status.faultCode = "AMBIGUOUS_RESULT";
    } else {
      this.status.state = "READY";
    }

    return event;
  }

  async getLastResult(): Promise<DispenseEvent | null> {
    return this.lastResult ? { ...this.lastResult } : null;
  }

  simulateDisconnect(): void {
    this.status = {
      state: "DISCONNECTED",
      connected: false,
      homeAligned: false,
      activeCommandId: null,
      faultCode: null,
    };
  }

  simulateFault(code = "SIMULATED_FAULT"): void {
    this.status.state = "FAULT";
    this.status.faultCode = code;
    this.status.activeCommandId = null;
  }

  clearFault(): void {
    this.status.faultCode = null;
    this.status.homeAligned = false;
    this.status.state = this.status.connected ? "CALIBRATION_REQUIRED" : "DISCONNECTED";
  }

  simulateNextOutcome(outcome: DispenseOutcome): void {
    this.nextOutcome = outcome;
  }

  getSimulatedMotorOperationCount(): number {
    return this.motorOperations;
  }

  private record(
    command: DispenseCommand,
    outcome: DispenseOutcome,
    motorCompletion: DispenseEvent["motorCompletion"],
    reason?: string,
  ): DispenseEvent {
    const event: DispenseEvent = {
      commandId: command.commandId,
      slotId: command.slotId,
      outcome,
      motorCompletion,
      // Motor completion alone cannot prove any of these physical/user events.
      pillRelease: "UNKNOWN",
      pillCollection: "UNKNOWN",
      ingestion: "UNKNOWN",
      occurredAt: new Date().toISOString(),
      ...(reason ? { reason } : {}),
    };
    this.results.set(command.commandId, event);
    this.lastResult = event;
    return { ...event };
  }

  private snapshotStatus(): DeviceStatus {
    return { ...this.status };
  }
}
