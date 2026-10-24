"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { INSTRUCTION_OPTIONS } from "../../convex/lib/instructionOptions";
import { Icon } from "./mobile-ui";

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const UNITS = ["tablet", "capsule"] as const;

export type Weekday = (typeof WEEKDAYS)[number];
export type SlotMedicationInput = {
  slot: number;
  name: string;
  instructions: string;
  localTime: string;
  weekdays: Weekday[];
  supplyCount: number;
};

const input = "pd-focus min-h-11 w-full rounded-pd-chip border border-pd-line bg-pd-bg px-3 text-sm text-pd-text placeholder:text-pd-muted/70";

/** Enter the medication going into one compartment. Saving is handled by the container; this only collects fields. */
export function SlotMedicationForm({ slot, onSave, onCancel, unavailableMessage }: {
  slot: number;
  onSave?: (value: SlotMedicationInput) => Promise<void>;
  onCancel: () => void;
  unavailableMessage?: string;
}) {
  const [days, setDays] = useState<Weekday[]>([...WEEKDAYS]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"choose" | "manual">("choose");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onSave) return;
    const form = new FormData(event.currentTarget);
    const dose = Number(form.get("dose"));
    const unit = String(form.get("unit"));
    setError(null);
    setSaving(true);
    try {
      await onSave({
        slot,
        name: String(form.get("name") ?? "").trim(),
        instructions: `${dose} ${unit}${dose === 1 ? "" : "s"} · ${String(form.get("instruction"))}`,
        localTime: String(form.get("localTime")),
        weekdays: days,
        supplyCount: Number(form.get("count")),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label={`Add medication to slot ${slot}`} className="pd-card-hero space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-pd-accent-soft">Slot {slot}</p>
          <h2 className="mt-1 text-lg font-semibold text-pd-text">Add medication</h2>
        </div>
        <button type="button" onClick={onCancel} aria-label="Close form" className="pd-focus -mr-2 -mt-1 grid size-11 place-items-center rounded-full text-pd-muted"><Icon name="close" size={18} /></button>
      </div>

      {mode === "choose" ? (
        <div className="space-y-3">
          <button type="button" disabled className="flex min-h-16 w-full items-center gap-3 rounded-pd-chip border border-dashed border-pd-accent-soft/40 bg-pd-accent/5 px-3 text-left opacity-80">
            <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-pd-accent/15 text-pd-accent-soft"><Icon name="camera" size={20} /></span>
            <span className="min-w-0 flex-1 text-base font-semibold text-pd-text">Scan with camera</span>
            <span className="rounded-full border border-pd-line px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-pd-muted">Soon</span>
          </button>
          <button type="button" onClick={() => setMode("manual")} className="pd-press pd-focus flex min-h-16 w-full items-center gap-3 rounded-pd-chip border border-pd-accent-soft/50 bg-pd-accent/10 px-3 text-left">
            <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-gradient-to-br from-pd-accent to-pd-accent-2 text-white"><Icon name="form" size={20} /></span>
            <span className="min-w-0 flex-1 text-base font-semibold text-pd-text">Manual entry</span>
            <Icon name="chevron" size={17} className="shrink-0 text-pd-muted" />
          </button>
        </div>
      ) : (
      <>
      <Field label="Medication name" htmlFor="slot-name"><input id="slot-name" name="name" required maxLength={120} placeholder="e.g. Iron Pills" autoComplete="off" className={input} /></Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Dose per day" htmlFor="slot-dose">
          <div className="flex gap-2">
            <input id="slot-dose" name="dose" type="number" inputMode="numeric" min={1} max={9} defaultValue={1} required className={`${input} w-16 shrink-0 text-center`} />
            <select name="unit" aria-label="Dose unit" className={input}>{UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select>
          </div>
        </Field>
        <Field label="Pills loaded" htmlFor="slot-count"><input id="slot-count" name="count" type="number" inputMode="numeric" min={0} max={10000} defaultValue={30} required className={input} /></Field>
      </div>

      <Field label="Instructions" htmlFor="slot-instruction">
        <select id="slot-instruction" name="instruction" className={input}>{INSTRUCTION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select>
      </Field>

      <Field label="Time" htmlFor="slot-time"><input id="slot-time" name="localTime" type="time" required defaultValue="08:00" className={input} /></Field>

      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-pd-muted">Repeat on</legend>
        <div className="flex justify-between gap-1">
          {WEEKDAYS.map((day, index) => {
            const on = days.includes(day);
            return (
              <button key={day} type="button" aria-pressed={on} aria-label={day} onClick={() => setDays(on ? days.filter((d) => d !== day) : [...days, day])} className={`pd-focus grid size-10 place-items-center rounded-full border text-xs font-bold transition-colors ${on ? "border-pd-accent-soft/60 bg-pd-accent/25 text-pd-text" : "border-pd-line text-pd-muted"}`}>{DAY_LABELS[index]}</button>
            );
          })}
        </div>
      </fieldset>

      {unavailableMessage && <p className="text-sm text-pd-warn">{unavailableMessage}</p>}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={!onSave || saving || days.length === 0} className="pd-press pd-focus flex min-h-12 w-full items-center justify-center rounded-full bg-gradient-to-br from-pd-accent to-pd-accent-2 text-base font-semibold text-white shadow-[0_8px_20px_-8px_rgba(84,121,255,0.9)] disabled:opacity-50">
        {saving ? "Saving…" : `Save to Slot ${slot}`}
      </button>
      </>
      )}
    </form>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return <div><label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold text-pd-muted">{label}</label>{children}</div>;
}
