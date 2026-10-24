"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { io } from "next/cache";
import { use, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { AuthRequired } from "./auth-required";
import { DispenserView, presentDispenserDevice } from "./dispenser-view";
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
    <DispenserView
      medications={dashboard.medications}
      device={presentDispenserDevice(doses.device)}
      selectedSlot={selectedSlot ?? dashboard.medications[0]?.slot ?? 1}
      onSelectSlot={setSelectedSlot}
      onOpenSetup={onOpenSetup}
      synthetic={dashboard.isSynthetic}
      onSaveSlot={setup?.status === "ready" ? async (value: SlotMedicationInput) => {
        await createMedication({
          patientId: setup.patient.id,
          name: value.name,
          instructions: value.instructions,
          slot: value.slot,
          localTime: value.localTime,
          weekdays: value.weekdays,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          demoInventory: value.supplyCount > 0 ? 1 : 0,
          supplyCount: value.supplyCount,
        });
      } : undefined}
      saveUnavailableMessage="This account can’t add medications. Sign in with the account that manages this dispenser."
    />
  );
}

function DispenserState({ title, children }: { title: string; children: ReactNode }) {
  return <section className="pd-card p-5"><h2 className="text-lg font-semibold text-pd-text">{title}</h2><p className="mt-2 text-sm leading-6 text-pd-muted">{children}</p></section>;
}
