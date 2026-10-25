"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { io } from "next/cache";
import { use, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { AuthRequired } from "./auth-required";
import { DispenserView, presentDispenserDevice } from "./dispenser-view";
import { DispenserBluetoothCard } from "./dispenser-bluetooth-card";
import { useArduinoGateway } from "./arduino-gateway-provider";
import type { SlotMedicationInput } from "./slot-medication-form";

export function DispenserScreen({ onOpenSetup }: { onOpenSetup: () => void }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  use(io());
  const [now] = useState(() => Date.now());
  const dashboard = useQuery(api.patient.dashboard, isAuthenticated ? {} : "skip");
  const doses = useQuery(api.occurrences.listForPatient, isAuthenticated ? { now } : "skip");
  const setup = useQuery(api.caregiver.setup, isAuthenticated ? {} : "skip");
  const createMedication = useMutation(api.medications.createWithAssignment);
  const ensureShowcase = useMutation(api.demo.ensureDashboardShowcase);
  const showcaseRequested = useRef(false);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const gateway = useArduinoGateway();
  const [bluetoothBusy, setBluetoothBusy] = useState(false);
  const bluetoothBusyRef = useRef(false);
  const [bluetoothError, setBluetoothError] = useState<string | null>(null);
  const armVoiceDemo = useMutation(api.hardwareLab.armVoiceDemo);

  async function bluetoothAction(action: "pair" | "verify") {
    if (bluetoothBusyRef.current) return;
    bluetoothBusyRef.current = true;
    setBluetoothBusy(true);
    setBluetoothError(null);
    try {
      if (action === "pair") await gateway.connect();
      else {
        const reading = await gateway.getStatus();
        if (reading.response !== "READY") throw new Error(`The dispenser reports ${reading.response}. It is not ready for the demo.`);
        if (!gateway.connectionId || !gateway.isConnected()) throw new Error("The Arduino disconnected. Pair again before confirming Ready.");
        if (gateway.motorDispatched) throw new Error("This browser session has already attempted a movement. Ready cannot reset that attempt.");
        // The Ready click is the operator's physical confirmation, described
        // beside the control. The server still enforces development/operator scope.
        await armVoiceDemo({ connectionId: gateway.connectionId, observedStatus: "READY", emptyOrInertConfirmed: true, manualHomeConfirmed: true, movingPartsClear: true });
      }
    } catch (error) {
      setBluetoothError(error instanceof Error ? error.message : "Bluetooth connection failed.");
    } finally {
      bluetoothBusyRef.current = false;
      setBluetoothBusy(false);
    }
  }

  // Idempotent: fills in demo pill counts for synthetic patients even if Today was not opened first.
  useEffect(() => {
    if (dashboard?.status !== "ready" || !dashboard.isSynthetic || showcaseRequested.current) return;
    showcaseRequested.current = true;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    void ensureShowcase({ timezone }).catch(() => undefined);
  }, [dashboard, ensureShowcase]);

  if (isLoading) return <DispenserState title="Loading your dispenser…">Reading your protected device and slot information.</DispenserState>;
  if (!isAuthenticated) return <AuthRequired message="Dispenser assignments are private and require Convex to accept your Clerk session." />;
  if (dashboard === undefined || doses === undefined) return <DispenserState title="Loading your dispenser…">Listening for current slot assignments and device state.</DispenserState>;
  if (dashboard.status !== "ready") {
    const detail = dashboard.status === "needs_onboarding"
      ? "Complete the synthetic demo setup before viewing compartment assignments."
      : dashboard.status === "unauthorized"
        ? "This account does not have access to a patient dispenser."
        : "The paired patient record is unavailable.";
    return <DispenserState title="Dispenser unavailable">{detail}</DispenserState>;
  }

  return (
    <>
    <DispenserView
      medications={dashboard.medications}
      device={dashboard.isSynthetic ? {
        connected: gateway.connected && gateway.isConnected(),
        verified: gateway.connected && gateway.isConnected() && gateway.reportedStatus === "READY",
        busy: gateway.reportedStatus === "DISPENSING",
        tone: gateway.connected && gateway.isConnected() ? "ready" : "idle",
      } : presentDispenserDevice(doses.device)}
      selectedSlot={selectedSlot ?? dashboard.medications[0]?.slot ?? 1}
      onSelectSlot={setSelectedSlot}
      onOpenSetup={onOpenSetup}
      synthetic={dashboard.isSynthetic}
      demoSettings={dashboard.isSynthetic ? <DispenserBluetoothCard /> : undefined}
      onPair={dashboard.isSynthetic ? () => void bluetoothAction("pair") : undefined}
      onVerify={dashboard.isSynthetic ? () => void bluetoothAction("verify") : undefined}
      setupBusy={bluetoothBusy}
      setupError={bluetoothError}
      onSaveSlot={
        setup?.status === "ready" &&
        setup.patient.id === dashboard.patientId &&
        setup.device.id === dashboard.deviceId
          ? async (value: SlotMedicationInput) => {
              const saved = await createMedication({
                patientId: dashboard.patientId,
                name: value.name,
                instructions: value.instructions,
                slot: value.slot,
                localTime: value.localTime,
                weekdays: value.weekdays,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
                demoInventory: value.demoInventory,
                supplyCount: value.supplyCount,
                scheduled: value.scheduled,
                productDetails: value.productDetails,
              });
              return { slot: saved.slot };
            }
          : undefined
      }
      saveUnavailableMessage="This account can’t add medications. Sign in with the account that manages this dispenser."
    />
    </>
  );
}

function DispenserState({ title, children }: { title: string; children: ReactNode }) {
  return <section className="pd-card p-5"><h2 className="text-lg font-semibold text-pd-text">{title}</h2><p className="mt-2 text-sm leading-6 text-pd-muted">{children}</p></section>;
}
