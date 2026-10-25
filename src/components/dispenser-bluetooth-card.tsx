"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useArduinoGateway } from "./arduino-gateway-provider";

/** Operator settings for the existing server-authorized demo arm. Pairing lives in the setup steps. */
export function DispenserBluetoothCard() {
  const gateway = useArduinoGateway();
  const [now, setNow] = useState(() => Date.now());
  const arm = useQuery(api.hardwareLab.voiceDemoArm, { now });
  const armVoiceDemo = useMutation(api.hardwareLab.armVoiceDemo);
  const disarmVoiceDemo = useMutation(api.hardwareLab.disarmVoiceDemo);
  const [empty, setEmpty] = useState(false);
  const [home, setHome] = useState(false);
  const [clear, setClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // The server's arm is not proof that the browser still has a GATT connection.
  if (!arm || arm.status === "UNAVAILABLE") return null;

  const connected = gateway.connected && gateway.isConnected();
  const ready = connected && gateway.reportedStatus === "READY";
  const armed = arm.status === "ARMED";
  const armedId = armed ? arm.armId : null;
  const armedHere = armed && arm.connectionId === gateway.connectionId;
  const safetyConfirmed = empty && home && clear;

  async function perform(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The Bluetooth operation failed.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function toggleArm() {
    void perform(async () => {
      if (armedId) {
        await disarmVoiceDemo({ armId: armedId });
      } else {
        if (!ready || !gateway.connectionId || !safetyConfirmed || gateway.motorDispatched) {
          throw new Error("Pair the Arduino, read READY, and confirm the inert-demo, alignment, and clearance checks before arming.");
        }
        await armVoiceDemo({
          connectionId: gateway.connectionId,
          observedStatus: "READY",
          emptyOrInertConfirmed: true,
          manualHomeConfirmed: true,
          movingPartsClear: true,
        });
      }
      setNow(Date.now());
    });
  }

  return (
    <section aria-label="Real Arduino demo connection" className="pd-card space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-pd-accent-soft">Operator settings</p>
          <h2 className="mt-1 text-base font-semibold text-pd-text">Voice hardware demo</h2>
        </div>
        <span role="status" className={`whitespace-nowrap text-xs font-semibold ${connected ? "text-pd-ok" : "text-red-400"}`}>
          {connected ? "● Connected" : "● Disconnected"}
        </span>
      </div>
      <p className="text-xs text-pd-muted">Firmware: {connected ? gateway.reportedStatus ?? "Use Ready to read status" : "Pair on My Dispenser first"}</p>
      <div className="border-t border-pd-line pt-3">
        <p className="text-xs font-bold uppercase tracking-wide text-red-400">Empty or inert demo props only · no real medications</p>
        <div className="mt-2 space-y-2 text-xs leading-5 text-pd-muted">
          <label className="flex items-start gap-2"><input type="checkbox" checked={empty} onChange={(event) => setEmpty(event.target.checked)} disabled={armed || gateway.motorDispatched} className="mt-1 accent-pd-accent" />I physically confirmed the carousel is empty or contains only inert demo props, with no real medications.</label>
          <label className="flex items-start gap-2"><input type="checkbox" checked={home} onChange={(event) => setHome(event.target.checked)} disabled={armed || gateway.motorDispatched} className="mt-1 accent-pd-accent" />I physically aligned Slot 0 before startup; no sensor verifies this.</label>
          <label className="flex items-start gap-2"><input type="checkbox" checked={clear} onChange={(event) => setClear(event.target.checked)} disabled={armed || gateway.motorDispatched} className="mt-1 accent-pd-accent" />Hands, cables, and moving parts are clear.</label>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className={`text-xs font-semibold ${armedHere && ready ? "text-pd-ok" : "text-pd-muted"}`}>
            {armedHere ? (ready ? "Voice demo armed · connected" : "Voice demo armed · connection lost") : armed ? "Voice demo armed on another connection" : "Voice demo disarmed"}
          </span>
          <button type="button" onClick={toggleArm} disabled={busy || gateway.motorDispatched || (!armed && (!ready || !safetyConfirmed))} className="pd-focus min-h-11 rounded-pd-chip border border-pd-accent/50 px-3 text-xs font-semibold text-pd-text disabled:opacity-50">
            {armed ? "Disarm" : "Arm Slot 6 voice demo"}
          </button>
        </div>
        <p className="mt-2 text-xs leading-5 text-pd-muted">Operator-authorized, Slot 6 only, one movement per firmware boot. Arming expires after 10 minutes. No movement is sent here.</p>
      </div>
      {error && <p role="alert" className="rounded-pd-chip border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">{error}</p>}
    </section>
  );
}
