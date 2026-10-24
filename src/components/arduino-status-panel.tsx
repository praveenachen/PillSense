"use client";

import { useEffect, useRef, useState } from "react";
import { createArduinoOperationId, type ArduinoMotorResult } from "@/lib/dispenser/ble-protocol";
import {
  ArduinoMotorOutcomeUncertainError,
  WebBluetoothDispenserStatusTransport,
  type H3DiagnosticEntry,
} from "@/lib/dispenser/web-bluetooth-status-transport";

type MotorPhase = "READY" | "SENDING" | "IN_PROGRESS" | "STEPS_COMPLETED" | "UNCERTAIN";
type BusyAction = "connect" | "status" | "move" | "result" | null;
type DispatchEvidence =
  | "COMMAND_NOT_SENT"
  | "WRITE_PENDING"
  | "WRITE_REJECTED_DELIVERY_UNCERTAIN"
  | "WRITE_ACCEPTED_EXECUTION_UNCONFIRMED"
  | "FIRMWARE_REJECTED"
  | "MOTOR_STEPS_COMPLETED";

const dispatchEvidenceLabels: Record<DispatchEvidence, string> = {
  COMMAND_NOT_SENT: "Command not sent",
  WRITE_PENDING: "BLE write in progress",
  WRITE_REJECTED_DELIVERY_UNCERTAIN: "BLE write rejected; delivery remains uncertain",
  WRITE_ACCEPTED_EXECUTION_UNCONFIRMED: "Write accepted, but execution is unconfirmed",
  FIRMWARE_REJECTED: "Firmware rejected the command",
  MOTOR_STEPS_COMPLETED: "Motor step sequence completed",
};

function logH3Diagnostic(event: string, details: Record<string, unknown> = {}) {
  console.info(`[PillSense H3] ${event}`, details);
}

function logTransportDiagnostic(entry: H3DiagnosticEntry) {
  const { event, ...safeDetails } = entry;
  logH3Diagnostic(event, safeDetails);
}

function messageFor(error: unknown) {
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No Arduino was selected. Try Connect to Arduino again.";
  }
  return error instanceof Error ? error.message : "The Bluetooth operation failed.";
}

function phaseLabel(phase: MotorPhase | null, connected: boolean) {
  if (phase === "SENDING") return "Sending";
  if (phase === "IN_PROGRESS") return "Movement in progress";
  if (phase === "STEPS_COMPLETED") return "Step sequence completed";
  if (phase === "UNCERTAIN") return "Outcome uncertain";
  if (phase === "READY") return "Ready";
  return connected ? "Connected" : "Disconnected";
}

