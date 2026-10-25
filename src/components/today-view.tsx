"use client";

import { useId, type ReactNode } from "react";
import { DispenserVisual, type DispenserTone } from "./dispenser-visual";
import { BrandMark, Icon } from "./mobile-ui";
import { compactDoseLine, countdownLabel, describeDose, timelineStateLabel, type TimelineRow, type TimelineState } from "../lib/today";
import { medicationCardAction } from "../lib/demo-navigation";

export type TodayDevice = { label: string; detail?: string; tone: DispenserTone; connected: boolean };

export type TodayViewProps = {
  greeting: string;
  name: string;
  /** Epoch ms for the date line and countdowns; owned by the container so rendering stays pure. */
  now: number;
  device: TodayDevice;
  nextDose: TimelineRow | null;
  timeline: TimelineRow[];
  account?: ReactNode;
  notifications?: ReactNode;
  onOpenDispenser?: () => void;
  onOpenSchedule?: () => void;
  onOpenVoice?: () => void;
  dueReminder?: { id: string; medicationName: string };
  onOpenReminder?: (occurrenceId: string) => void;
};

/** "1 tablet · With breakfast", falling back to the slot when there is no instruction text. */
function nextDoseLine(row: TimelineRow) {
  return row.instructions ? compactDoseLine(row) : `${describeDose(row).dosage} · Slot ${row.slot}`;
}

