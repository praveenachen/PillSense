"use client";

import { useEffect, useRef, useState } from "react";
import { CarouselGraphic, Icon, SectionTitle, StatusPill } from "./mobile-ui";
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

export function ArduinoStatusPanel({ onOpenSetup }: { onOpenSetup?: () => void } = {}) {
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

  const attention = motorPhase === "UNCERTAIN" || Boolean(error);
  // The check icon appears only when the firmware reports READY or the step sequence completed.
  const statusPositive = connected && (deviceReady || motorPhase === "STEPS_COMPLETED");
  const statusTitle = motorPhase
    ? phaseLabel(motorPhase, connected)
    : !connected
      ? "Not connected"
      : deviceReady
        ? "Ready"
        : "Connected";
  const statusDetail = motorPhase === "STEPS_COMPLETED"
    ? "Step sequence completed. Inspect the carousel yourself to confirm it is back at Slot 0."
    : motorPhase === "UNCERTAIN"
      ? "Outcome uncertain. Do not resend; reconnect and use Last result."
      : !connected
        ? "Pair the Arduino over Bluetooth to begin."
        : deviceReady
          ? "Firmware reports READY. Home alignment is confirmed by you, not by a sensor."
          : "Use Device status to read the firmware state.";
  const runBlockers = [
    !connected && "connect the Arduino",
    connected && !deviceReady && "read device status until it reports READY",
    !confirmationsComplete && "tick all three safety confirmations",
    motorDispatched && "movement is locked for this page session",
  ].filter(Boolean) as string[];
  const activity: Array<{ title: string; detail: string; tone: "ok" | "warn" | "info" }> = [];
  if (operationId) {
    activity.push({
      title: `Slot 6 test · ${phaseLabel(motorPhase, connected)}`,
      detail: `${dispatchEvidenceLabels[dispatchEvidence]} · ${operationId}`,
      tone: motorPhase === "STEPS_COMPLETED" ? "ok" : motorPhase === "UNCERTAIN" ? "warn" : "info",
    });
  }
  if (lastResponse) activity.push({ title: "Arduino response", detail: lastResponse, tone: "info" });
  if (connected) activity.push({ title: "Bluetooth connected", detail: "Direct Web Bluetooth session in this browser tab", tone: "ok" });

  return (
    <section aria-label="Supervised hardware controls" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={connected ? "green" : "slate"} dot>{connected ? "Connected" : "Disconnected"}</StatusPill>
        <StatusPill tone="amber">Real hardware · supervised</StatusPill>
      </div>

      <div className="relative px-2 pt-1">
        <div className="mx-auto w-[min(100%,14.5rem)]">
          <CarouselGraphic variant="placeholder" testTargetSlot={6} />
        </div>
        <p className="mt-1 text-center text-[0.7rem] leading-4 text-[#64748b]">Illustrative placeholder · not live position</p>
      </div>

      <div aria-live="polite" className={`ps-card flex items-center gap-3 px-3 py-2.5 ${attention ? "!border-[#f3b8b8]" : ""}`}>
        <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-full ${attention ? "bg-[#fde4e4] text-[#b42323]" : statusPositive ? "bg-[#d9f5ef] text-[#0f766e]" : "bg-[#e8eef5] text-[#64748b]"}`}><Icon name={attention ? "alert" : statusPositive ? "check" : "info"} size={18} strokeWidth={2.2} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[#0f172a]">{statusTitle}</span>
          <span className="block text-xs leading-5 text-[#64748b]">{statusDetail}</span>
        </span>
      </div>

      <fieldset className="rounded-2xl border border-[#f3d4d4] bg-[#fffafa] px-3.5 pb-1.5 pt-1">
        <legend className="px-1 text-[0.7rem] font-bold uppercase tracking-wide text-[#a32020]">Empty carousel only · no medications</legend>
        <div className="text-[0.78rem] leading-[1.15rem] text-[#1e293b]">
          <label className="flex min-h-11 items-center gap-3 py-1">
            <input type="checkbox" checked={carouselEmpty} onChange={(event) => setCarouselEmpty(event.target.checked)} disabled={motorDispatched} className="size-5 shrink-0 accent-[#0f766e]" />
            <span>I physically confirmed the carousel is empty.</span>
          </label>
          <label className="flex min-h-11 items-center gap-3 py-1">
            <input type="checkbox" checked={alignedBeforeStartup} onChange={(event) => setAlignedBeforeStartup(event.target.checked)} disabled={motorDispatched} className="size-5 shrink-0 accent-[#0f766e]" />
            <span>I physically aligned the device to Slot 0 before startup. This is not sensor-verified.</span>
          </label>
          <label className="flex min-h-11 items-center gap-3 py-1">
            <input type="checkbox" checked={movingPartsClear} onChange={(event) => setMovingPartsClear(event.target.checked)} disabled={motorDispatched} className="size-5 shrink-0 accent-[#0f766e]" />
            <span>I confirmed hands, cables, and other objects are clear of moving parts.</span>
          </label>
        </div>
      </fieldset>

      <div>
        <button type="button" onClick={runMotorTest} disabled={runDisabled} className="ps-cta flex min-h-[3.4rem] w-full items-center justify-center gap-2 rounded-full px-5 text-[1rem] font-semibold">
          {busyAction === "move" ? "Sending once…" : "Run Slot 6 Test (Supervised)"}
          <Icon name="arrow" size={18} />
        </button>
        {runDisabled && runBlockers.length > 0 && !busy && (
          <p className="mt-2 px-2 text-xs leading-5 text-[#64748b]">To enable: {runBlockers.join("; ")}.</p>
        )}
        {motorDispatched && (
          <p className="mt-2 px-2 text-xs font-semibold leading-5 text-[#a32020]">
            MOVE is locked for this page session. Reconnecting and Last result are read-only and will not resend it.
          </p>
        )}
      </div>

      <div className="ps-card grid grid-cols-3 divide-x divide-[#e6eef6] overflow-hidden">
        <button type="button" onClick={connect} disabled={busy} className="ps-focus flex min-h-[3.8rem] flex-col items-center justify-center gap-1 px-1 text-center text-[0.7rem] font-medium text-[#475569] disabled:opacity-50">
          <span className="text-[#0f766e]"><Icon name="bluetooth" size={21} /></span>
          {busyAction === "connect" ? "Connecting…" : connected ? "Reconnect" : "Pair device"}
        </button>
        <button type="button" onClick={getStatus} disabled={busy || !connected} className="ps-focus flex min-h-[3.8rem] flex-col items-center justify-center gap-1 px-1 text-center text-[0.7rem] font-medium text-[#475569] disabled:opacity-50">
          <span className="text-[#0f766e]"><Icon name="info" size={21} /></span>
          {busyAction === "status" ? "Reading…" : "Device status"}
        </button>
        <button type="button" onClick={getLastResult} disabled={busy || !connected || !operationId} className="ps-focus flex min-h-[3.8rem] flex-col items-center justify-center gap-1 px-1 text-center text-[0.7rem] font-medium text-[#475569] disabled:opacity-50">
          <span className="text-[#0f766e]"><Icon name="refresh" size={21} /></span>
          {busyAction === "result" ? "Reconciling…" : "Last result"}
        </button>
      </div>
      {!operationId && <p className="-mt-2 px-2 text-xs text-[#64748b]">Last result becomes available after a Slot 6 test has been sent.</p>}

      {onOpenSetup && (
        <button type="button" onClick={onOpenSetup} className="ps-card ps-focus flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left">
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e3efff] text-[#1e4f8a]"><Icon name="gear" size={22} /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-[#0f172a]">Setup &amp; slot mapping</span><span className="block text-xs text-[#64748b]">Slots 1–7 for medications · Slot 0 is home</span></span>
          <Icon name="chevron" size={18} className="text-[#94a3b8]" />
        </button>
      )}

      <section id="dispenser-activity" aria-labelledby="dispenser-activity-title" className="scroll-mt-4">
        <SectionTitle>
          <span id="dispenser-activity-title">Recent activity</span>
        </SectionTitle>
        <div className="ps-card mt-2 divide-y divide-[#e6eef6]">
          {activity.length === 0 ? (
            <p className="px-3 py-3 text-sm text-[#64748b]">No hardware activity in this browser session yet.</p>
          ) : activity.map((item, index) => (
            <div key={`${item.title}:${index}`} className="flex items-start gap-3 px-3 py-2.5">
              <span aria-hidden="true" className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${item.tone === "ok" ? "bg-[#d9f5ef] text-[#0f766e]" : item.tone === "warn" ? "bg-[#fde4e4] text-[#b42323]" : "bg-[#e3efff] text-[#1e4f8a]"}`}><Icon name={item.tone === "warn" ? "alert" : item.tone === "ok" ? "check" : "info"} size={16} strokeWidth={2.2} /></span>
              <span className="min-w-0"><span className="block text-sm font-semibold text-[#0f172a]">{item.title}</span><span className="block break-all font-mono text-[0.68rem] leading-4 text-[#64748b]">{item.detail}</span></span>
            </div>
          ))}
        </div>
      </section>

      {motorPhase === "STEPS_COMPLETED" && (
        <label className="flex min-h-11 items-start gap-3 rounded-2xl border border-[#a7e3d6] bg-[#eefaf6] p-3.5 text-sm text-[#0b4f45]">
          <input type="checkbox" checked={slotZeroVerified} onChange={(event) => setSlotZeroVerified(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[#0f766e]" />
          <span>
            I physically inspected and verified that the carousel returned to Slot 0 afterward.
            {slotZeroVerified && <strong className="mt-1 block">Manual Slot 0 verification acknowledged.</strong>}
          </span>
        </label>
      )}

      <div className="px-1 text-xs leading-5 text-[#64748b]">
        <p><span className="font-semibold text-[#334155]">Last Arduino response:</span> <span aria-live="polite" className="font-mono">{lastResponse ?? "none read yet"}</span></p>
        <details className="mt-1">
          <summary className="ps-focus min-h-11 cursor-pointer py-2.5 font-semibold text-[#0f766e]">About this test and illustration</summary>
          <p>The 3D viewer arrives in H5B. The illustration does not show live position or sensor data; Slot 6 is highlighted only as the supported test target.</p>
        <p className="mt-1.5">
            Local motor-positioning test only on an empty carousel. It does not dispense medication and writes no dose, inventory, device-event, voice, or agent data to Convex. STARTED and DONE are browser-observed firmware responses, not authenticated evidence. DONE means only that the programmed motor-step sequence completed; it does not prove physical alignment, pill release, collection, or ingestion.
          </p>
        </details>
      </div>
      {error && <p role="alert" className="rounded-2xl bg-[#fde4e4] p-3 text-sm text-[#8f1d1d]">{error}</p>}
    </section>
  );
}
