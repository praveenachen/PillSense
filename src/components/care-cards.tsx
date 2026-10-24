"use client";

import Link from "next/link";
import { Icon, type IconName } from "./mobile-ui";
import { dispenserSetup, presentDispenserDevice } from "./dispenser-view";
import { PillTile } from "./today-view";
import { useCaseActions, type CareCaseItem, type reasonLabels } from "./caregiver-alerts";

type Reason = keyof typeof reasonLabels;

/** Short, friendly names for the card; the full labels stay in the case detail view. */
const friendlyReason: Record<Reason, { label: string; icon: IconName }> = {
  NO_PATIENT_RESPONSE: { label: "Missed dose", icon: "clock" },
  PATIENT_REPORTED_NOT_TAKEN: { label: "Missed dose", icon: "alert" },
  MOTOR_COMPLETED_INGESTION_UNCONFIRMED: { label: "Dose unconfirmed", icon: "clock" },
  MOTOR_OUTCOME_UNKNOWN: { label: "Dispense unclear", icon: "alert" },
  DEVICE_FAULT_OR_DISCONNECTED: { label: "Device problem", icon: "alert" },
};

const investigationPill: Record<Exclude<CareCaseItem["investigationStatus"], "NOT_REQUESTED">, { label: string; style: string }> = {
  PENDING: { label: "In progress", style: "bg-pd-accent/20 text-pd-accent-soft" },
  RUNNING: { label: "In progress", style: "bg-pd-accent/20 text-pd-accent-soft" },
  COMPLETED: { label: "Complete", style: "bg-pd-ok/15 text-pd-ok" },
  FAILED: { label: "Failed", style: "bg-red-500/15 text-red-300" },
};

function investigationLine(status: CareCaseItem["investigationStatus"]) {
  return status === "PENDING" || status === "RUNNING" ? "Investigating..."
    : status === "COMPLETED" ? "Investigation complete"
    : status === "FAILED" ? "Investigation failed"
    : "Not investigated yet";
}

/** "Needs attention": the highest-priority case plus the live AI investigation for it. */
export function NeedsAttentionCard({ item, count, onOpen }: { item: CareCaseItem; count: number; onOpen: () => void }) {
  const { busy, error, investigate } = useCaseActions(item);
  const reason = friendlyReason[item.triggerReason];
  const run = item.agentRun;
  const pill = item.investigationStatus === "NOT_REQUESTED" ? null : investigationPill[item.investigationStatus];
  const inProgress = item.investigationStatus === "PENDING" || item.investigationStatus === "RUNNING";
  const canInvestigate = item.status === "OPEN" && item.syntheticPatient && (item.investigationStatus === "NOT_REQUESTED" || item.investigationStatus === "FAILED");
  const notStarted = item.investigationStatus === "NOT_REQUESTED";
  const summary = run?.findings?.overallSummary
    ?? (inProgress ? "Looking into what happened. Findings will appear here as soon as they’re ready." : null);
  return (
    <section aria-labelledby="needs-attention-title" className="pd-card overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-4">
        <h2 id="needs-attention-title" className="text-lg font-semibold text-pd-text">Needs attention</h2>
        <span aria-label={`${count} unresolved`} className="grid size-7 place-items-center rounded-full bg-red-500 text-sm font-bold text-white shadow-[0_0_14px_rgba(239,68,68,0.6)]">{count}</span>
      </div>

      <button type="button" onClick={onOpen} className="pd-press pd-focus mt-3 flex min-h-[4.75rem] w-full items-center gap-3 px-4 py-2 text-left">
        <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full border border-red-500/50 bg-red-500/10 text-red-400 shadow-[0_0_18px_rgba(239,68,68,0.35)]"><Icon name={reason.icon} size={22} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-red-400">{reason.label}</span>
          <span className="block truncate text-sm text-pd-text/85">{item.medicationName} · {new Date(item.dueAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          <span className="block text-sm text-pd-muted">{investigationLine(item.investigationStatus)}</span>
        </span>
        <Icon name="chevron" size={18} className="shrink-0 text-pd-muted" />
      </button>

      <div className="mx-4 mt-2 border-t border-pd-line" />

      <div className="space-y-3 px-4 pb-4 pt-4">
        {notStarted && canInvestigate ? (
          <button type="button" onClick={() => void investigate()} disabled={busy} className="pd-press pd-focus min-h-11 w-full rounded-full bg-gradient-to-br from-pd-accent to-pd-accent-2 px-5 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(84,121,255,0.9)] disabled:opacity-60">{busy ? "Requesting…" : "Investigate with AI"}</button>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-pd-text">AI investigation</h3>
            {pill && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${pill.style}`}>{pill.label}</span>}
          </div>
        )}
        {summary && <p className="text-sm leading-6 text-pd-text/85">{summary}</p>}
        {canInvestigate && !notStarted && (
          <button type="button" onClick={() => void investigate()} disabled={busy} className="pd-press pd-focus min-h-10 rounded-full bg-gradient-to-br from-pd-accent to-pd-accent-2 px-5 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? "Requesting…" : "Retry investigation"}
          </button>
        )}
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      </div>
    </section>
  );
}

/** "Refill status": the most urgent medication and its estimated days left. */
export function RefillStatusCard({ medicationName, daysLeft, href = "/caregiver" }: { medicationName: string | null; daysLeft: number | null; href?: string }) {
  return (
    <section aria-labelledby="refill-status-title" className="pd-card p-4">
      <h2 id="refill-status-title" className="text-lg font-semibold text-pd-text">Refill status</h2>
      {medicationName ? (
        <Link href={href} className="pd-press pd-focus mt-3 flex items-center gap-4">
          <PillTile />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold text-pd-text">{medicationName}</span>
            <span className={`mt-0.5 block text-sm font-medium ${daysLeft === null ? "text-pd-muted" : "text-pd-warn"}`}>{daysLeft === null ? "Estimated days left unavailable" : `Estimated ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`}</span>
          </span>
          <Icon name="chevron" size={18} className="shrink-0 text-pd-muted" />
        </Link>
      ) : (
        <p className="mt-2 text-sm text-pd-muted">No active medication assignments.</p>
      )}
    </section>
  );
}

type DeviceRuntime = { state: string; connected: boolean; homeAligned: boolean; faultCode: string | null } | null;

/** Small "Dispenser" status row, worded the same way as the My Dispenser screen. */
export function DeviceStatusCard({ device, medicationCount }: { device: DeviceRuntime; medicationCount: number }) {
  const view = presentDispenserDevice(device);
  const { status } = dispenserSetup(view, medicationCount);
  return (
    <section aria-labelledby="device-status-title" className="pd-card flex min-h-[4rem] items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <h2 id="device-status-title" className="text-base font-semibold text-pd-text">Dispenser</h2>
        <span className="mt-0.5 flex items-center gap-2 text-sm font-medium text-pd-text/85">
          <span aria-hidden="true" className={`size-2.5 rounded-full ${view.connected ? "bg-pd-ok shadow-[0_0_9px_rgba(53,213,138,0.95)]" : "bg-red-500 shadow-[0_0_9px_rgba(239,68,68,0.85)]"}`} />
          {view.connected ? "Connected" : "Disconnected"}
        </span>
      </div>
      <span className="shrink-0 text-sm font-medium text-pd-muted">{status.label}</span>
    </section>
  );
}
