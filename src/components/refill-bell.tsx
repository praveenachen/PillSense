"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Icon } from "./mobile-ui";
import { PhoneOverlay } from "./phone-overlay";

/** A refill only notifies once the estimated supply is this many days (or fewer) from running out. */
export const REFILL_ALERT_DAYS = 5;
/** At or below this many days the bell badge pulses. */
const URGENT_DAYS = 2;
const SNOOZE_KEY = "pillsense:refill-alert-snoozed";

export type RefillAlert = {
  id: string;
  medicationName: string;
  estimatedDaysRemaining: number | null;
  status?: string;
  supplyCount?: number | null;
  runOutAt?: number | null;
};

/** Refills worth notifying about: 5 days or fewer left and not already requested, soonest first. */
export function dueRefills<T extends RefillAlert>(reminders: readonly T[]) {
  return reminders
    .filter((item): item is T & { estimatedDaysRemaining: number } =>
      item.estimatedDaysRemaining !== null && item.estimatedDaysRemaining <= REFILL_ALERT_DAYS && item.status !== "REFILL_REQUESTED")
    .sort((a, b) => a.estimatedDaysRemaining - b.estimatedDaysRemaining);
}

const daysLabel = (days: number) => (days <= 0 ? "Estimated to run out today" : `Estimated ${days} ${days === 1 ? "day" : "days"} left`);

function readSnoozed() {
  try { return window.sessionStorage.getItem(SNOOZE_KEY) === "1"; } catch { return false; }
}
function writeSnoozed() {
  try { window.sessionStorage.setItem(SNOOZE_KEY, "1"); } catch { /* storage unavailable; the alert just may reappear */ }
}

/** Notification bell for the Today header. Opens a centered refill alert, and shows it once per session on load. */
export function RefillBell() {
  const auth = useConvexAuth();
  const result = useQuery(api.refills.patientReminder, auth.isAuthenticated ? {} : "skip");
  const transition = useMutation(api.refills.transition);
  const [open, setOpen] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refills = dueRefills(result?.reminders ?? []);
  const hasRefills = refills.length > 0;

  useEffect(() => {
    if (!hasRefills || readSnoozed()) return;
    const timer = window.setTimeout(() => setOpen(true), 0);
    return () => window.clearTimeout(timer);
  }, [hasRefills]);

  if (!auth.isAuthenticated) return null;

  function close() {
    writeSnoozed();
    setOpen(false);
    setError(null);
  }

  /** Records the refill request for the caregiver workflow; nothing is ordered from a pharmacy. */
  async function order() {
    const target = refills[0];
    if (!target) return;
    setOrdering(true);
    setError(null);
    try {
      const id = target.id as Id<"refillCases">;
      if (target.status === "OPEN") await transition({ refillCaseId: id, action: "REVIEW" });
      await transition({ refillCaseId: id, action: "REQUEST_REFILL" });
      if (refills.length <= 1) close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn’t send the refill request. Please try again.");
    } finally {
      setOrdering(false);
    }
  }

  return (
    <RefillBellView refills={refills} open={open} onOpen={() => setOpen(true)} onClose={close} onOrder={order} ordering={ordering} error={error} />
  );
}

export function RefillBellView({ refills, open = false, onOpen, onClose, onOrder, ordering = false, error = null }: {
  refills: ReturnType<typeof dueRefills>;
  open?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  onOrder?: () => void;
  ordering?: boolean;
  error?: string | null;
}) {
  const count = refills.length;
  const urgent = refills.some((item) => item.estimatedDaysRemaining <= URGENT_DAYS);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label={count === 0 ? "Notifications, no refills needed" : `Notifications, ${count} ${count === 1 ? "refill" : "refills"} needed`}
        aria-haspopup="dialog"
        onClick={onOpen}
        className={`pd-press pd-focus relative grid size-11 place-items-center rounded-full border bg-pd-surface-2 text-pd-text transition-colors duration-200 ${count > 0 ? "border-pd-accent-soft/50 shadow-[0_0_16px_rgba(119,116,255,0.5)]" : "border-pd-line"}`}
      >
        <Icon name="bell" size={20} />
        {count > 0 && (
          <span className={`absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full border-2 border-pd-bg bg-red-500 px-1 text-[0.6875rem] font-bold leading-4 text-white ${urgent ? "pd-breathe" : ""}`}>{count}</span>
        )}
      </button>
      {open && onClose && (
        <PhoneOverlay label="Refill needed" onClose={onClose}>
          {count === 0
            ? <NoRefillsCard onClose={onClose} />
            : <RefillAlertCard refills={refills} onClose={onClose} onOrder={onOrder} ordering={ordering} error={error} />}
        </PhoneOverlay>
      )}
    </div>
  );
}

