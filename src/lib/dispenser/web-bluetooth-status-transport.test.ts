import { describe, expect, it, vi } from "vitest";
import { PILLSENSE_BLE, buildSlot6MoveCommand, createArduinoOperationId } from "./ble-protocol";
import {
  ArduinoMotorOutcomeUncertainError,
  WebBluetoothDispenserStatusTransport,
  type BluetoothCharacteristicLike,
  type BluetoothDeviceLike,
  type BluetoothRequestOptionsLike,
  type H3DiagnosticEntry,
  type WebBluetoothLike,
} from "./web-bluetooth-status-transport";

function dataView(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function bluetoothFixture(options: {
  response?: string;
  responses?: string[];
  withResponse?: boolean;
  notificationsByCommand?: Record<string, string[]>;
  onWrite?: (command: string) => void | Promise<void>;
} = {}) {
  const trace: string[] = [];
  const writes: string[] = [];
  let disconnected: (() => void) | null = null;
  let characteristicChanged:
    | ((event: { target: { value?: DataView } }) => void)
    | null = null;
  let written: Uint8Array | null = null;
  async function recordWrite(value: Uint8Array, method: string) {
    trace.push(method);
    written = value;
    const text = new TextDecoder().decode(value);
    writes.push(text);
    await options.onWrite?.(text);
    for (const response of options.notificationsByCommand?.[text] ?? []) {
      characteristicChanged?.({ target: { value: dataView(response) } });
    }
  }
  const command: BluetoothCharacteristicLike = {
    ...(options.withResponse === false
      ? {
          writeValue: async (value: Uint8Array) => {
            await recordWrite(value, "writeValue");
          },
        }
      : {
          writeValueWithResponse: async (value: Uint8Array) => {
            await recordWrite(value, "writeValueWithResponse");
          },
        }),
    readValue: async () => dataView("unused"),
  };
  const status: BluetoothCharacteristicLike = {
    readValue: async () => {
      trace.push("readValue");
      return dataView(options.responses?.shift() ?? options.response ?? "CALIBRATION_REQUIRED");
    },
    startNotifications: async () => {
      trace.push("startNotifications");
      return status;
    },
    addEventListener: (_type, listener) => {
      characteristicChanged = listener;
    },
    removeEventListener: () => {
      characteristicChanged = null;
    },
  };
  const gatt = {
    connected: false,
    connect: async () => {
      trace.push("gatt.connect");
      gatt.connected = true;
      server.connected = true;
      return server;
    },
    disconnect: () => {
      gatt.connected = false;
    },
  };
  const server = {
    connected: true,
    getPrimaryService: async (uuid: string) => {
      trace.push(`service:${uuid}`);
      return {
        getCharacteristic: async (characteristicUuid: string) => {
          trace.push(`characteristic:${characteristicUuid}`);
          return characteristicUuid === PILLSENSE_BLE.commandCharacteristicUuid
            ? command
            : status;
        },
      };
    },
  };
  const device: BluetoothDeviceLike = {
    id: "permitted-pillsense-device",
    name: PILLSENSE_BLE.deviceName,
    gatt,
    addEventListener: (_type, listener) => {
      disconnected = listener;
    },
    removeEventListener: () => {
      disconnected = null;
    },
  };
  let requestOptions: BluetoothRequestOptionsLike | null = null;
  const bluetooth: WebBluetoothLike = {
    requestDevice: async (requested) => {
      trace.push("requestDevice");
      requestOptions = requested;
      return device;
    },
    getDevices: async () => {
      trace.push("getDevices");
      return [device];
    },
  };
  return {
    bluetooth,
    trace,
    getWritten: () => written,
    getWrites: () => writes,
    getRequestOptions: () => requestOptions,
    disconnect: () => {
      gatt.connected = false;
      server.connected = false;
      disconnected?.();
    },
  };
}

describe("WebBluetoothDispenserStatusTransport", () => {
  it("preserves a live GATT connection when the chooser returns the same device", async () => {
    const fixture = bluetoothFixture({ response: "READY" });
    const transport = new WebBluetoothDispenserStatusTransport({ bluetooth: fixture.bluetooth, delay: async () => undefined });
    await transport.connect();
    await transport.connect();
    expect(fixture.trace.filter((entry) => entry === "gatt.connect")).toHaveLength(1);
    expect(transport.isConnected()).toBe(true);
    expect((await transport.getStatus()).response).toBe("READY");
  });

  it("requests the verified PillSense service and discovers only status-path characteristics", async () => {
    const fixture = bluetoothFixture();
    const transport = new WebBluetoothDispenserStatusTransport({
      bluetooth: fixture.bluetooth,
      delay: async () => undefined,
    });

    await transport.connect();

    expect(fixture.trace[0]).toBe("requestDevice");
    expect(fixture.getRequestOptions()).toEqual({
      filters: [{ name: "PillSense", services: [PILLSENSE_BLE.serviceUuid] }],
      optionalServices: [PILLSENSE_BLE.serviceUuid],
    });
    expect(fixture.trace).toContain(`characteristic:${PILLSENSE_BLE.commandCharacteristicUuid}`);
    expect(fixture.trace).toContain(`characteristic:${PILLSENSE_BLE.statusCharacteristicUuid}`);
    expect("dispense" in transport).toBe(false);
    expect("confirmHomeAligned" in transport).toBe(false);
  });

  it("writes UTF-8 GET_STATUS with response and validates the reported status", async () => {
    const fixture = bluetoothFixture({ response: "CALIBRATION_REQUIRED\0\n" });
    const delay = vi.fn(async () => undefined);
    const transport = new WebBluetoothDispenserStatusTransport({
      bluetooth: fixture.bluetooth,
      delay,
    });
    await transport.connect();

    const reading = await transport.getStatus();

    const written = fixture.getWritten();
    expect(written).not.toBeNull();
    expect(new TextDecoder().decode(written!)).toBe("GET_STATUS");
    expect(fixture.trace).toContain("writeValueWithResponse");
    expect(delay).toHaveBeenCalledWith(150);
    expect(reading).toMatchObject({
      response: "CALIBRATION_REQUIRED",
      trustedPhysicalEvidence: false,
    });
  });

  it("uses the legacy write method only when writeValueWithResponse is unavailable", async () => {
    const fixture = bluetoothFixture({ withResponse: false });
    const transport = new WebBluetoothDispenserStatusTransport({
      bluetooth: fixture.bluetooth,
      delay: async () => undefined,
    });
    await transport.connect();

    await transport.getStatus();

    expect(fixture.trace).toContain("writeValue");
    expect(fixture.trace).not.toContain("writeValueWithResponse");
  });

  it("rejects unsupported status text instead of treating it as device evidence", async () => {
    const fixture = bluetoothFixture({ response: "MOTOR_OK" });
    const transport = new WebBluetoothDispenserStatusTransport({
      bluetooth: fixture.bluetooth,
      delay: async () => undefined,
    });
    await transport.connect();

    await expect(transport.getStatus()).rejects.toThrow("unsupported device status");
  });

  it("clears the connection when the GATT device disconnects", async () => {
    const fixture = bluetoothFixture();
    const transport = new WebBluetoothDispenserStatusTransport({
      bluetooth: fixture.bluetooth,
      delay: async () => undefined,
    });
    const listener = vi.fn();
    transport.subscribe(listener);
    await transport.connect();

    fixture.disconnect();

    expect(transport.isConnected()).toBe(false);
    expect(listener).toHaveBeenLastCalledWith(false);
    await expect(transport.getStatus()).rejects.toThrow("Connect to the PillSense Arduino");
  });

  it("restores only the previously authorized device without opening the chooser", async () => {
    const fixture = bluetoothFixture({ response: "READY" });
    const first = new WebBluetoothDispenserStatusTransport({
      bluetooth: fixture.bluetooth,
      delay: async () => undefined,
    });
    await first.connect();
    fixture.disconnect();

    const restored = new WebBluetoothDispenserStatusTransport({
      bluetooth: fixture.bluetooth,
      delay: async () => undefined,
    });
    await restored.reconnectPreviouslyAuthorizedDevice("permitted-pillsense-device");
    const reading = await restored.getStatus();

    expect(reading.response).toBe("READY");
    expect(fixture.trace.filter((entry) => entry === "requestDevice")).toHaveLength(1);
    expect(fixture.trace).toContain("getDevices");
    expect(fixture.getWrites()).toEqual(["GET_STATUS"]);
  });

  it("fails closed when the armed device identity is not among permitted devices", async () => {
    const fixture = bluetoothFixture();
    const transport = new WebBluetoothDispenserStatusTransport({
      bluetooth: fixture.bluetooth,
      delay: async () => undefined,
    });

    await expect(transport.reconnectPreviouslyAuthorizedDevice("different-device"))
      .rejects.toThrow("no longer authorized");
    expect(fixture.trace).not.toContain("requestDevice");
    expect(fixture.getWrites()).toEqual([]);
  });

  it("sends one Slot 6 MOVE and reconciles DONE with GET_LAST_RESULT", async () => {
    const fixture = bluetoothFixture({ responses: ["STARTED,abc123", "DONE,abc123"] });
    const transport = new WebBluetoothDispenserStatusTransport({
      bluetooth: fixture.bluetooth,
      delay: async () => undefined,
    });
    await transport.connect();

    const started = await transport.runSupervisedSlot6MotorTest("abc123");
    const done = await transport.getLastMotorResult("abc123");

    expect(started.kind).toBe("STARTED");
    expect(done.kind).toBe("DONE");
    expect(done.trustedPhysicalEvidence).toBe(false);
    expect(fixture.getWrites()).toEqual(["MOVE,6,ABC123", "GET_LAST_RESULT"]);
  });

  it("suppresses a duplicate motor dispatch in the same page session", async () => {
    const fixture = bluetoothFixture({ response: "STARTED,once123" });
    const transport = new WebBluetoothDispenserStatusTransport({
      bluetooth: fixture.bluetooth,
      delay: async () => undefined,
    });
    await transport.connect();

    await transport.runSupervisedSlot6MotorTest("once123");
    await expect(transport.runSupervisedSlot6MotorTest("twice456")).rejects.toThrow(
      "already dispatched",
    );

    expect(fixture.getWrites().filter((value) => value.startsWith("MOVE,"))).toEqual([
      "MOVE,6,ONCE123",
    ]);
  });

  it("makes a disconnect during movement uncertain without allowing a resend", async () => {
    const fixture = bluetoothFixture({ response: "STARTED,drop123" });
    const transport = new WebBluetoothDispenserStatusTransport({
      bluetooth: fixture.bluetooth,
      delay: async () => fixture.disconnect(),
    });
    await transport.connect();

    await expect(transport.runSupervisedSlot6MotorTest("drop123")).rejects.toThrow(
      "write was accepted, but motor execution is unconfirmed",
    );
    expect(transport.isConnected()).toBe(false);
    expect(transport.hasDispatchedMotorCommand()).toBe(true);
    await expect(transport.runSupervisedSlot6MotorTest("retry123")).rejects.toThrow(
      "Connect to the PillSense Arduino",
    );
    expect(fixture.getWrites()).toEqual(["MOVE,6,DROP123"]);
  });

  it("treats UNKNOWN and mismatched operation IDs as uncertain", async () => {
    const unknownFixture = bluetoothFixture({ response: "UNKNOWN,unk123" });
    const unknownTransport = new WebBluetoothDispenserStatusTransport({
      bluetooth: unknownFixture.bluetooth,
      delay: async () => undefined,
    });
    await unknownTransport.connect();
    expect((await unknownTransport.runSupervisedSlot6MotorTest("unk123")).kind).toBe("UNKNOWN");

    const mismatchFixture = bluetoothFixture({ response: "DONE,other123" });
    const mismatchTransport = new WebBluetoothDispenserStatusTransport({
      bluetooth: mismatchFixture.bluetooth,
      delay: async () => undefined,
    });
    await mismatchTransport.connect();
    await expect(mismatchTransport.runSupervisedSlot6MotorTest("wanted123")).rejects.toThrow(
      "write was accepted, but motor execution is unconfirmed",
    );
    expect(mismatchFixture.getWrites()).toEqual(["MOVE,6,WANTED123"]);
  });

  it("rejects invalid operation IDs before writing a motor command", async () => {
    const fixture = bluetoothFixture();
    const transport = new WebBluetoothDispenserStatusTransport({
      bluetooth: fixture.bluetooth,
      delay: async () => undefined,
    });
    await transport.connect();

    await expect(transport.runSupervisedSlot6MotorTest("invalid-id-too-long")).rejects.toThrow(
      "1-12 alphanumeric",
    );
    expect(fixture.getWrites()).toEqual([]);
    expect(transport.hasDispatchedMotorCommand()).toBe(false);
  });

  it("reconnects for read-only reconciliation without resending MOVE", async () => {
    const fixture = bluetoothFixture({ responses: ["STARTED,recon123", "DONE,recon123"] });
    const transport = new WebBluetoothDispenserStatusTransport({
      bluetooth: fixture.bluetooth,
      delay: async () => undefined,
    });
    await transport.connect();
    await transport.runSupervisedSlot6MotorTest("recon123");
    fixture.disconnect();

    await transport.connect();
    const result = await transport.getLastMotorResult("recon123");

    expect(result.kind).toBe("DONE");
    expect(fixture.getWrites()).toEqual(["MOVE,6,RECON123", "GET_LAST_RESULT"]);
    expect(transport.hasDispatchedMotorCommand()).toBe(true);
  });

  it("builds compact alphanumeric operation IDs and only the fixed Slot 6 command", () => {
    const operationId = createArduinoOperationId("12345678-90ab-cdef-1234-567890abcdef");
    expect(operationId).toBe("1234567890AB");
    expect(operationId).toMatch(/^[A-Za-z0-9]{1,12}$/);
    expect(buildSlot6MoveCommand(operationId)).toBe("MOVE,6,1234567890AB");
  });

  it("normalizes a lowercase browser ID to the firmware's uppercase ID", async () => {
    const fixture = bluetoothFixture({ response: "DONE,3C03FDC9962E" });
    const transport = new WebBluetoothDispenserStatusTransport({
      bluetooth: fixture.bluetooth,
      delay: async () => undefined,
    });
    await transport.connect();

    const result = await transport.runSupervisedSlot6MotorTest("3c03fdc9962e");

    expect(result.kind).toBe("DONE");
    expect(result.operationId).toBe("3C03FDC9962E");
    expect(fixture.getWrites()).toEqual(["MOVE,6,3C03FDC9962E"]);
  });

  it("ignores stale READY and safely repeats only GET_LAST_RESULT until late DONE", async () => {
    const fixture = bluetoothFixture({
      responses: ["STARTED,LATE123", "READY", "DONE,LATE123"],
    });
    const transport = new WebBluetoothDispenserStatusTransport({
      bluetooth: fixture.bluetooth,
      delay: async () => undefined,
    });
    await transport.connect();
    await transport.runSupervisedSlot6MotorTest("late123");

    const result = await transport.getLastMotorResult("late123");

    expect(result.kind).toBe("DONE");
    expect(fixture.getWrites()).toEqual([
      "MOVE,6,LATE123",
      "GET_LAST_RESULT",
      "GET_LAST_RESULT",
    ]);
  });

  it("waits for a blocking motor handler before accepting a late DONE", async () => {
    let releaseResult!: () => void;
    const motorFinished = new Promise<void>((resolve) => {
      releaseResult = resolve;
    });
    const fixture = bluetoothFixture({
      responses: ["STARTED,BLOCK123", "DONE,BLOCK123"],
      onWrite: async (command) => {
        if (command === "GET_LAST_RESULT") await motorFinished;
      },
    });
    const transport = new WebBluetoothDispenserStatusTransport({
      bluetooth: fixture.bluetooth,
      delay: async () => undefined,
    });
    await transport.connect();
    await transport.runSupervisedSlot6MotorTest("block123");

    const pending = transport.getLastMotorResult("block123");
    await Promise.resolve();
    expect(fixture.getWrites()).toEqual(["MOVE,6,BLOCK123", "GET_LAST_RESULT"]);
    releaseResult();

    await expect(pending).resolves.toMatchObject({ kind: "DONE", operationId: "BLOCK123" });
    expect(fixture.getWrites().filter((command) => command.startsWith("MOVE,"))).toHaveLength(1);
  });

  it("captures a correlated DONE notification before READY overwrites the shared value", async () => {
    const diagnostics: H3DiagnosticEntry[] = [];
    const fixture = bluetoothFixture({
      responses: ["STARTED,NOTE123", "READY"],
      notificationsByCommand: { GET_LAST_RESULT: ["DONE,NOTE123"] },
    });
    const transport = new WebBluetoothDispenserStatusTransport({
      bluetooth: fixture.bluetooth,
      delay: async () => undefined,
      diagnostic: (entry) => diagnostics.push(entry),
    });
    await transport.connect();
    await transport.runSupervisedSlot6MotorTest("note123");

    const result = await transport.getLastMotorResult("note123");

    expect(result.kind).toBe("DONE");
    expect(result.operationId).toBe("NOTE123");
    expect(fixture.trace).toContain("startNotifications");
    expect(diagnostics).toContainEqual(expect.objectContaining({
      event: "status_notification_received",
      response: "DONE,NOTE123",
    }));
    expect(fixture.getWrites()).toEqual(["MOVE,6,NOTE123", "GET_LAST_RESULT"]);
  });

  it("distinguishes an explicit correlated firmware rejection", async () => {
    const diagnostics: H3DiagnosticEntry[] = [];
    const fixture = bluetoothFixture({ response: "REJECTED,DENY123,ONE_PER_BOOT" });
    const transport = new WebBluetoothDispenserStatusTransport({
      bluetooth: fixture.bluetooth,
      delay: async () => undefined,
      diagnostic: (entry) => diagnostics.push(entry),
    });
    await transport.connect();

    const result = await transport.runSupervisedSlot6MotorTest("deny123");

    expect(result.kind).toBe("REJECTED");
    expect(result.operationId).toBe("DENY123");
    expect(diagnostics).toContainEqual(expect.objectContaining({
      event: "firmware_rejected",
      operationId: "DENY123",
    }));
  });

  it("diagnoses the MOVE lock, write acceptance, and correlated completion in order", async () => {
    const diagnostics: H3DiagnosticEntry[] = [];
    const fixture = bluetoothFixture({ response: "DONE,DIAG123" });
    const transport = new WebBluetoothDispenserStatusTransport({
      bluetooth: fixture.bluetooth,
      delay: async () => undefined,
      diagnostic: (entry) => diagnostics.push(entry),
    });
    await transport.connect();

    await transport.runSupervisedSlot6MotorTest("diag123");

    expect(diagnostics.map((entry) => entry.event)).toEqual([
      "motor_dispatch_lock_armed",
      "ble_write_started",
      "ble_write_resolved",
      "motor_result_correlated",
    ]);
    expect(diagnostics[0]).toMatchObject({
      operationId: "DIAG123",
      writeAccepted: false,
    });
  });

  it("distinguishes a rejected BLE write from a write accepted with unconfirmed execution", async () => {
    const rejectedDiagnostics: H3DiagnosticEntry[] = [];
    const rejectedFixture = bluetoothFixture({
      onWrite: () => {
        throw new Error("mock GATT write rejection");
      },
    });
    const rejectedTransport = new WebBluetoothDispenserStatusTransport({
      bluetooth: rejectedFixture.bluetooth,
      delay: async () => undefined,
      diagnostic: (entry) => rejectedDiagnostics.push(entry),
    });
    await rejectedTransport.connect();

    const rejected = rejectedTransport.runSupervisedSlot6MotorTest("reject123");
    await expect(rejected).rejects.toMatchObject({
      dispatchStage: "WRITE_REJECTED_DELIVERY_UNCERTAIN",
    });
    expect(rejectedDiagnostics.map((entry) => entry.event)).toContain("ble_write_rejected");
    expect(rejectedTransport.hasDispatchedMotorCommand()).toBe(true);

    const acceptedDiagnostics: H3DiagnosticEntry[] = [];
    const acceptedFixture = bluetoothFixture({ response: "READY" });
    const acceptedTransport = new WebBluetoothDispenserStatusTransport({
      bluetooth: acceptedFixture.bluetooth,
      delay: async () => undefined,
      diagnostic: (entry) => acceptedDiagnostics.push(entry),
    });
    await acceptedTransport.connect();

    const accepted = acceptedTransport.runSupervisedSlot6MotorTest("accept123");
    await expect(accepted).rejects.toBeInstanceOf(ArduinoMotorOutcomeUncertainError);
    await expect(accepted).rejects.toMatchObject({
      dispatchStage: "WRITE_ACCEPTED_EXECUTION_UNCONFIRMED",
    });
    expect(acceptedDiagnostics).toContainEqual(expect.objectContaining({
      event: "parser_or_reconciliation_failed",
      writeAccepted: true,
    }));
    expect(acceptedFixture.getWrites()).toEqual(["MOVE,6,ACCEPT123"]);
  });

  it("diagnoses each read-only GET_LAST_RESULT response without another MOVE", async () => {
    const diagnostics: H3DiagnosticEntry[] = [];
    const fixture = bluetoothFixture({
      responses: ["STARTED,TRACE123", "READY", "DONE,TRACE123"],
    });
    const transport = new WebBluetoothDispenserStatusTransport({
      bluetooth: fixture.bluetooth,
      delay: async () => undefined,
      diagnostic: (entry) => diagnostics.push(entry),
    });
    await transport.connect();
    await transport.runSupervisedSlot6MotorTest("trace123");

    await transport.getLastMotorResult("trace123");

    expect(diagnostics.filter((entry) => entry.event === "get_last_result_response_received"))
      .toEqual([
        expect.objectContaining({ response: "READY", attempt: 1 }),
        expect.objectContaining({ response: "DONE,TRACE123", attempt: 2 }),
      ]);
    expect(fixture.getWrites()).toEqual([
      "MOVE,6,TRACE123",
      "GET_LAST_RESULT",
      "GET_LAST_RESULT",
    ]);
  });
});
