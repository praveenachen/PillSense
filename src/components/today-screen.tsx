"use client";

import { useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { AuthRequired } from "./auth-required";
import { RefillBell } from "./refill-bell";
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

/** The account control is built from the patient's initial once it is known. */
export type AccountSlot = ReactNode | ((initial: string) => ReactNode);
const resolveAccount = (account: AccountSlot | undefined, initial: string) => (typeof account === "function" ? account(initial) : account);

type TodayScreenProps = { account?: AccountSlot; onOpenDispenser?: () => void; onOpenSchedule?: () => void; onOpenVoice?: () => void; onOpenReminder?: (occurrenceId: string) => void };

export function TodayScreen({ account, onOpenDispenser, onOpenSchedule, onOpenVoice, onOpenReminder }: TodayScreenProps) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return <StateCard title="Loading your day…">Confirming authentication and loading schedules.</StateCard>;
  if (!isAuthenticated) return <div className="space-y-4"><TodayBrandHeader account={resolveAccount(account, "P")} /><AuthRequired message="Patient schedules are private and require Convex to accept your Clerk session." /></div>;
  return <AuthenticatedToday account={account} onOpenDispenser={onOpenDispenser} onOpenSchedule={onOpenSchedule} onOpenVoice={onOpenVoice} onOpenReminder={onOpenReminder} />;
}

function TodayBrandHeader({ account }: { account?: ReactNode }) {
  return (
    <header className="flex min-h-11 items-center justify-between">
      <p className="text-[1.25rem] font-semibold tracking-tight text-pd-text">PillSense</p>
      {account}
    </header>
  );
}

function StateCard({ title, children }: { title: string; children: ReactNode }) {
  return <section className="pd-card p-5"><h2 className="text-xl font-semibold text-pd-text">{title}</h2><div className="mt-2 text-sm leading-6 text-pd-muted">{children}</div></section>;
}

const runtimeLabels: Record<string, string> = {
  READY: "Ready",
  DISCONNECTED: "Not connected",
  CALIBRATION_REQUIRED: "Calibration required",
};

function AuthenticatedToday({ account, onOpenDispenser, onOpenSchedule, onOpenVoice, onOpenReminder }: TodayScreenProps) {
  const { user } = useUser();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const dashboard = useQuery(api.patient.dashboard);
  const doses = useQuery(api.occurrences.listForPatient, { now });
  const ensureDashboardShowcase = useMutation(api.demo.ensureDashboardShowcase);
  const showcaseRequested = useRef(false);

  useEffect(() => {
    if (dashboard?.status !== "ready" || !dashboard.isSynthetic || showcaseRequested.current) return;
    showcaseRequested.current = true;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    void ensureDashboardShowcase({ timezone }).catch(() => undefined);
  }, [dashboard, ensureDashboardShowcase]);

  const timeline = useMemo(() => {
    if (!dashboard || dashboard.status !== "ready" || !doses) return null;
    const medications: ScheduledMedication[] = dashboard.medications.filter((m) => m.localTime !== null).map((m) => ({ id: m.id, name: m.name, instructions: m.instructions ?? "", slot: m.slot, localTime: m.localTime!, weekdays: m.weekdays }));
    const occurrences: DoseOccurrence[] = doses.occurrences.map((o) => ({ id: o.id, mode: o.mode, medicationName: o.medicationName, instructions: o.instructions ?? "", slot: o.slot, scheduledFor: o.scheduledFor, eligibleFrom: o.eligibleFrom, expiresAt: o.expiresAt, attemptStatus: o.attemptStatus, ingestionReport: o.ingestionReport }));
    return buildTodayTimeline(medications, occurrences, now);
  }, [dashboard, doses, now]);

  if (dashboard === undefined || (dashboard.status === "ready" && (doses === undefined || timeline === null))) {
    return <div className="space-y-4"><TodayBrandHeader account={resolveAccount(account, "P")} /><StateCard title="Loading your day…">Listening for schedule updates from Convex.</StateCard></div>;
  }
  if (dashboard.status !== "ready") {
    const message = dashboard.status === "needs_onboarding"
      ? "No demo care team yet. Use the caregiver setup to explicitly create a synthetic patient relationship."
      : dashboard.status === "unauthorized"
        ? "This account does not have an active patient profile or caregiver relationship."
        : "The paired synthetic patient record could not be loaded.";
    return <div className="space-y-4"><TodayBrandHeader account={resolveAccount(account, "P")} /><StateCard title="Patient view unavailable">{message}</StateCard></div>;
  }

  const rows = timeline ?? [];
  const nextDose = pickNextDose(rows);
  const signedInName = firstName(user?.fullName ?? user?.firstName ?? dashboard.patientName);
  const device = doses?.device;
  const dueReminder = doses?.occurrences.find((dose) => dose.ingestionReport === "UNREPORTED" && dose.attemptStatus === "NONE" && now >= dose.eligibleFrom && now <= dose.expiresAt);
  const deviceView: TodayDevice = !device
    ? { label: "Dispenser", detail: "Open My Dispenser to pair Bluetooth", tone: "idle", connected: false }
    : { label: "Demo Dispenser", detail: runtimeLabels[device.state] ?? device.state.toLowerCase().replaceAll("_", " "), tone: device.connected && device.state === "READY" ? "ready" : "attention", connected: device.connected };
  return (
    <TodayView
      greeting={greetingFor(new Date(now).getHours())}
      name={signedInName}
      now={now}
      device={deviceView}
      nextDose={nextDose}
      timeline={rows}
      account={resolveAccount(account, signedInName.charAt(0).toUpperCase() || "P")}
      notifications={<RefillBell />}
      onOpenDispenser={onOpenDispenser}
      onOpenSchedule={onOpenSchedule}
      onOpenVoice={onOpenVoice}
      dueReminder={dueReminder ? { id: dueReminder.id, medicationName: dueReminder.medicationName } : undefined}
      onOpenReminder={onOpenReminder}
    />
  );
}
