"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AuthRequired } from "./auth-required";
import { BrandMark } from "./mobile-ui";
import { PatientSupplyReminder } from "./patient-supply-reminder";
import { TodayView, type TodayDevice } from "./today-view";
import {
  buildTodayTimeline,
  firstName,
  greetingFor,
  pickNextDose,
  type DoseOccurrence,
  type ScheduledMedication,
} from "@/lib/today";

/* ---------------------------- live container ---------------------------- */

export function TodayScreen({ account, onOpenDispenser, onOpenSchedule }: { account?: ReactNode; onOpenDispenser?: () => void; onOpenSchedule?: () => void }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return <StateCard title="Loading your day…">Confirming authentication and loading schedules.</StateCard>;
  if (!isAuthenticated) return <div className="space-y-4"><TodayBrandHeader account={account} /><AuthRequired message="Patient schedules are private and require Convex to accept your Clerk session." /></div>;
  return <AuthenticatedToday account={account} onOpenDispenser={onOpenDispenser} onOpenSchedule={onOpenSchedule} />;
}

function TodayBrandHeader({ account }: { account?: ReactNode }) {
  return (
    <header className="flex items-center gap-3">
      <BrandMark size={44} />
      <div className="min-w-0 flex-1"><p className="ps-display text-[1.35rem] font-semibold leading-none text-[#0f172a]">PillSense</p><p className="mt-1 text-xs text-[#64748b]">Care, connected.</p></div>
      {account}
    </header>
  );
}

function StateCard({ title, children }: { title: string; children: ReactNode }) {
  return <section className="ps-card p-5"><h2 className="ps-display text-xl font-semibold text-[#0f172a]">{title}</h2><div className="mt-2 text-sm leading-6 text-[#475569]">{children}</div></section>;
}

const runtimeLabels: Record<string, string> = {
  READY: "Ready",
  DISCONNECTED: "Not connected",
  CALIBRATION_REQUIRED: "Calibration required",
};

function AuthenticatedToday({ account, onOpenDispenser, onOpenSchedule }: { account?: ReactNode; onOpenDispenser?: () => void; onOpenSchedule?: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const dashboard = useQuery(api.patient.dashboard);
  const doses = useQuery(api.occurrences.listForPatient, { now });
  const reportIngestion = useMutation(api.dispensing.reportIngestion);
  const [markBusy, setMarkBusy] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);

  const timeline = useMemo(() => {
    if (!dashboard || dashboard.status !== "ready" || !doses) return null;
    const medications: ScheduledMedication[] = dashboard.medications.map((m) => ({ id: m.id, name: m.name, instructions: m.instructions ?? "", slot: m.slot, localTime: m.localTime, weekdays: m.weekdays }));
    const occurrences: DoseOccurrence[] = doses.occurrences.map((o) => ({ id: o.id, mode: o.mode, medicationName: o.medicationName, instructions: o.instructions ?? "", slot: o.slot, scheduledFor: o.scheduledFor, eligibleFrom: o.eligibleFrom, expiresAt: o.expiresAt, attemptStatus: o.attemptStatus, ingestionReport: o.ingestionReport }));
    return buildTodayTimeline(medications, occurrences, now);
  }, [dashboard, doses, now]);

  if (dashboard === undefined || (dashboard.status === "ready" && (doses === undefined || timeline === null))) {
    return <div className="space-y-4"><TodayBrandHeader account={account} /><StateCard title="Loading your day…">Listening for schedule updates from Convex.</StateCard></div>;
  }
  if (dashboard.status !== "ready") {
    const message = dashboard.status === "needs_onboarding"
      ? "No demo care team yet. Use the caregiver setup to explicitly create a synthetic patient relationship."
      : dashboard.status === "unauthorized"
        ? "This account does not have an active patient profile or caregiver relationship."
        : "The paired synthetic patient record could not be loaded.";
    return <div className="space-y-4"><TodayBrandHeader account={account} /><StateCard title="Patient view unavailable">{message}</StateCard></div>;
  }

  const rows = timeline ?? [];
  const nextDose = pickNextDose(rows);
  const device = doses?.device;
  const deviceView: TodayDevice = !device
    ? { label: "Dispenser", detail: "Open My Dispenser to pair Bluetooth", tone: "idle" }
    : { label: "Demo Dispenser", detail: runtimeLabels[device.state] ?? device.state.toLowerCase().replaceAll("_", " "), tone: device.connected && device.state === "READY" ? "ready" : "attention" };
  const dueCount = rows.filter((row) => row.state === "DUE").length;
  const summary = rows.length === 0
    ? "Nothing is scheduled today."
    : dueCount > 0
      ? `${dueCount === 1 ? "A dose is" : `${dueCount} doses are`} due now.`
      : `${rows.length} ${rows.length === 1 ? "dose" : "doses"} scheduled today.`;

  async function onConfirm() {
    if (!nextDose?.occurrenceId) return;
    setMarkBusy(true);
    setMarkError(null);
    try {
      await reportIngestion({ occurrenceId: nextDose.occurrenceId as Id<"doseOccurrences">, report: "TAKEN" });
    } catch (caught) {
      setMarkError(caught instanceof Error ? caught.message : "The report could not be saved.");
    } finally {
      setMarkBusy(false);
    }
  }

  return (
    <TodayView
      greeting={greetingFor(new Date(now).getHours())}
      name={firstName(dashboard.patientName)}
      summary={summary}
      device={deviceView}
      nextDose={nextDose}
      timeline={rows}
      account={account}
      supply={<PatientSupplyReminder />}
      onOpenDispenser={onOpenDispenser}
      onOpenSchedule={onOpenSchedule}
      markTaken={{ busy: markBusy, error: markError, onConfirm: () => void onConfirm() }}
    />
  );
}
