"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { DispenserVisual, type DispenserTone } from "./dispenser-visual";
import { Icon, type IconName } from "./mobile-ui";
import { PhoneOverlay } from "./phone-overlay";
import { SlotMedicationForm, type SlotMedicationInput } from "./slot-medication-form";

type MedicationAssignment = { id: string; name: string; instructions?: string; slot: number; localTime: string | null; supplyCount?: number | null };
type SavedMedicationAssignment = { slot: number };
type DeviceRuntime = { state: string; connected: boolean; homeAligned: boolean; faultCode: string | null } | null;
export type DispenserStatusTone = "ready" | "busy" | "setup" | "offline";
export type DispenserDeviceView = {
  connected: boolean;
  /** Paired and reporting READY with home aligned. */
  verified: boolean;
  busy: boolean;
  tone: DispenserTone;
};

export function presentDispenserDevice(device: DeviceRuntime): DispenserDeviceView {
  if (!device?.connected) return { connected: false, verified: false, busy: false, tone: "idle" };
  if (device.state === "DISPENSING") return { connected: true, verified: true, busy: true, tone: "attention" };
  const verified = device.state === "READY" && device.homeAligned;
  return { connected: true, verified, busy: false, tone: verified ? "ready" : "attention" };
}

export type SetupStepId = "pair" | "verify" | "load";
export type SetupStep = { id: SetupStepId; label: string; hint: string; done: boolean; current: boolean };

/** Three setup steps. The first unfinished one is "current"; when none are left the dispenser is ready. */
export function dispenserSetup(device: DispenserDeviceView, medicationCount: number) {
  const base = [
    { id: "pair" as const, label: "Pair device", hint: "Connect over Bluetooth", done: device.connected },
    { id: "verify" as const, label: "Verify status", hint: "Check it reports ready", done: device.verified },
    { id: "load" as const, label: "Load slots", hint: "Add your medications", done: medicationCount > 0 },
  ];
  const currentIndex = base.findIndex((step) => !step.done);
  const steps: SetupStep[] = base.map((step, index) => ({ ...step, current: index === currentIndex }));
  const ready = currentIndex === -1;
  const status: { label: string; tone: DispenserStatusTone } = !device.connected
    ? { label: "Not Ready", tone: "offline" }
    : device.busy ? { label: "Busy", tone: "busy" }
    : ready ? { label: "Ready", tone: "ready" }
    : { label: "Not Ready", tone: "setup" };
  return { steps, ready, status };
}

const stepIcon: Record<SetupStepId, IconName> = { pair: "bluetooth", verify: "shield", load: "form" };

/** At or below this many pills the count square turns red. */
const LOW_COUNT = 5;
const countTone = (count: number | null | undefined) =>
  count == null ? "border-pd-line bg-white/5 text-pd-muted"
    : count <= LOW_COUNT ? "border-red-500/50 bg-red-500/15 text-red-400"
    : "border-pd-ok/50 bg-pd-ok/15 text-pd-ok";

const statusDot: Record<DispenserStatusTone, string> = {
  ready: "bg-pd-ok shadow-[0_0_9px_rgba(53,213,138,0.95)]",
  busy: "bg-pd-ok shadow-[0_0_9px_rgba(53,213,138,0.95)]",
  setup: "bg-red-500 shadow-[0_0_9px_rgba(239,68,68,0.85)]",
  offline: "bg-red-500 shadow-[0_0_9px_rgba(239,68,68,0.85)]",
};

