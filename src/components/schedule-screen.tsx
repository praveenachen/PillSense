"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { AuthRequired } from "./auth-required";
import { Icon } from "./mobile-ui";
import { dayHeading, doseDisplayState, dosesForRange, dosesForWeek, localDayKey, weekWindow, reportedTakenProgress, scheduleDayFormatter, uniqueOccurrences, type DoseDisplayState, type ScheduleDose, type ScheduleMedication, type ScheduleReminder } from "@/lib/schedule";
import { compactDoseLine, formatClock } from "@/lib/today";

const weekdayLabels: Record<string, string> = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun" };

export function ScheduleScreen() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return <StateCard title="Loading schedule…">Confirming authentication.</StateCard>;
  if (!isAuthenticated) return <AuthRequired dark message="Schedules are private and require Convex to accept your Clerk session." />;
  return <AuthenticatedSchedule />;
}

function StateCard({ title, children }: { title: string; children: ReactNode }) {
  return <section className="pd-card p-5"><h2 className="text-xl font-semibold text-pd-text">{title}</h2><div className="mt-2 text-sm leading-6 text-pd-muted">{children}</div></section>;
}

function AuthenticatedSchedule() {
  const [now, setNow] = useState(() => Date.now());
  const dashboard = useQuery(api.patient.dashboard);
  const weeksStart = weekWindow(now, -1).start;
  const weeksEnd = weekWindow(now, 1).end;
  const doses = useQuery(api.occurrences.listForPatient, { now, rangeStart: weeksStart, rangeEnd: weeksEnd });
  const reminders = useQuery(api.reminders.forPatient);
  const reconcileReminders = useMutation(api.reminders.reconcileMine);

  useEffect(() => {
    void reconcileReminders({}).catch(() => undefined);
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void reconcileReminders({}).catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [reconcileReminders]);

  if (dashboard === undefined || doses === undefined || reminders === undefined) return <StateCard title="Loading schedule…">Listening for protected schedule updates.</StateCard>;
  if (dashboard.status !== "ready") return <StateCard title="Schedule unavailable">This account does not have an active patient schedule to show.</StateCard>;

  const rows: ScheduleDose[] = doses.occurrences.map((dose) => ({
    id: dose.id,
    medicationName: dose.medicationName,
    instructions: dose.instructions ?? "",
    slot: dose.slot,
    scheduledFor: dose.scheduledFor,
    expiresAt: dose.expiresAt,
    attemptStatus: dose.attemptStatus,
    ingestionReport: dose.ingestionReport,
  }));
  // Unscheduled (e.g. scanned OTC) medications have no time or timezone and are not part of the schedule.
  const medications: ScheduleMedication[] = dashboard.medications.flatMap((medication) => medication.localTime === null || medication.timezone === null ? [] : [{
    id: medication.id,
    name: medication.name,
    instructions: medication.instructions ?? "",
    slot: medication.slot,
    localTime: medication.localTime,
    weekdays: medication.weekdays,
    timezone: medication.timezone,
  }]);
  const reminderRows: ScheduleReminder[] = reminders.reminders.map((reminder) => ({
    occurrenceId: reminder.occurrenceId,
    followUpNeeded: reminder.followUpNeeded,
  }));

  return <ScheduleView now={now} doses={rows} medications={medications} reminders={reminderRows} />;
}

export function ScheduleView({ now, doses, medications, reminders }: { now: number; doses: readonly ScheduleDose[]; medications: readonly ScheduleMedication[]; reminders: readonly ScheduleReminder[] }) {
  const [range, setRange] = useState<"today" | "week">("today");
  const [showMedications, setShowMedications] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const ordered = useMemo(() => uniqueOccurrences(doses), [doses]);
  const today = dosesForRange(ordered, now, "today");
  const visible = range === "today" ? today : dosesForWeek(ordered, now, weekOffset);
  const progress = reportedTakenProgress(today);
  const nextActionable = today.find((dose) => dose.ingestionReport === "UNREPORTED" && dose.scheduledFor > now);
  const reminderByOccurrence = new Map(reminders.map((reminder) => [reminder.occurrenceId, reminder]));
  const activity = [...ordered]
    .filter((dose) => dose.scheduledFor <= now)
    .sort((a, b) => b.scheduledFor - a.scheduledFor);
  const activityShown = showAllActivity ? activity : activity.slice(0, 3);
  const groups = new Map<string, ScheduleDose[]>();
  for (const dose of visible) {
    const key = localDayKey(dose.scheduledFor);
    groups.set(key, [...(groups.get(key) ?? []), dose]);
  }

  return (
    <div className="space-y-5 text-pd-text">
      <header className="flex min-h-11 items-center justify-between">
        <h1 className="text-[1.55rem] font-semibold tracking-tight">Schedule</h1>
        <a href="/caregiver" aria-label="Open authorized medication setup" className="pd-press pd-focus grid size-10 place-items-center rounded-full border border-pd-line bg-pd-surface-2 text-pd-accent-soft shadow-[0_0_20px_rgba(119,116,255,0.12)]">
          <Icon name="plus" size={20} strokeWidth={2} />
        </a>
      </header>

      <div role="group" aria-label="Schedule date range" className="grid grid-cols-2 rounded-pd-chip border border-pd-line bg-pd-surface p-1">
        {(["today", "week"] as const).map((option) => (
          <button key={option} type="button" aria-pressed={range === option} onClick={() => setRange(option)} className={`pd-focus min-h-10 rounded-[0.7rem] text-sm font-semibold transition-colors ${range === option ? "bg-pd-surface-2 text-pd-text shadow-[0_3px_14px_rgba(0,0,0,0.3)]" : "text-pd-muted"}`}>
            {option === "today" ? "Today" : "This Week"}
          </button>
        ))}
      </div>

      <section aria-labelledby="schedule-timeline-title">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-pd-accent-soft">{range === "today" ? scheduleDayFormatter.format(now) : "See what’s up next"}</p><h2 id="schedule-timeline-title" className="mt-1 text-lg font-semibold">{range === "today" ? "Today’s timeline" : weekOffset === 0 ? "This week" : weekOffset === 1 ? "Next week" : "Last week"}</h2></div>
          {range === "today" ? (
            <span className="text-xs text-pd-muted">{visible.length} {visible.length === 1 ? "dose" : "doses"}</span>
          ) : (
            <div className="relative shrink-0">
              <select aria-label="Choose a week" value={weekOffset} onChange={(event) => setWeekOffset(Number(event.target.value))} className="pd-focus min-h-10 appearance-none rounded-full border border-pd-line bg-pd-surface-2 py-2 pl-4 pr-9 text-sm font-semibold text-pd-text">
                {[-1, 0, 1].map((offset) => <option key={offset} value={offset}>{weekRangeLabel(now, offset)}</option>)}
              </select>
              <Icon name="chevron" size={14} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 rotate-90 text-pd-muted" />
            </div>
          )}
        </div>
        {visible.length === 0 ? (
          <div className="pd-card p-5"><p className="font-semibold">Nothing scheduled {range === "today" ? "today" : weekOffset === 0 ? "this week" : weekOffset === 1 ? "next week" : "last week"}.</p><p className="mt-1 text-sm leading-5 text-pd-muted">Only persisted dose occurrences appear here.</p></div>
        ) : (
          <div className={range === "week" ? "divide-y divide-pd-line" : "space-y-5"}>
            {[...groups.values()].map((group) => (
              <section key={localDayKey(group[0].scheduledFor)} aria-label={dayHeading(group[0].scheduledFor, now)} className={range === "week" ? "py-5 first:pt-0 last:pb-0" : undefined}>
                {range === "week" && <h3 className={`mb-2.5 text-base font-semibold ${dayHeading(group[0].scheduledFor, now) === "Today" ? "text-pd-ok" : "text-pd-accent-soft"}`}>{dayHeading(group[0].scheduledFor, now)}</h3>}
                <ol className="space-y-2">
                  {group.map((dose, index) => <DoseTimelineRow key={dose.id} dose={dose} now={now} highlighted={dose.id === nextActionable?.id} last={index === group.length - 1} />)}
                </ol>
              </section>
            ))}
          </div>
        )}
      </section>

      {range === "today" && (
        <>
      <section aria-labelledby="schedule-progress-title" className="pd-card p-4">
        <div className="flex items-center justify-between gap-3"><div><h2 id="schedule-progress-title" className="font-semibold">Today’s progress</h2><p className="mt-1 text-sm text-pd-muted">{progress.taken} / {progress.total} reported taken</p></div><span className="text-sm font-semibold text-pd-accent-soft">{progress.percent}%</span></div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-pd-surface-2" role="progressbar" aria-label="Doses reported taken today" aria-valuemin={0} aria-valuemax={Math.max(1, progress.total)} aria-valuenow={progress.taken} aria-valuetext={`${progress.taken} of ${progress.total} reported taken`}><div className="h-full rounded-full bg-gradient-to-r from-pd-accent to-pd-accent-2 transition-[width]" style={{ width: `${progress.percent}%` }} /></div>
        <p className="mt-2 text-[0.68rem] leading-4 text-pd-muted">Based only on explicit patient reports.</p>
      </section>

      <section aria-labelledby="recent-activity-title">
        <div className="mb-2 flex min-h-10 items-center justify-between"><h2 id="recent-activity-title" className="text-lg font-semibold">Recent activity</h2><button type="button" onClick={() => setShowAllActivity((show) => !show)} className="pd-focus -mr-2 min-h-10 rounded-full px-2 text-sm font-medium text-pd-accent-soft">{showAllActivity ? "Show less" : "See all"}</button></div>
        {activityShown.length === 0 ? <p className="pd-card p-4 text-sm text-pd-muted">No persisted dose activity yet.</p> : <ul className="divide-y divide-pd-line overflow-hidden rounded-pd-card border border-pd-line bg-pd-surface">{activityShown.map((dose) => <ActivityRow key={dose.id} dose={dose} now={now} reminder={reminderByOccurrence.get(dose.id)} />)}</ul>}
      </section>

      <section className="overflow-hidden rounded-pd-chip border border-pd-line bg-pd-surface">
        <button type="button" aria-expanded={showMedications} aria-controls="full-schedule" onClick={() => setShowMedications((open) => !open)} className="pd-press pd-focus flex min-h-12 w-full items-center justify-between px-4 text-sm font-semibold">
          <span>View full schedule</span><Icon name="chevron" size={17} className={`transition-transform duration-200 ${showMedications ? "-rotate-90" : "rotate-90"}`} />
        </button>
        {showMedications && <MedicationSchedule id="full-schedule" medications={medications} />}
      </section>
        </>
      )}
    </div>
  );
}

function weekRangeLabel(now: number, offset: number) {
  const { start, end } = weekWindow(now, offset);
  const format = (value: number) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${format(start)} – ${format(end - 1)}`;
}

function DoseTimelineRow({ dose, now, highlighted, last }: { dose: ScheduleDose; now: number; highlighted: boolean; last: boolean }) {
  const state = doseDisplayState(dose, now);
  const status = doseStatusPresentation(state, dose, now);
  return (
    <li className="grid grid-cols-[3.6rem_0.85rem_minmax(0,1fr)] gap-2">
      <time dateTime={new Date(dose.scheduledFor).toISOString()} className={`pt-4 text-xs font-semibold ${highlighted ? "text-pd-accent-soft" : "text-pd-muted"}`}>{formatClock(dose.scheduledFor)}</time>
      <div className="relative flex justify-center pt-[1.15rem]"><span aria-hidden="true" className={`relative z-10 size-2.5 rounded-full ${status.dot}`} />{!last && <span aria-hidden="true" className="absolute bottom-[-0.75rem] top-[1.45rem] w-px bg-pd-line" />}</div>
      <details className={`group overflow-hidden rounded-pd-card border p-3.5 ${highlighted ? "border-pd-accent-soft/45 bg-[linear-gradient(135deg,rgba(119,116,255,0.14),rgba(84,121,255,0.06))] shadow-[0_0_24px_rgba(119,116,255,0.14)]" : state === "UPCOMING" ? "border-pd-line bg-pd-surface/75" : "border-pd-line bg-pd-surface"}`}>
        <summary className="pd-focus flex min-h-11 cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-full ${status.icon}`}><Icon name="pill" size={18} /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{dose.medicationName}</span><span className="mt-0.5 block truncate text-xs text-pd-muted">{compactDoseLine(dose)} · Slot {dose.slot}</span></span>
          <span className={`shrink-0 rounded-full px-2 py-1 text-[0.65rem] font-semibold ${status.badge}`}>{status.label}</span>
        </summary>
        <div className="mt-2 border-t border-pd-line pt-3 text-xs leading-5 text-pd-muted"><p>{dose.instructions || "No additional instructions."}</p><p className="mt-1">Assigned to Slot {dose.slot}.</p>{dose.attemptStatus === "UNKNOWN" && <p className="mt-1 text-pd-warn">Dispense outcome is uncertain; no ingestion result is inferred.</p>}</div>
      </details>
    </li>
  );
}

