"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";

const scenarioLabels = {
  DUE_REMINDER: "Due reminder",
  UNANSWERED_ROUTINE: "Unanswered routine",
  OVERDUE_ESCALATION: "Overdue escalation",
  DEVICE_UNRESOLVED: "Device unresolved",
} as const;

function errorText(value: unknown) {
  return value instanceof Error ? value.message : "The reminder operation failed.";
}

export function PatientReminders() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading || !isAuthenticated) return null;
  return <AuthenticatedReminders />;
}

function AuthenticatedReminders() {
  const reminders = useQuery(api.reminders.forPatient);
  const reconcile = useMutation(api.reminders.reconcileMine);
  const runScenario = useMutation(api.reminders.runDemoScenario);
  const resetScenarios = useMutation(api.reminders.resetDemoScenarios);
  const configureWindows = useMutation(api.reminders.configureDemoWindows);
  const upcomingMinutesRef = useRef<HTMLInputElement>(null);
  const followUpMinutesRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void reconcile({}).catch((caught) => setError(errorText(caught)));
    const timer = window.setInterval(() => {
      void reconcile({}).catch((caught) => setError(errorText(caught)));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [reconcile]);

  async function perform(operation: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await operation();
      setMessage(success);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  if (reminders === undefined) {
    return <section className="ps-card p-5 text-sm text-[#475569]">Loading reminders…</section>;
  }

  return (
    <section aria-labelledby="reminders-title" className="ps-card ps-legacy-scope p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[0.7rem] font-bold uppercase tracking-[0.14em] text-[#0f766e]">In-app reminders</p>
          <h2 id="reminders-title" className="ps-display mt-1 text-xl font-semibold text-[#0f172a]">Medication routine</h2>
          <p className="mt-2 text-sm leading-6 text-[#475569]">
            Reminders are independent of the motor. A completed motor operation never confirms ingestion.
          </p>
        </div>
        <span className="rounded-full bg-[#e3efff] px-3 py-1 text-xs font-semibold text-[#1e4f8a]">
          Follow-up window: {reminders.windows.followUpWindowMinutes} min
        </span>
      </div>

      {reminders.reminders.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-[#f1f7fd] p-4 text-sm text-[#475569]">
          No upcoming or due reminders are currently in the reminder window.
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          {reminders.reminders.map((reminder) => (
            <article key={reminder.occurrenceId} className="rounded-2xl border border-[#dbe7f3] bg-[#f8fbff] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-[#0f766e]">
                    {reminder.mode === "demo" ? "DEMO · " : ""}{reminder.state}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold">{reminder.medicationName}</h3>
                </div>
                <span className="rounded-full bg-[#0f172a] px-3 py-1 text-xs font-bold text-white">
                  Slot {reminder.slot}
                </span>
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-700">
                Due {new Date(reminder.dueAt).toLocaleString()}
              </p>
              <p className="mt-2 text-sm text-slate-600">
                {reminder.followUpNeeded
                  ? "Patient follow-up is needed until a direct patient report resolves this routine."
                  : "Upcoming; no follow-up is currently needed."}
              </p>
              <p className="mt-2 text-xs text-slate-500">Patient report: {reminder.ingestionReport.replaceAll("_", " ")}</p>
            </article>
          ))}
        </div>
      )}

      {reminders.isSynthetic && (
        <details className="mt-5 rounded-2xl border border-dashed border-[#c4b5fd] bg-[#f5f3ff] p-4"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold text-[#4c1d95]">DEMO MODE · AUDITED TIME SIMULATION</summary><div className="mt-2">
          <p className="text-sm leading-6 text-slate-600">
            These controls create labeled synthetic occurrences and case transitions. They do not authorize dispensing or reload the one-pill compartment.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {Object.entries(scenarioLabels).map(([scenario, label]) => (
              <button
                key={scenario}
                type="button"
                disabled={busy}
                onClick={() => perform(
                  () => runScenario({ scenario: scenario as keyof typeof scenarioLabels }),
                  `${label} scenario created.`,
                )}
                className="min-h-11 rounded-full border border-violet-300 bg-white px-4 py-2 text-sm font-semibold text-violet-800 disabled:opacity-50"
              >
                Simulate {label}
              </button>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="text-sm font-medium text-slate-700">
              Upcoming window (minutes)
              <input ref={upcomingMinutesRef} className="input mt-1" type="number" min={1} max={120} defaultValue={reminders.windows.upcomingWindowMinutes} />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Follow-up window (minutes)
              <input ref={followUpMinutesRef} className="input mt-1" type="number" min={1} max={60} defaultValue={reminders.windows.followUpWindowMinutes} />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => perform(
                () => configureWindows({
                  upcomingWindowMinutes: Number(upcomingMinutesRef.current?.value),
                  followUpWindowMinutes: Number(followUpMinutesRef.current?.value),
                }),
                "Demo reminder windows saved.",
              )}
              className="min-h-11 rounded-full bg-violet-700 px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              Save windows
            </button>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => perform(() => resetScenarios({}), "Synthetic scenarios closed; audit records retained.")}
            className="mt-4 min-h-11 text-sm font-semibold text-violet-800 underline disabled:opacity-50"
          >
            Reset synthetic reminder scenarios
          </button>
        </div></details>
      )}

      {message && <p aria-live="polite" className="mt-4 rounded-2xl bg-[#d9f5ef] p-3 text-sm text-[#0b4f45]">{message}</p>}
      {error && <p role="alert" className="mt-4 rounded-2xl bg-[#fde4e4] p-3 text-sm text-[#8f1d1d]">{error}</p>}
    </section>
  );
}