export function ArduinoStatusPanel() {
  const [transport] = useState(() => new WebBluetoothDispenserStatusTransport({
    diagnostic: logTransportDiagnostic,
  }));
  const [connected, setConnected] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [lastResponse, setLastResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceReady, setDeviceReady] = useState(false);
  const [carouselEmpty, setCarouselEmpty] = useState(false);
  const [alignedBeforeStartup, setAlignedBeforeStartup] = useState(false);
  const [movingPartsClear, setMovingPartsClear] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [motorPhase, setMotorPhase] = useState<MotorPhase | null>(null);
  const [motorDispatched, setMotorDispatched] = useState(false);
  const [slotZeroVerified, setSlotZeroVerified] = useState(false);
  const [dispatchEvidence, setDispatchEvidence] = useState<DispatchEvidence>("COMMAND_NOT_SENT");
  const dispatchLocked = useRef(false);
  const motorPhaseRef = useRef<MotorPhase | null>(null);

  function setPhase(phase: MotorPhase) {
    motorPhaseRef.current = phase;
    setMotorPhase(phase);
  }

  useEffect(() => {
    return transport.subscribe((nextConnected) => {
      setConnected(nextConnected);
      if (!nextConnected) {
        setDeviceReady(false);
        if (dispatchLocked.current && motorPhaseRef.current !== "STEPS_COMPLETED") {
          motorPhaseRef.current = "UNCERTAIN";
          setMotorPhase("UNCERTAIN");
          setError("Arduino disconnected after dispatch. Do not resend MOVE; reconnect and use Get last result.");
        } else {
          setError("Arduino disconnected. Reconnect before using the hardware test controls.");
        }
      }
    });
  }, [transport]);

  function applyMotorResult(result: ArduinoMotorResult) {
    setLastResponse(result.response);
    if (result.kind === "STARTED") {
      setDispatchEvidence("WRITE_ACCEPTED_EXECUTION_UNCONFIRMED");
      setPhase("IN_PROGRESS");
    } else if (result.kind === "DONE") {
      setDispatchEvidence("MOTOR_STEPS_COMPLETED");
      setPhase("STEPS_COMPLETED");
    } else {
      setDispatchEvidence(
        result.kind === "REJECTED"
          ? "FIRMWARE_REJECTED"
          : "WRITE_ACCEPTED_EXECUTION_UNCONFIRMED",
      );
      setPhase("UNCERTAIN");
      setError(
        result.kind === "UNKNOWN"
          ? "The Arduino reported UNKNOWN. Do not resend the movement command."
          : "The Arduino rejected the command. No additional movement will be sent in this page session.",
      );
    }
  }

  async function connect() {
    setBusyAction("connect");
    setError(null);
    try {
      // requestDevice is reached directly from this user-initiated click handler.
      await transport.connect();
      setConnected(true);
    } catch (caught) {
      setConnected(false);
      setError(messageFor(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function getStatus() {
    setBusyAction("status");
    setError(null);
    try {
      const reading = await transport.getStatus();
      setLastResponse(reading.response);
      const ready = reading.response === "READY";
      setDeviceReady(ready);
      if (ready && !dispatchLocked.current) setPhase("READY");
    } catch (caught) {
      setDeviceReady(false);
      setError(messageFor(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function runMotorTest() {
    logH3Diagnostic("ui_move_clicked", {
      connected,
      deviceReady,
      confirmationsComplete: carouselEmpty && alignedBeforeStartup && movingPartsClear,
      browserSessionLocked: dispatchLocked.current,
    });
    if (
      dispatchLocked.current ||
      !connected ||
      !deviceReady ||
      !carouselEmpty ||
      !alignedBeforeStartup ||
      !movingPartsClear
    ) {
      setDispatchEvidence("COMMAND_NOT_SENT");
      logH3Diagnostic("ui_dispatch_blocked_before_ble", {
        connected,
        deviceReady,
        confirmationsComplete: carouselEmpty && alignedBeforeStartup && movingPartsClear,
        browserSessionLocked: dispatchLocked.current,
      });
      return;
    }

    logH3Diagnostic("ui_confirmations_accepted", {
      carouselEmpty: true,
      alignedBeforeStartup: true,
      movingPartsClear: true,
    });
    let nextOperationId: string;
    try {
      nextOperationId = createArduinoOperationId();
      logH3Diagnostic("operation_id_created", { operationId: nextOperationId });
    } catch (caught) {
      setDispatchEvidence("COMMAND_NOT_SENT");
      setError(messageFor(caught));
      logH3Diagnostic("operation_id_creation_failed", {
        errorName: caught instanceof Error ? caught.name : "UnknownError",
      });
      return;
    }
    dispatchLocked.current = true;
    setMotorDispatched(true);
    setOperationId(nextOperationId);
    setBusyAction("move");
    setError(null);
    setDispatchEvidence("WRITE_PENDING");
    setPhase("SENDING");
    try {
      applyMotorResult(await transport.runSupervisedSlot6MotorTest(nextOperationId));
    } catch (caught) {
      if (caught instanceof ArduinoMotorOutcomeUncertainError) {
        setDispatchEvidence(
          caught.dispatchStage === "WRITE_ACCEPTED_EXECUTION_UNCONFIRMED"
            ? "WRITE_ACCEPTED_EXECUTION_UNCONFIRMED"
            : caught.dispatchStage === "WRITE_REJECTED_DELIVERY_UNCERTAIN"
              ? "WRITE_REJECTED_DELIVERY_UNCERTAIN"
              : "COMMAND_NOT_SENT",
        );
      } else {
        setDispatchEvidence("COMMAND_NOT_SENT");
      }
      setPhase("UNCERTAIN");
      setError(messageFor(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function getLastResult() {
    logH3Diagnostic("ui_get_last_result_clicked", {
      operationId: operationId ?? "NONE",
      connected,
    });
    if (!operationId) {
      logH3Diagnostic("ui_get_last_result_blocked", { reason: "NO_OPERATION_ID" });
      return;
    }
    setBusyAction("result");
    setError(null);
    try {
      applyMotorResult(await transport.getLastMotorResult(operationId));
    } catch (caught) {
      setPhase("UNCERTAIN");
      setError(messageFor(caught));
    } finally {
      setBusyAction(null);
    }
  }

  const busy = busyAction !== null;
  const confirmationsComplete = carouselEmpty && alignedBeforeStartup && movingPartsClear;
  const runDisabled = busy || !connected || !deviceReady || !confirmationsComplete || motorDispatched;

  return (
    <section className="mt-6 rounded-2xl border-2 border-amber-300 bg-amber-50/70 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="inline-flex rounded-full bg-amber-700 px-3 py-1 text-xs font-bold tracking-wide text-white">
            REAL ARDUINO · SUPERVISED HARDWARE TEST
          </p>
          <h2 className="mt-3 text-2xl font-semibold">Arduino Uno R4 WiFi · Slot 6 only</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-700">
            Local motor-positioning test only. It does not dispense medication and writes no dose,
            inventory, device-event, voice, or agent data to Convex.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`rounded-full px-4 py-2 text-sm font-bold ${connected ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
            {connected ? "Connected" : "Disconnected"}
          </span>
          <span aria-live="polite" className="text-sm font-semibold text-slate-700">
            {phaseLabel(motorPhase, connected)}
          </span>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={connect} disabled={busy} className="min-h-11 rounded-full bg-sky-700 px-5 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {busyAction === "connect" ? "Connecting…" : connected ? "Reconnect Arduino" : "Connect to Arduino"}
        </button>
        <button type="button" onClick={getStatus} disabled={busy || !connected} className="min-h-11 rounded-full border border-sky-300 bg-white px-5 py-2 text-sm font-bold text-sky-800 disabled:cursor-not-allowed disabled:opacity-50">
          {busyAction === "status" ? "Reading…" : "Get device status"}
        </button>
      </div>

      <div className="mt-5 rounded-xl border border-rose-300 bg-rose-50 p-4">
        <p className="font-extrabold text-rose-900">EMPTY CAROUSEL ONLY — NO MEDICATIONS</p>
        <div className="mt-3 grid gap-3 text-sm text-slate-800">
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={carouselEmpty} onChange={(event) => setCarouselEmpty(event.target.checked)} disabled={motorDispatched} className="mt-1 size-4" />
            <span>I physically confirmed the carousel is empty.</span>
          </label>
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={alignedBeforeStartup} onChange={(event) => setAlignedBeforeStartup(event.target.checked)} disabled={motorDispatched} className="mt-1 size-4" />
            <span>I physically aligned the device to Slot 0 before startup. This is not sensor-verified.</span>
          </label>
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={movingPartsClear} onChange={(event) => setMovingPartsClear(event.target.checked)} disabled={motorDispatched} className="mt-1 size-4" />
            <span>I confirmed hands, cables, and other objects are clear of moving parts.</span>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={runMotorTest} disabled={runDisabled} className="min-h-11 rounded-full bg-rose-700 px-5 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {busyAction === "move" ? "Sending once…" : "Run Slot 6 Motor Test"}
          </button>
          <button type="button" onClick={getLastResult} disabled={busy || !connected || !operationId} className="min-h-11 rounded-full border border-amber-400 bg-white px-5 py-2 text-sm font-bold text-amber-900 disabled:cursor-not-allowed disabled:opacity-50">
            {busyAction === "result" ? "Reconciling…" : "Get last result"}
          </button>
        </div>
        {motorDispatched && (
          <p className="mt-3 text-xs font-semibold leading-5 text-rose-900">
            MOVE is locked for this page session. Reconnecting and Get last result are read-only and will not resend it.
          </p>
        )}
      </div>

      <div className="mt-5 rounded-xl border border-amber-200 bg-white p-4 text-sm">
        <p className="font-semibold text-slate-900">Last Arduino response</p>
        <p aria-live="polite" className="mt-1 font-mono text-slate-700">{lastResponse ?? "No response read yet"}</p>
        {operationId && <p className="mt-2 text-xs text-slate-600">Operation ID: <span className="font-mono">{operationId}</span></p>}
        <p className="mt-2 text-xs text-slate-600">
          Dispatch evidence: <strong>{dispatchEvidenceLabels[dispatchEvidence]}</strong>
        </p>
      </div>

      {motorPhase === "STEPS_COMPLETED" && (
        <label className="mt-4 flex items-start gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950">
          <input type="checkbox" checked={slotZeroVerified} onChange={(event) => setSlotZeroVerified(event.target.checked)} className="mt-1 size-4" />
          <span>
            I physically inspected and verified that the carousel returned to Slot 0 afterward.
            {slotZeroVerified && <strong className="mt-1 block">Manual Slot 0 verification acknowledged.</strong>}
          </span>
        </label>
      )}

      <p className="mt-3 text-xs leading-5 text-slate-600">
        STARTED and DONE are browser-observed firmware responses, not authenticated evidence. DONE means only that the programmed motor-step sequence completed; it does not prove physical alignment, pill release, collection, or ingestion.
      </p>
      {error && <p role="alert" className="mt-3 rounded-xl bg-rose-100 p-3 text-sm text-rose-900">{error}</p>}
    </section>
  );
}