/** Same three states as the Today page: Complete, Incomplete (time passed without a "taken" report) and Upcoming. */
function doseStatusPresentation(state: DoseDisplayState, dose: ScheduleDose, now: number) {
  if (state === "TAKEN") return { label: "Complete", dot: "bg-pd-ok shadow-[0_0_0_4px_rgba(53,213,138,0.15)]", icon: "bg-pd-ok/12 text-pd-ok", badge: "bg-pd-ok/12 text-pd-ok" };
  if (dose.scheduledFor <= now) return { label: "Incomplete", dot: "bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.15)]", icon: "bg-red-500/12 text-red-400", badge: "bg-red-500/12 text-red-400" };
  return { label: "Upcoming", dot: "bg-pd-muted/50", icon: "bg-pd-accent/12 text-pd-accent-soft", badge: "bg-pd-surface-2 text-pd-accent-soft" };
}

function MedicationSchedule({ id, medications }: { id: string; medications: readonly ScheduleMedication[] }) {
  return (
    <div id={id} className="border-t border-pd-line">
      {medications.length === 0 ? <p className="p-4 text-sm text-pd-muted">No active medication schedules.</p> : <ul className="divide-y divide-pd-line">{medications.map((medication) => (
        <li key={medication.id} className="flex gap-3 px-4 py-3"><span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-pd-accent/12 text-pd-accent-soft"><Icon name="pill" size={17} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{medication.name}</span><span className="mt-0.5 block text-xs leading-5 text-pd-muted">{medication.instructions || "No additional instructions"}</span><span className="block text-[0.68rem] leading-5 text-pd-muted">Slot {medication.slot} · {medication.weekdays.map((day) => weekdayLabels[day] ?? day).join(" ")} · {medication.timezone}</span></span><time className="shrink-0 pt-1 text-xs font-semibold text-pd-accent-soft">{medication.localTime}</time></li>
      ))}</ul>}
    </div>
  );
}