export function TodayView({ greeting, name, now, device, nextDose, timeline, account, notifications, onOpenDispenser, onOpenSchedule, onOpenVoice, dueReminder, onOpenReminder }: TodayViewProps) {
  const countdown = nextDose ? countdownLabel(nextDose.at, now) : null;
  const medicationDue = Boolean(nextDose?.occurrenceId && nextDose.occurrenceId === dueReminder?.id);
  const openMedication = medicationCardAction({ occurrenceId: nextDose?.occurrenceId ?? null, dueReminderId: dueReminder?.id, onOpenReminder, onOpenVoice, onOpenSchedule });
  const dateLabel = new Date(now).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const activeSlot = nextDose && nextDose.slot >= 1 && nextDose.slot <= 7 ? nextDose.slot : null;
  const takenCount = timeline.filter((row) => row.state === "TAKEN").length;
  const allTaken = timeline.length > 0 && takenCount === timeline.length;

  return (
    <div className="space-y-5 overflow-x-clip">
      <header className="flex min-h-10 items-center justify-between">
        <div className="flex items-center gap-2">
          <BrandMark size={28} />
          <p className="text-lg font-semibold tracking-tight text-pd-text">PillSense</p>
        </div>
        <div className="flex items-center gap-2">
          {notifications}
          {account}
        </div>
      </header>

      <section aria-label="Greeting" className="flex items-end justify-between gap-3 pb-1">
        <div className="min-w-0">
          <p className="text-base font-medium leading-tight text-pd-text/85">{greeting}</p>
          <h1 className="truncate text-[2rem] font-bold leading-[1.05] tracking-tight text-pd-text">{name ? `${name}.` : "Welcome."}</h1>
          <p className="mt-1 text-sm text-pd-muted">{dateLabel}</p>
        </div>
        {timeline.length > 0 && <TakenRing taken={takenCount} total={timeline.length} />}
      </section>

      <section aria-labelledby="next-med-title">
        <button type="button" onClick={openMedication} disabled={!nextDose || !openMedication} aria-label={nextDose ? medicationDue ? `Start reminder for ${nextDose.medicationName}` : `${nextDose.medicationName} at ${nextDose.timeLabel}, open ${onOpenVoice ? "Voice Companion" : "schedule"}` : undefined} className="pd-card-hero pd-focus pd-press w-full p-3.5 text-left">
        <div className="flex items-center justify-between gap-3">
          <h2 id="next-med-title" className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-pd-muted">
            {medicationDue ? "Medication due" : nextDose ? "Next medication" : "Today"}
          </h2>
        </div>
        {nextDose ? (
          <>
            <div className="mt-3 flex min-h-12 w-full items-center gap-3 text-left">
              <PillTile />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-semibold leading-snug text-pd-text">{nextDose.medicationName}</span>
                <span className="block truncate text-sm text-pd-text/80">{nextDoseLine(nextDose)}</span>
              </span>
              <Icon name="chevron" size={17} className="shrink-0 text-pd-muted" />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-pd-line pt-3">
              <p className="text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums text-pd-text">{nextDose.timeLabel}</p>
              <span className="shrink-0 rounded-full border border-pd-ok/40 bg-pd-ok/10 px-3 py-1.5 text-sm font-semibold text-pd-ok">{medicationDue ? "Due now" : countdown ?? "Upcoming"}</span>
            </div>
          </>
        ) : (
          <div className="py-2">
            <p className="text-base font-semibold text-pd-text">{allTaken ? "You’re all set for today." : timeline.length > 0 ? "No more doses today." : "Nothing scheduled today."}</p>
            <p className="mt-1 text-sm text-pd-muted">{allTaken ? "Your reports are up to date." : timeline.length > 0 ? "Check the schedule below for doses that need confirmation." : "Your schedule has no entries for today."}</p>
          </div>
        )}
        </button>
      </section>

      <section aria-label="Dispenser" className="relative pb-4 pt-8">
        <button type="button" onClick={onOpenDispenser} disabled={!onOpenDispenser} aria-label="Open My Dispenser" className="pd-focus block w-full rounded-pd-card transition-transform duration-300 active:scale-[0.99]">
          <DispenserVisual activeSlot={activeSlot} tone={device.connected ? "ready" : "idle"} />
        </button>
        <button type="button" onClick={onOpenDispenser} disabled={!onOpenDispenser} aria-label={`${device.connected ? "Connected" : "Disconnected"}, open My Dispenser`} className="pd-press pd-focus absolute right-1 top-0 inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 text-[0.6875rem] font-medium text-white">
          <span aria-hidden="true" className={`size-2 rounded-full ${device.connected ? "bg-pd-ok shadow-[0_0_8px_rgba(53,213,138,0.95)]" : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]"}`} />
          {device.connected ? "Connected" : "Disconnected"}
          <Icon name="chevron" size={13} className="text-white/70" />
        </button>
      </section>

      <section aria-labelledby="today-schedule-title">
        <div className="flex items-center justify-between">
          <h2 id="today-schedule-title" className="text-base font-semibold text-pd-text">Today’s schedule</h2>
          {onOpenSchedule && <button type="button" onClick={onOpenSchedule} className="pd-focus -mr-2 min-h-10 rounded-full px-2 text-sm font-medium text-pd-accent-soft">See all</button>}
        </div>
        {timeline.length === 0 ? (
          <p className="mt-1 text-sm text-pd-muted">Nothing is scheduled for today.</p>
        ) : (
          <ol className="pd-card mt-2 divide-y divide-pd-line overflow-hidden">
            {timeline.map((row) => <ScheduleRow key={row.key} row={row} onOpen={onOpenSchedule} />)}
          </ol>
        )}
      </section>

      <button type="button" onClick={onOpenVoice} disabled={!onOpenVoice} aria-label="Open Voice Companion" className="pd-ai pd-press pd-focus relative flex min-h-24 w-full items-center gap-3 overflow-hidden p-4 text-left">
        <WaveBackdrop />
        <span className="relative z-10 min-w-0 flex-1">
          <span className="block text-lg font-semibold leading-tight text-pd-text">I’ll remind you when it’s time.</span>
          <span className="mt-1 block text-sm leading-snug text-pd-text/70">Ask your PillSense companion anytime.</span>
        </span>
        <span aria-hidden="true" className="relative z-10 grid size-11 shrink-0 place-items-center rounded-full border border-white/25 bg-gradient-to-br from-pd-accent to-pd-accent-2 text-white shadow-[0_8px_20px_-8px_rgba(84,121,255,0.9)]">
          <Icon name="arrow" size={20} strokeWidth={2} />
        </span>
      </button>
    </div>
  );
}

const stateTextClass: Record<TimelineState, string> = {
  TAKEN: "text-pd-ok", NEEDS_CONFIRMATION: "text-red-400", UPCOMING: "text-pd-accent-soft",
};

