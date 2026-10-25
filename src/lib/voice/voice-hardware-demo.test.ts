import { describe, expect, it, vi } from "vitest";
import type { ArduinoMotorResult, ArduinoMotorResultKind } from "../dispenser/ble-protocol";
import { runVoiceHardwareDemo, type VoiceHardwareDependencies } from "./voice-hardware-demo";

const operationId = "VH1234567890";
const motorResult = (kind: ArduinoMotorResultKind): ArduinoMotorResult => ({
  kind,
  operationId,
  response: `${kind},${operationId}`,
  observedAt: new Date(0).toISOString(),
  trustedPhysicalEvidence: false,
});

function dependencies(overrides: Partial<VoiceHardwareDependencies> = {}) {
  const events: string[] = [];
  const deps: VoiceHardwareDependencies = {
    occurrenceId: "occurrence-1",
    connectionId: "connection-1",
    isConnected: () => true,
    prepare: vi.fn(async () => ({ commandId: operationId, operationId, slot: 6, shouldDispatch: true, status: "AUTHORIZED" as const })),
    markDispatched: vi.fn(async () => ({ shouldSend: true })),
    dispatch: vi.fn(async () => motorResult("DONE")),
    reconcile: vi.fn(async () => motorResult("DONE")),
    record: vi.fn(async ({ type }) => { events.push(type); }),
    wait: vi.fn(async () => undefined),
    maxReconciliations: 2,
    ...overrides,
  };
  return { deps, events };
}

describe("voice hardware demo orchestrator", () => {
  it("dispatches one MOVE and persists STARTED then DONE from read-only reconciliation", async () => {
    const { deps, events } = dependencies({
      dispatch: vi.fn(async () => motorResult("STARTED")),
      reconcile: vi.fn(async () => motorResult("DONE")),
    });
    await expect(runVoiceHardwareDemo(deps)).resolves.toMatchObject({ stage: "COMPLETED", operationId });
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(deps.reconcile).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["MOTOR_STARTED", "MOTOR_COMPLETED"]);
  });

  it("blocks an unavailable connection before backend preparation", async () => {
    const { deps } = dependencies({ isConnected: () => false });
    await expect(runVoiceHardwareDemo(deps)).rejects.toThrow("No movement command was sent");
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it("restores the armed GATT connection before server preparation without dispatching early", async () => {
    let connected = false;
    const ensureConnected = vi.fn(async () => {
      connected = true;
      return true;
    });
    const { deps } = dependencies({
      isConnected: () => connected,
      ensureConnected,
    });

    await expect(runVoiceHardwareDemo(deps)).resolves.toMatchObject({ stage: "COMPLETED" });
    expect(ensureConnected).toHaveBeenCalledTimes(1);
    expect(deps.prepare).toHaveBeenCalledTimes(1);
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a permitted-device reconnect does not restore READY GATT", async () => {
    const { deps } = dependencies({
      isConnected: () => false,
      ensureConnected: vi.fn(async () => false),
    });

    await expect(runVoiceHardwareDemo(deps)).rejects.toThrow("could not be restored");
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it("does not dispatch when the server rejects an unarmed session", async () => {
    const { deps } = dependencies({ prepare: vi.fn(async () => { throw new Error("not armed"); }) });
    await expect(runVoiceHardwareDemo(deps)).rejects.toThrow("not armed");
    expect(deps.markDispatched).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it("rejects a server response for the wrong slot", async () => {
    const { deps } = dependencies({
      prepare: vi.fn(async () => ({ commandId: operationId, operationId, slot: 4, shouldDispatch: true, status: "AUTHORIZED" as const })),
    });
    await expect(runVoiceHardwareDemo(deps)).rejects.toThrow("fixed Slot 6");
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it("persists UNKNOWN without retrying MOVE", async () => {
    const { deps, events } = dependencies({ dispatch: vi.fn(async () => motorResult("UNKNOWN")) });
    await expect(runVoiceHardwareDemo(deps)).resolves.toMatchObject({ stage: "UNKNOWN" });
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(deps.reconcile).not.toHaveBeenCalled();
    expect(events).toEqual(["UNKNOWN"]);
  });

  it("records disconnect after STARTED and never repeats MOVE", async () => {
    let connected = true;
    const { deps, events } = dependencies({
      isConnected: () => connected,
      dispatch: vi.fn(async () => { connected = false; return motorResult("STARTED"); }),
    });
    await expect(runVoiceHardwareDemo(deps)).resolves.toMatchObject({ stage: "UNKNOWN" });
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["MOTOR_STARTED", "DISCONNECTED"]);
  });

  it("does not repeat a movement after refresh or a completed command", async () => {
    const { deps } = dependencies({
      prepare: vi.fn(async () => ({ commandId: operationId, operationId, slot: 6, shouldDispatch: false, status: "COMPLETED" as const })),
    });
    await expect(runVoiceHardwareDemo(deps)).resolves.toMatchObject({ stage: "COMPLETED", alreadyPersisted: true });
    expect(deps.markDispatched).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
  });
});