function ActivityRow({ dose, now, reminder }: { dose: ScheduleDose; now: number; reminder?: ScheduleReminder }) {
  const state = doseDisplayState(dose, now);
  const status = doseStatusPresentation(state, dose, now);
  const label = dose.attemptStatus === "UNKNOWN"
    ? "Dispense outcome uncertain · no ingestion report"
    : reminder?.followUpNeeded && dose.ingestionReport === "UNREPORTED"
      ? "Follow-up needed"
      : state === "TAKEN"
        ? "Patient reported taken"
        : state === "NOT_TAKEN"
          ? "Patient reported not taken"
          : state === "UNRESOLVED"
            ? "No report · unresolved"
            : "Due · awaiting report";
  return <li className="flex min-h-[3.6rem] items-center gap-3 px-4 py-2.5"><span aria-hidden="true" className={`grid size-8 shrink-0 place-items-center rounded-full ${status.icon}`}><Icon name={state === "TAKEN" ? "check" : state === "UNRESOLVED" ? "alert" : "clock"} size={16} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{dose.medicationName}</span><span className="block truncate text-xs text-pd-muted">{label}</span></span><time className="shrink-0 text-[0.68rem] text-pd-muted">{dayHeading(dose.scheduledFor, now)}<span className="block text-right">{formatClock(dose.scheduledFor)}</span></time></li>;
}