function ScheduleRow({ row, onOpen }: { row: TimelineRow; onOpen?: () => void }) {
  const sub = timelineStateLabel[row.state];
  return (
    <li>
      <button type="button" onClick={onOpen} disabled={!onOpen} className="pd-press pd-focus flex min-h-[3.75rem] w-full items-center gap-3 px-3 py-2 text-left">
        <span className="w-[4.15rem] shrink-0 text-sm font-semibold tabular-nums text-pd-text">{row.timeLabel}</span>
        <TimelineDot state={row.state} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-pd-text">{row.medicationName}</span>
          <span className="block truncate text-xs text-pd-muted">{row.instructions ? compactDoseLine(row) : `Slot ${row.slot}`}</span>
        </span>
        <span className={`max-w-[4.5rem] shrink-0 text-right text-[0.6875rem] font-medium leading-tight ${stateTextClass[row.state]}`}>{sub}</span>
      </button>
    </li>
  );
}

function TimelineDot({ state }: { state: TimelineState }) {
  const base = "size-2.5 shrink-0 rounded-full transition-colors duration-300";
  if (state === "TAKEN") return <span aria-hidden="true" className={`${base} bg-pd-ok shadow-[0_0_0_4px_rgba(53,213,138,0.15)]`} />;
  if (state === "NEEDS_CONFIRMATION") return <span aria-hidden="true" className={`${base} bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.15)]`} />;
  return <span aria-hidden="true" className={`${base} bg-pd-muted/50`} />;
}

/** Today's progress: how many scheduled doses have a "taken" report. */
function TakenRing({ taken, total }: { taken: number; total: number }) {
  const r = 22;
  const circumference = 2 * Math.PI * r;
  return (
    <div role="img" aria-label={`${taken} of ${total} doses taken today`} className="relative grid size-[3.75rem] shrink-0 place-items-center">
      <svg viewBox="0 0 56 56" className="absolute inset-0 -rotate-90 drop-shadow-[0_0_8px_rgba(53,213,138,0.45)]">
        <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="5" />
        <circle cx="28" cy="28" r={r} fill="none" stroke="#35d58a" strokeWidth="5" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - taken / total)} style={{ transition: "stroke-dashoffset 600ms ease" }} />
      </svg>
      <span className="text-sm font-bold tabular-nums text-pd-text">{taken}/{total}</span>
    </div>
  );
}

/** Dark medication tile with a capsule glyph. Decorative: it is not a photo of the real pill. */
export function PillTile() {
  // Unique gradient ids: every tab stays mounted, and a gradient defined inside a hidden tab does not resolve.
  const id = useId().replaceAll(":", "");
  const teal = `${id}-teal`;
  const violet = `${id}-violet`;
  return (
    <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-pd-chip border border-pd-accent-soft/40 bg-gradient-to-br from-[#3a3797] to-[#12163f] shadow-[0_0_18px_rgba(119,116,255,0.55),0_0_6px_rgba(94,234,212,0.35)]">
      <svg viewBox="0 0 40 40" className="size-7 drop-shadow-[0_0_6px_rgba(163,161,255,0.9)]">
        <defs>
          <linearGradient id={teal} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#7ee8d4" /><stop offset="1" stopColor="#5eead4" /></linearGradient>
          <linearGradient id={violet} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8b8cff" /><stop offset="1" stopColor="#c084fc" /></linearGradient>
        </defs>
        <g transform="rotate(-40 20 20)"><rect x="4" y="12.5" width="32" height="15" rx="7.5" fill={`url(#${teal})`} /><path d="M20 12.5h8.5a7.5 7.5 0 0 1 0 15H20Z" fill={`url(#${violet})`} /><rect x="8" y="15" width="12" height="2.5" rx="1.25" fill="#fff" opacity="0.7" /></g>
      </svg>
    </span>
  );
}

/** Two slow, low-contrast waves behind the AI panel copy. Stops under prefers-reduced-motion. */
function WaveBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-14 overflow-hidden">
      <svg viewBox="0 0 800 60" preserveAspectRatio="none" className="pd-wave absolute bottom-0 left-0 h-full w-[200%]" style={{ animationDuration: "18s" }}><path d="M0 34 Q100 6 200 34 T400 34 T600 34 T800 34 V60 H0 Z" fill="#7774ff" fillOpacity="0.28" /></svg>
      <svg viewBox="0 0 800 60" preserveAspectRatio="none" className="pd-wave absolute bottom-0 left-0 h-3/4 w-[200%]" style={{ animationDuration: "26s" }}><path d="M0 30 Q100 54 200 30 T400 30 T600 30 T800 30 V60 H0 Z" fill="#5479ff" fillOpacity="0.3" /></svg>
    </div>
  );
}
