"use client";

import { useState, type ReactNode } from "react";
import { BrandMark, Icon, MedicationIcon, ScenicAccent, StatusPill, SunGlyph, type PillTone } from "./mobile-ui";
import { describeDose, timelineStateLabel, type TimelineRow, type TimelineState } from "../lib/today";

export type TodayDevice = { label: string; detail?: string; tone: "ready" | "attention" | "idle" };

export type TodayViewProps = {
  greeting: string;
  name: string;
  summary: string;
  device: TodayDevice;
  nextDose: TimelineRow | null;
  timeline: TimelineRow[];
  account?: ReactNode;
  supply?: ReactNode;
  onOpenDispenser?: () => void;
  onOpenSchedule?: () => void;
  markTaken?: { busy: boolean; error: string | null; onConfirm: () => void };
};

const stateTone: Record<TimelineState, PillTone> = {
  TAKEN: "green",
  NOT_TAKEN: "amber",
  DUE: "teal",
  NEXT: "mist",
  UPCOMING: "slate",
  NO_REPORT: "amber",
};

export function TodayView({ greeting, name, summary, device, nextDose, timeline, account, supply, onOpenDispenser, onOpenSchedule, markTaken }: TodayViewProps) {
  const [confirming, setConfirming] = useState(false);
  const canReport = Boolean(nextDose?.occurrenceId && markTaken);
  const dose = nextDose ? describeDose(nextDose) : null;

  return (
    <div className="space-y-3">
      <header className="flex items-center gap-3">
        <BrandMark size={44} />
        <div className="min-w-0 flex-1">
          <p className="ps-display text-[1.3rem] font-bold leading-none text-[#0f172a]">PillSense</p>
          <p className="mt-1 text-xs text-[#64748b]">Care, connected.</p>
        </div>
        {account}
      </header>

      <section className="relative pb-1 pt-3">
        <ScenicAccent />
        <div className="relative">
          <p className="ps-greeting text-[1.4rem] font-normal leading-tight text-[#0f172a]">{greeting}</p>
          <h1 className="ps-greeting text-[1.85rem] font-semibold leading-[1.1] text-[#0f172a]">{name ? `${name}.` : "welcome."}</h1>
          <p className="mt-1.5 flex items-center gap-2 text-sm text-[#334155]">{summary}<SunGlyph /></p>
        </div>
      </section>

      <DeviceCard device={device} onOpen={onOpenDispenser} />

      <section aria-labelledby="next-med-title" className="ps-card p-3.5">
        <div className="flex items-center justify-between">
          <h2 id="next-med-title" className="text-[0.7rem] font-bold uppercase tracking-[0.08em] text-[#334155]">{nextDose?.state === "DUE" ? "Due now" : "Next medication"}</h2>
          {nextDose && <span className="rounded-full bg-[#fdf0cf] px-2.5 py-0.5 text-xs font-bold text-[#8a5a00]">{nextDose.timeLabel}</span>}
        </div>
        {nextDose ? (
          <>
            <div className="mt-2.5 flex items-center gap-3.5">
              <MedicationIcon size={56} />
              <div className="min-w-0">
                <p className="truncate text-[1.1rem] font-bold leading-tight text-[#0f172a]">{nextDose.medicationName}</p>
                <p className="mt-0.5 text-sm text-[#475569]">{dose?.dosage} · {dose?.slotLabel}{nextDose.isDemo ? " · Demo dose" : ""}</p>
                {dose?.instruction && <p className="truncate text-sm text-[#64748b]">{dose.instruction}</p>}
              </div>
            </div>
            {confirming ? (
              <div className="mt-3 rounded-2xl bg-[#eef7f5] p-3">
                <p className="text-sm font-medium text-[#0f172a]">Record {nextDose.medicationName} as taken?</p>
                <p className="mt-0.5 text-xs text-[#475569]">This saves your own report. It does not dispense or move the device.</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" disabled={markTaken?.busy} onClick={() => { markTaken?.onConfirm(); setConfirming(false); }} className="ps-cta min-h-11 flex-1 rounded-full px-4 text-sm font-semibold">{markTaken?.busy ? "Saving…" : "Yes, record it"}</button>
                  <button type="button" onClick={() => setConfirming(false)} className="ps-focus min-h-11 rounded-full border border-[#cbd5e1] bg-white px-5 text-sm font-semibold text-[#334155]">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <button type="button" disabled={!canReport || markTaken?.busy} onClick={() => setConfirming(true)} className="ps-cta mt-3 flex min-h-[3.4rem] w-full items-center justify-center gap-2.5 rounded-full px-5 text-[1rem] font-semibold">
                  <span aria-hidden="true" className="grid size-6 place-items-center rounded-full bg-white/20"><Icon name="check" size={15} strokeWidth={2.4} /></span>
                  Mark as taken
                  <Icon name="arrow" size={18} />
                </button>
                {!canReport && <p className="mt-2 text-xs leading-5 text-[#64748b]">You can report this dose once its reminder window opens. A schedule time alone is not a record.</p>}
              </>
            )}
            {markTaken?.error && <p role="alert" className="mt-3 rounded-xl bg-[#fde4e4] p-3 text-sm text-[#8f1d1d]">{markTaken.error}</p>}
          </>
        ) : (
          <p className="mt-3 text-sm leading-6 text-[#475569]">No more doses are scheduled for today.</p>
        )}
      </section>

      <section aria-labelledby="today-schedule-title" className="px-1 pt-1">
        <div className="flex items-baseline justify-between">
          <h2 id="today-schedule-title" className="text-[0.95rem] font-semibold text-[#0f172a]">Today’s Schedule</h2>
          <span className="text-xs text-[#64748b]">{timeline.length} total</span>
        </div>
        {timeline.length === 0 ? (
          <p className="mt-2 text-sm text-[#475569]">Nothing is scheduled for today.</p>
        ) : (
          <ol className="mt-1.5">
            {timeline.map((row, index) => (
              <li key={row.key} className="relative flex min-h-[3.1rem] items-center gap-3">
                {index < timeline.length - 1 && <span aria-hidden="true" className="absolute left-[0.7rem] top-[2.15rem] h-[calc(100%-1.4rem)] w-px bg-[#cfe0ee]" />}
                <TimelineMarker state={row.state} />
                <span className="w-[4rem] shrink-0 text-sm text-[#475569]">{row.timeLabel}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#0f172a]">{row.medicationName}</span>
                <StatusPill tone={stateTone[row.state]}>{timelineStateLabel[row.state]}</StatusPill>
              </li>
            ))}
          </ol>
        )}
        {onOpenSchedule && (
          <button type="button" onClick={onOpenSchedule} className="ps-focus min-h-11 w-full rounded-xl text-sm font-semibold text-[#0f766e]">View full schedule</button>
        )}
      </section>

      {supply}
    </div>
  );
}

