"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { AuthRequired } from "./auth-required";
import { MedicationIcon, SectionTitle, StatusPill, type PillTone } from "./mobile-ui";
import { PatientReminders } from "./patient-reminders";
import { formatClock } from "@/lib/today";

type DoseRow = {
  id: string;
  mode: string;
  medicationName: string;
  slot: number;
  scheduledFor: number;
  expiresAt: number;
  attemptStatus: string;
  ingestionReport: "UNREPORTED" | "TAKEN" | "NOT_TAKEN";
};

const dayFormatter = new Intl.DateTimeFormat([], { weekday: "long", month: "short", day: "numeric" });

export function dayHeading(ms: number, now: number) {
  const dayStart = (value: number) => { const d = new Date(value); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const diff = Math.round((dayStart(ms) - dayStart(now)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return dayFormatter.format(ms);
}

export function doseStatus(dose: DoseRow, now: number): { label: string; tone: PillTone } {
  if (dose.ingestionReport === "TAKEN") return { label: "Reported taken", tone: "green" };
  if (dose.ingestionReport === "NOT_TAKEN") return { label: "Reported not taken", tone: "amber" };
  if (dose.expiresAt < now) return { label: "No report", tone: "amber" };
  if (dose.scheduledFor <= now) return { label: "Due", tone: "teal" };
  return { label: "Upcoming", tone: "slate" };
}

export function ScheduleScreen() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return <StateCard title="Loading schedule…">Confirming authentication.</StateCard>;
  if (!isAuthenticated) return <AuthRequired message="Schedules are private and require Convex to accept your Clerk session." />;
  return <AuthenticatedSchedule />;
}

function StateCard({ title, children }: { title: string; children: ReactNode }) {
  return <section className="ps-card p-5"><h2 className="ps-display text-xl font-semibold text-[#0f172a]">{title}</h2><div className="mt-2 text-sm leading-6 text-[#475569]">{children}</div></section>;
}

function AuthenticatedSchedule() {
  const [now, setNow] = useState(() => Date.now());
  const [view, setView] = useState<"upcoming" | "history">("upcoming");
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const dashboard = useQuery(api.patient.dashboard);
  const doses = useQuery(api.occurrences.listForPatient, { now });

  if (dashboard === undefined || doses === undefined) return <StateCard title="Loading schedule…">Listening for updates from Convex.</StateCard>;
  if (dashboard.status !== "ready") return <StateCard title="Schedule unavailable">This account does not have an active patient schedule to show.</StateCard>;

  const rows: DoseRow[] = doses.occurrences.map((o) => ({ id: o.id, mode: o.mode, medicationName: o.medicationName, slot: o.slot, scheduledFor: o.scheduledFor, expiresAt: o.expiresAt, attemptStatus: o.attemptStatus, ingestionReport: o.ingestionReport }));
  const isHistory = (dose: DoseRow) => dose.ingestionReport !== "UNREPORTED" || dose.expiresAt < now;
  const shown = rows.filter((dose) => (view === "history" ? isHistory(dose) : !isHistory(dose)));
  if (view === "history") shown.reverse();
  const groups = new Map<string, DoseRow[]>();
  for (const dose of shown) {
    const heading = dayHeading(dose.scheduledFor, now);
    groups.set(heading, [...(groups.get(heading) ?? []), dose]);
  }

  return (
    <div className="space-y-3">
      <section aria-labelledby="meds-title" className="space-y-1.5">
        <SectionTitle><span id="meds-title">Medications</span></SectionTitle>
        {dashboard.medications.length === 0 ? (
          <p className="ps-card p-4 text-sm text-[#475569]">No medications for {dashboard.patientName}. An authorized caregiver can add the first synthetic medication from caregiver setup.</p>
        ) : (
          <ul className="ps-card divide-y divide-[#e6eef6]">
            {dashboard.medications.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                <MedicationIcon size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[#0f172a]">{m.name}</span>
                  <span className="block truncate text-xs text-[#64748b]">Slot {m.slot} · {m.weekdays.map((d) => d.charAt(0) + d.slice(1).toLowerCase()).join(" ")}</span>
                  {m.instructions && <span className="block truncate text-xs text-[#64748b]">{m.instructions}</span>}
                </span>
                <span className="shrink-0 text-sm font-semibold text-[#0f766e]">{m.localTime}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div role="group" aria-label="Dose list view" className="grid grid-cols-2 gap-1 rounded-full bg-[#eaf2fb] p-0.5">
        {(["upcoming", "history"] as const).map((option) => (
          <button key={option} type="button" aria-pressed={view === option} onClick={() => setView(option)} className={`ps-focus min-h-11 rounded-full text-sm font-semibold transition ${view === option ? "ps-cta" : "text-[#475569]"}`}>
            {option === "upcoming" ? "Upcoming" : "History"}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="ps-card p-4 text-sm leading-6 text-[#475569]">
          {view === "upcoming" ? "No upcoming dose records. Records are generated ahead of each scheduled time." : "No reported or past dose records in the last 12 hours."}
        </p>
      ) : (
        [...groups.entries()].map(([heading, group]) => (
          <section key={heading} aria-label={heading} className="space-y-1.5">
            <SectionTitle>{heading}</SectionTitle>
            <ul className="ps-card divide-y divide-[#e6eef6]">
              {group.map((dose) => {
                const status = doseStatus(dose, now);
                return (
                  <li key={dose.id} className="flex min-h-[3.25rem] items-center gap-3 px-3 py-2">
                    <span className="w-[4rem] shrink-0 text-sm text-[#475569]">{formatClock(dose.scheduledFor)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[#0f172a]">{dose.medicationName}{dose.mode === "demo" ? " · demo" : ""}</span>
                      <span className="block text-xs text-[#64748b]">Slot {dose.slot}{dose.attemptStatus === "COMPLETED" ? " · motor completed (not proof of ingestion)" : ""}</span>
                    </span>
                    <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      <PatientReminders />
    </div>
  );
}