export function DispenserView({ medications, device, selectedSlot, onSelectSlot, onOpenSetup, onSaveSlot, saveUnavailableMessage, demoSettings, onPair, onVerify, setupBusy, setupError }: {
  medications: MedicationAssignment[];
  device: DispenserDeviceView;
  selectedSlot: number;
  onSelectSlot: (slot: number) => void;
  onOpenSetup: () => void;
  synthetic?: boolean;
  /** Persists a medication for a slot. Omitted when this account cannot manage medications. */
  onSaveSlot?: (value: SlotMedicationInput) => Promise<SavedMedicationAssignment>;
  saveUnavailableMessage?: string;
  demoSettings?: ReactNode;
  onPair?: () => void;
  onVerify?: () => void;
  setupBusy?: boolean;
  setupError?: string | null;
}) {
  const assignments = useMemo(() => new Map(medications.map((medication) => [medication.slot, medication])), [medications]);
  const { steps, ready, status } = dispenserSetup(device, onPair ? medications.filter((m) => (m.supplyCount ?? 0) > 0).length : medications.length);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [formSlot, setFormSlot] = useState<number | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const firstEmptySlot = [1, 2, 3, 4, 5, 6, 7].find((slot) => !assignments.has(slot)) ?? null;

  /** The slot that was selected before an empty one opened the form, so closing the form puts the user back there. */
  const slotBeforeForm = useRef(selectedSlot);

  function selectSlot(slot: number) {
    const opensForm = slot >= 1 && slot <= 7 && !assignments.has(slot);
    if (opensForm && formSlot === null) slotBeforeForm.current = selectedSlot;
    onSelectSlot(slot);
    setFormSlot(opensForm ? slot : null);
  }

  function cancelForm() {
    onSelectSlot(slotBeforeForm.current);
    setFormSlot(null);
  }

  async function save(value: SlotMedicationInput) {
    if (!onSaveSlot) return;
    const saved = await onSaveSlot(value);
    onSelectSlot(saved.slot);
    setSaveSuccess(`${value.name} was saved to Slot ${saved.slot}.`);
    setFormSlot(null);
  }

  return (
    <div className="space-y-4 overflow-x-hidden">
      <header className="-mx-5 flex min-h-11 items-center justify-between gap-3 border-b border-pd-line px-5 pb-3">
        <h1 className="text-[1.45rem] font-semibold tracking-tight text-pd-text">My Dispenser</h1>
        <button type="button" onClick={demoSettings ? () => setSettingsOpen(true) : onOpenSetup} aria-label="Open dispenser settings" className="pd-focus grid size-11 place-items-center rounded-full text-pd-text transition-colors hover:bg-white/5"><Icon name="gear" size={22} /></button>
      </header>

      <section aria-label="Dispenser status" className="flex min-h-8 items-center justify-between gap-3 px-1 text-sm">
        <span className="inline-flex items-center gap-2 font-medium text-pd-text"><span aria-hidden="true" className={`size-2.5 rounded-full ${device.connected ? statusDot.ready : statusDot.offline}`} />{device.connected ? "Connected" : "Disconnected"}</span>
        <span className="font-medium text-pd-muted">{status.label}</span>
      </section>

      {settingsOpen && <PhoneOverlay label="Dispenser settings" onClose={() => setSettingsOpen(false)}><div className="space-y-3">{demoSettings}<button type="button" onClick={() => { setSettingsOpen(false); onOpenSetup(); }} className="pd-focus min-h-11 w-full rounded-full border border-pd-line px-4 text-sm text-pd-text">Medication setup</button></div></PhoneOverlay>}

      {saveSuccess && (
        <p role="status" className="rounded-pd-chip border border-pd-ok/40 bg-pd-ok/10 px-3 py-2 text-sm font-medium text-pd-ok">
          {saveSuccess}
        </p>
      )}

      <section aria-label="Interactive dispenser compartment map" className="relative -mx-2 py-2">
        <div aria-hidden="true" className="absolute inset-x-8 bottom-4 h-16 rounded-full bg-pd-accent/15 blur-3xl" />
        <DispenserVisual activeSlot={selectedSlot} tone={device.tone} onSelectSlot={selectSlot} view="tilted" className="relative" />
      </section>

      <section aria-label="Setup steps" className="pd-card px-2 py-3">
        <ol className="flex items-start">
          {steps.map((step, index) => {
            const glow = ready || step.current;
            const lineOn = ready || step.done;
            const locked = steps.slice(0, index).some((earlier) => !earlier.done);
            const body = (
              <>
                <span aria-hidden="true" className={`relative grid size-12 place-items-center rounded-full border transition-all duration-300 ${glow ? "border-pd-accent-soft/70 bg-gradient-to-br from-pd-accent to-pd-accent-2 text-white shadow-[0_0_20px_rgba(119,116,255,0.85)]" : step.done ? "border-pd-ok/50 bg-pd-ok/10 text-pd-ok" : "border-pd-line bg-white/[0.03] text-pd-muted"}`}>
                  <Icon name={stepIcon[step.id]} size={22} strokeWidth={2} />
                  {step.done && <span className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full border-2 border-pd-surface bg-pd-ok text-pd-bg"><Icon name="check" size={9} strokeWidth={3.4} /></span>}
                </span>
                <span className={`text-xs font-semibold ${glow ? "text-pd-text" : step.done ? "text-pd-text/80" : "text-pd-muted"}`}>{onPair ? step.id === "pair" ? "Pair" : step.id === "verify" ? "Ready" : step.done ? "Loaded" : "Load slots" : step.label}</span>
              </>
            );
            const cls = `pd-focus flex w-[4.75rem] flex-col items-center gap-1.5 rounded-pd-chip py-1 text-center ${locked ? "opacity-40 grayscale" : "pd-press"}`;
            return (
              <li key={step.id} aria-current={step.current ? "step" : undefined} className="flex flex-1 items-start last:flex-none">
                {step.id === "load" ? (
                  <button type="button" disabled={locked || firstEmptySlot === null} onClick={() => firstEmptySlot !== null && selectSlot(firstEmptySlot)} className={cls}>{body}</button>
                ) : (step.id === "pair" ? onPair : onVerify) ? (
                  <button type="button" onClick={step.id === "pair" ? onPair : onVerify} disabled={setupBusy || locked || (step.id === "pair" && device.connected)} className={cls}>{body}</button>
                ) : locked ? (
                  <span aria-disabled="true" className={cls}>{body}</span>
                ) : <span title="Operator-only setup is available outside patient navigation" className={cls}>{body}</span>}
                {index < steps.length - 1 && <span aria-hidden="true" className={`mt-[1.65rem] h-0.5 flex-1 rounded-full transition-colors duration-300 ${lineOn ? "bg-gradient-to-r from-pd-ok/70 to-pd-ok/40" : "bg-pd-line"}`} />}
              </li>
            );
          })}
        </ol>
      </section>

      {onVerify && <p className="px-1 text-xs leading-5 text-pd-muted">Ready confirms an empty/inert carousel, manual Slot 0 alignment, and clear moving parts.</p>}
      {setupBusy && <p role="status" className="px-1 text-xs text-pd-muted">Connecting to your dispenser…</p>}
      {setupError && <p role="alert" className="rounded-pd-chip bg-red-500/10 p-3 text-sm text-red-300">{setupError}</p>}

      {formSlot !== null && (
        <PhoneOverlay label="Add medication" onClose={cancelForm}>
          <SlotMedicationForm key={formSlot} slot={formSlot} onSave={onSaveSlot ? save : undefined} onCancel={cancelForm} unavailableMessage={onSaveSlot ? undefined : saveUnavailableMessage} />
        </PhoneOverlay>
      )}

      {selectedSlot === 0 && (
        <section aria-live="polite" className="pd-card-hero overflow-hidden p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-pd-accent-soft">Home reference</p>
              <h2 className="mt-1 text-lg font-semibold text-pd-text">Reserved position</h2>
              <p className="mt-1 text-sm leading-5 text-pd-muted">Slot 0 is reserved for manual home alignment and cannot hold medication.</p>
            </div>
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-pd-chip border border-pd-accent/25 bg-pd-accent/10 text-pd-accent-soft"><Icon name="home" size={20} /></span>
          </div>
        </section>
      )}

      <section aria-label="Slots" className="space-y-2.5">
        <h2 className="px-1 text-base font-semibold text-pd-text">Slots &amp; Inventory</h2>
        {[1, 2, 3, 4, 5, 6, 7].map((slot) => {
          const medication = assignments.get(slot);
          const selected = slot === selectedSlot;
          return (
            <button key={slot} type="button" onClick={() => selectSlot(slot)} aria-pressed={selected} className={`pd-card pd-press pd-focus flex min-h-[4.5rem] w-full items-center gap-3 p-3 text-left ${selected ? "!border-pd-accent-soft/60 shadow-[0_0_18px_-6px_rgba(119,116,255,0.8)]" : ""}`}>
              <span aria-hidden="true" className={`grid size-11 shrink-0 place-items-center rounded-pd-chip border text-lg font-bold ${medication ? "border-pd-accent-soft/40 bg-gradient-to-br from-[#3a3797] to-[#12163f] text-white" : "border-pd-line bg-white/5 text-pd-muted"}`}>{slot}</span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-base font-semibold ${medication ? "text-pd-text" : "text-pd-muted"}`}>{medication ? medication.name : "No medication"}</span>
              </span>
              {medication ? (
                <span aria-label={`${medication.supplyCount ?? "Unknown"} pills left`} className={`grid size-12 shrink-0 place-items-center rounded-pd-chip border text-lg font-bold tabular-nums ${countTone(medication.supplyCount)}`}>{medication.supplyCount ?? "—"}</span>
              ) : (
                <span className="shrink-0 pr-1 text-sm font-semibold text-pd-muted">Empty</span>
              )}
            </button>
          );
        })}
      </section>
    </div>
  );
}