const deviceDot: Record<TodayDevice["tone"], string> = { ready: "bg-[#14b8a6]", attention: "bg-[#f59e0b]", idle: "bg-[#94a3b8]" };

/** Compact connection card: status dot + name, status text beneath. Real state only. */
function DeviceCard({ device, onOpen }: { device: TodayDevice; onOpen?: () => void }) {
  return (
    <button type="button" onClick={onOpen} disabled={!onOpen} className="ps-card ps-focus flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left">
      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#f7f5f0] to-[#e6e0d3] text-[#0f766e]"><Icon name="cube" size={20} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${deviceDot[device.tone]}`} />
          <span className="truncate text-sm font-semibold leading-5 text-[#0f172a]">{device.label}</span>
        </span>
        {device.detail && <span className="mt-0.5 block truncate pl-4 text-xs text-[#64748b]">{device.detail}</span>}
      </span>
      <Icon name="chevron" size={18} className="shrink-0 text-[#94a3b8]" />
    </button>
  );
}

function TimelineMarker({ state }: { state: TimelineState }) {
  if (state === "TAKEN") return <span aria-hidden="true" className="relative z-10 grid size-[1.4rem] shrink-0 place-items-center rounded-full bg-[#14b8a6] text-white"><Icon name="check" size={15} strokeWidth={2.6} /></span>;
  if (state === "DUE" || state === "NEXT") return <span aria-hidden="true" className="relative z-10 grid size-[1.4rem] shrink-0 place-items-center rounded-full border-[2.5px] border-[#0f766e] bg-white"><span className="size-2 rounded-full bg-[#0f766e]" /></span>;
  if (state === "NOT_TAKEN" || state === "NO_REPORT") return <span aria-hidden="true" className="relative z-10 grid size-[1.4rem] shrink-0 place-items-center rounded-full border-2 border-[#f59e0b] bg-white text-[#b87400]"><span className="text-xs font-bold">!</span></span>;
  return <span aria-hidden="true" className="relative z-10 size-[1.4rem] shrink-0 rounded-full border-2 border-[#cbd5e1] bg-white" />;
}
