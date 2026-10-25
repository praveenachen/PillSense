"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import type { ArduinoMotorResult } from "../lib/dispenser/ble-protocol";
import {
  WebBluetoothDispenserStatusTransport,
  type ArduinoStatusReading,
  type H3DiagnosticEntry,
} from "../lib/dispenser/web-bluetooth-status-transport";

type ArduinoGateway = {
  connected: boolean;
  connectionId: string | null;
  reportedStatus: ArduinoStatusReading["response"] | null;
  motorDispatched: boolean;
  operationId: string | null;
  isConnected(): boolean;
  ensureArmedConnection(): Promise<boolean>;
  connect(): Promise<void>;
  getStatus(): Promise<ArduinoStatusReading>;
  dispatchSlot6(operationId: string): Promise<ArduinoMotorResult>;
  getLastResult(operationId: string): Promise<ArduinoMotorResult>;
  subscribeDiagnostics(listener: (entry: H3DiagnosticEntry) => void): () => void;
};

const ArduinoGatewayContext = createContext<ArduinoGateway | null>(null);

const BLE_BINDING_STORAGE_KEY = "pillsense.ble.arm-binding.v1";

type StoredBleBinding = { connectionId: string; deviceId: string };

function readStoredBinding(): StoredBleBinding | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(BLE_BINDING_STORAGE_KEY) ?? "null") as unknown;
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<StoredBleBinding>;
    return typeof candidate.connectionId === "string" && typeof candidate.deviceId === "string"
      ? { connectionId: candidate.connectionId, deviceId: candidate.deviceId }
      : null;
  } catch {
    return null;
  }
}

function writeStoredBinding(binding: StoredBleBinding) {
  window.sessionStorage.setItem(BLE_BINDING_STORAGE_KEY, JSON.stringify(binding));
}

function gatewayDiagnostic(event: string, details: Record<string, unknown> = {}) {
  console.info(`[PillSense BLE gateway] ${event}`, details);
}

/** Owns the app's only Web Bluetooth connection and firmware one-MOVE lock. */
export function ArduinoGatewayProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [diagnosticListeners] = useState(() => new Set<(entry: H3DiagnosticEntry) => void>());
  const [transport] = useState(() => new WebBluetoothDispenserStatusTransport({
    diagnostic: (entry) => {
      for (const listener of diagnosticListeners) listener(entry);
    },
  }));
  const [connected, setConnected] = useState(false);
  const [connectionId, setConnectionId] = useState<string | null>(() => readStoredBinding()?.connectionId ?? null);
  const [reportedStatus, setReportedStatus] = useState<ArduinoStatusReading["response"] | null>(null);
  const [motorDispatched, setMotorDispatched] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);

  useEffect(() => {
    const stored = readStoredBinding();
    gatewayDiagnostic("provider_mounted", { route: pathname, bindingRestored: Boolean(stored) });
    return () => gatewayDiagnostic("provider_unmounted", { route: pathname });
    // The mount diagnostic must describe the single provider lifetime, not each route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    gatewayDiagnostic("route_observed", {
      route: pathname,
      reactConnected: connected,
      liveGattConnected: transport.isConnected(),
      hasConnectionBinding: Boolean(connectionId),
    });
  }, [connected, connectionId, pathname, transport]);

  useEffect(() => transport.subscribe((nextConnected) => {
    setConnected(nextConnected);
    if (!nextConnected) {
      setReportedStatus(null);
      gatewayDiagnostic("gatt_disconnected", { bindingRetainedForReadOnlyRecovery: Boolean(readStoredBinding()) });
    }
  }), [transport]);

  const connect = useCallback(async () => {
    // This remains directly reachable from the operator's click handler.
    await transport.connect();
    const deviceId = transport.getDeviceId();
    if (!deviceId) throw new Error("Chrome did not expose an identity for the paired Arduino.");
    const stored = readStoredBinding();
    const nextConnectionId = stored?.deviceId === deviceId
      ? stored.connectionId
      : globalThis.crypto.randomUUID();
    writeStoredBinding({ connectionId: nextConnectionId, deviceId });
    setConnected(true);
    setConnectionId(nextConnectionId);
    setReportedStatus(null);
    gatewayDiagnostic("chooser_connection_ready", { reusedArmBinding: stored?.deviceId === deviceId });
  }, [transport]);

  const ensureArmedConnection = useCallback(async () => {
    if (transport.isConnected()) return true;
    const stored = readStoredBinding();
    if (!stored || (connectionId && stored.connectionId !== connectionId)) {
      gatewayDiagnostic("restore_blocked", { reason: "NO_MATCHING_BROWSER_BINDING" });
      return false;
    }
    gatewayDiagnostic("restore_started", { source: "previously_authorized_device" });
    try {
      await transport.reconnectPreviouslyAuthorizedDevice(stored.deviceId);
      const reading = await transport.getStatus();
      if (reading.response !== "READY") {
        setReportedStatus(reading.response);
        gatewayDiagnostic("restore_blocked", { reason: "FIRMWARE_NOT_READY", status: reading.response });
        return false;
      }
      setConnectionId(stored.connectionId);
      setConnected(true);
      setReportedStatus("READY");
      gatewayDiagnostic("restore_ready", { status: "READY" });
      return true;
    } catch (error) {
      gatewayDiagnostic("restore_failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
      setConnected(false);
      return false;
    }
  }, [connectionId, transport]);

  const getStatus = useCallback(async () => {
    const reading = await transport.getStatus();
    setReportedStatus(reading.response);
    return reading;
  }, [transport]);

  const dispatchSlot6 = useCallback(async (operationId: string) => {
    // Lock React state before the first awaited BLE operation. The transport
    // independently retains its own one-dispatch lock as the final guard.
    setMotorDispatched(true);
    setOperationId(operationId);
    setReportedStatus("DISPENSING");
    const result = await transport.runSupervisedSlot6MotorTest(operationId);
    if (result.kind === "DONE") setReportedStatus("READY");
    return result;
  }, [transport]);

  const getLastResult = useCallback(async (operationId: string) => {
    const result = await transport.getLastMotorResult(operationId);
    setReportedStatus(result.kind === "DONE" ? "READY" : result.kind === "STARTED" ? "DISPENSING" : null);
    return result;
  }, [transport]);

  const subscribeDiagnostics = useCallback((listener: (entry: H3DiagnosticEntry) => void) => {
    diagnosticListeners.add(listener);
    return () => diagnosticListeners.delete(listener);
  }, [diagnosticListeners]);

  const value = useMemo<ArduinoGateway>(() => ({
    connected,
    connectionId,
    reportedStatus,
    motorDispatched,
    operationId,
    isConnected: () => transport.isConnected(),
    ensureArmedConnection,
    connect,
    getStatus,
    dispatchSlot6,
    getLastResult,
    subscribeDiagnostics,
  }), [connected, connectionId, reportedStatus, motorDispatched, operationId, connect, ensureArmedConnection, getStatus, dispatchSlot6, getLastResult, subscribeDiagnostics, transport]);

  return <ArduinoGatewayContext.Provider value={value}>{children}</ArduinoGatewayContext.Provider>;
}

export function useArduinoGateway() {
  const value = useContext(ArduinoGatewayContext);
  if (!value) throw new Error("ArduinoGatewayProvider is required");
  return value;
}