const runOutLabel = (at: number) => new Date(at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

/** Warning-style card for the most urgent refill, with the order and snooze actions. */
export function RefillAlertCard({ refills, onClose, onOrder, ordering = false, error = null }: {
  refills: ReturnType<typeof dueRefills>;
  onClose?: () => void;
  onOrder?: () => void;
  ordering?: boolean;
  error?: string | null;
}) {
  const [item, ...others] = refills;
  if (!item) return null;
  return (
    <div className="pd-card-hero relative space-y-4 p-5 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.9)]">
      <button type="button" onClick={onClose} aria-label="Close" className="pd-focus absolute right-2 top-2 grid size-11 place-items-center rounded-full text-pd-muted"><Icon name="close" size={18} /></button>
      <div className="flex items-center gap-3 pr-8">
        <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-2xl border border-red-500/40 bg-red-500/15 text-red-400 shadow-[0_0_24px_rgba(239,68,68,0.45)]"><Icon name="alert" size={28} strokeWidth={2} /></span>
        <div className="min-w-0">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-red-400">Refill needed</p>
          <h2 className="mt-0.5 truncate text-xl font-semibold leading-tight text-pd-text">{item.medicationName}</h2>
          <p className="mt-0.5 text-sm font-medium text-red-400">{daysLabel(item.estimatedDaysRemaining)}</p>
        </div>
      </div>
      <dl className="divide-y divide-pd-line rounded-pd-chip border border-pd-line bg-black/20 text-sm">
        {item.supplyCount != null && <div className="flex items-center justify-between px-3 py-2.5"><dt className="text-pd-muted">Pills left</dt><dd className="font-semibold tabular-nums text-pd-text">{item.supplyCount}</dd></div>}
        {item.runOutAt != null && <div className="flex items-center justify-between px-3 py-2.5"><dt className="text-pd-muted">Runs out around</dt><dd className="font-semibold text-pd-text">{runOutLabel(item.runOutAt)}</dd></div>}
      </dl>
      {others.length > 0 && <p className="text-xs text-pd-muted">Also running low: {others.map((other) => other.medicationName).join(", ")}</p>}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onClose} className="pd-press pd-focus flex min-h-12 items-center justify-center rounded-full border border-pd-line bg-white/5 px-2 text-sm font-semibold text-pd-muted">Remind me later</button>
        <button type="button" onClick={onOrder} disabled={ordering} className="pd-press pd-focus flex min-h-12 items-center justify-center rounded-full bg-gradient-to-br from-pd-accent to-pd-accent-2 px-2 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(84,121,255,0.9)] disabled:opacity-60">{ordering ? "Sending…" : "Order Refill"}</button>
      </div>
    </div>
  );
}

function NoRefillsCard({ onClose }: { onClose: () => void }) {
  return (
    <div className="pd-card-hero relative p-5">
      <button type="button" onClick={onClose} aria-label="Close" className="pd-focus absolute right-2 top-2 grid size-11 place-items-center rounded-full text-pd-muted"><Icon name="close" size={18} /></button>
      <h2 className="pr-10 text-lg font-semibold text-pd-text">No refills needed</h2>
      <p className="mt-1 text-sm text-pd-muted">We’ll let you know when a medication is 5 days or less from running out.</p>
    </div>
  );
}
