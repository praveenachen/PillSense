"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { INSTRUCTION_OPTIONS } from "../../convex/lib/instructionOptions";
import { Icon } from "./mobile-ui";
import { MedicationCameraScanner } from "./medication-camera-scanner";
import { productDetailsForSave, scanFormDefaults, type MedicationScan } from "../lib/medication-scan";
import { medicationSaveError } from "../lib/medication-save-error";

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
  supplyCount?: number;
  demoInventory: 0 | 1;
  scheduled: boolean;
  productDetails?: ReturnType<typeof productDetailsForSave>;
};

const input = "pd-focus min-h-11 w-full rounded-pd-chip border border-pd-line bg-pd-bg px-3 text-sm text-pd-text placeholder:text-pd-muted/70";

export function buildSlotMedicationInput(args: {
  slot: number;
  form: FormData;
  days: Weekday[];
  scheduled: boolean;
  scan: MedicationScan | null;
}): SlotMedicationInput {
  const { slot, form, days, scheduled, scan } = args;
  const countText = String(form.get("count") ?? "").trim();
  const count = countText ? Number(countText) : undefined;
  const dose = Number(form.get("dose"));
  const unit = String(form.get("unit"));
  return {
    slot,
    name: String(form.get("name") ?? "").trim(),
    instructions: scheduled ? `${dose} ${unit}${dose === 1 ? "" : "s"} · ${String(form.get("instruction"))}` : "",
    localTime: scheduled ? String(form.get("localTime") ?? "") : "",
    weekdays: scheduled ? days : [],
    supplyCount: count,
    demoInventory: scan ? 0 : count && count > 0 ? 1 : 0,
    scheduled,
    productDetails: scan ? productDetailsForSave(scan) : undefined,
  };
}

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
  const [mode, setMode] = useState<"choose" | "manual" | "scan">("choose");
  const [name, setName] = useState("");
  const [scan, setScan] = useState<MedicationScan | null>(null);
  const [scheduled, setScheduled] = useState(true);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onSave) return;
    const value = buildSlotMedicationInput({ slot, form: new FormData(event.currentTarget), days, scheduled, scan });
    setError(null);
    setSaving(true);
    try {
      await onSave(value);
    } catch (caught) {
      setError(medicationSaveError(caught));
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
          <button type="button" onClick={() => { setMode("scan"); setScheduled(false); setDays([]); }} className="pd-press pd-focus flex min-h-16 w-full items-center gap-3 rounded-pd-chip border border-dashed border-pd-accent-soft/40 bg-pd-accent/5 px-3 text-left">
            <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-pd-accent/15 text-pd-accent-soft"><Icon name="camera" size={20} /></span>
            <span className="min-w-0 flex-1 text-base font-semibold text-pd-text">Scan with camera</span>
            <Icon name="chevron" size={17} className="shrink-0 text-pd-muted" />
          </button>
          <button type="button" onClick={() => setMode("manual")} className="pd-press pd-focus flex min-h-16 w-full items-center gap-3 rounded-pd-chip border border-pd-accent-soft/50 bg-pd-accent/10 px-3 text-left">
            <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-gradient-to-br from-pd-accent to-pd-accent-2 text-white"><Icon name="form" size={20} /></span>
            <span className="min-w-0 flex-1 text-base font-semibold text-pd-text">Manual entry</span>
            <Icon name="chevron" size={17} className="shrink-0 text-pd-muted" />
          </button>
        </div>
      ) : (
      <>
      <button type="button" onClick={() => { setMode("choose"); setScan(null); setName(""); setScheduled(true); setDays([...WEEKDAYS]); }} className="pd-focus text-sm font-semibold text-pd-accent-soft">← Choose another method</button>
      {mode === "scan" && <>
        <MedicationCameraScanner onScan={(result) => {
          setScan(result);
          const defaults = scanFormDefaults(result);
          setName(defaults.name);
          setScheduled(defaults.scheduled);
        }} />
        {scan && <section className="space-y-3 rounded-pd-chip border border-pd-accent-soft/40 bg-pd-accent/10 p-3">
          <h3 className="text-sm font-semibold text-pd-text">Review visible label details</h3>
          <p className="text-xs text-pd-muted">Correct anything unreadable. A package count is not a verified dispenser count.</p>
          {([ ["brand", "Brand"], ["activeIngredient", "Active ingredient"], ["strength", "Strength"], ["dosageForm", "Dosage form"], ["din", "DIN"], ["ndc", "NDC"], ["quantity", "Package quantity"] ] as const).map(([field, label]) =>
            <Field key={field} label={label} htmlFor={`slot-${field}`}><input id={`slot-${field}`} value={scan[field] ?? ""} maxLength={160} onChange={(event) => setScan({ ...scan, [field]: event.target.value || null })} className={input} /></Field>
          )}
          {scan.otherVisibleDetails.length > 0 && <p className="text-xs text-pd-muted">Other visible details: {scan.otherVisibleDetails.join(" · ")}</p>}
        </section>}
      </>}
      <Field label="Medication name" htmlFor="slot-name"><input id="slot-name" name="name" required maxLength={120} placeholder="e.g. Advil 200 mg tablet" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} className={input} /></Field>

      <div className="grid grid-cols-2 gap-3">
        {scheduled && <Field label="Dose per day" htmlFor="slot-dose">
          <div className="flex gap-2">
            <input id="slot-dose" name="dose" type="number" inputMode="numeric" min={1} max={9} defaultValue={mode === "scan" ? "" : 1} required className={`${input} w-16 shrink-0 text-center`} />
            <select name="unit" aria-label="Dose unit" className={input}>{UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select>
          </div>
        </Field>}
        <Field label={mode === "scan" ? "Verified supply (optional)" : "Pills loaded"} htmlFor="slot-count"><input id="slot-count" name="count" type="number" inputMode="numeric" min={0} max={10000} defaultValue={mode === "scan" ? "" : 30} required={mode === "manual"} className={input} /></Field>
      </div>

      {mode === "scan" && <label className="flex items-start gap-2 rounded-pd-chip border border-pd-line p-3 text-sm text-pd-text"><input type="checkbox" checked={scheduled} onChange={(event) => setScheduled(event.target.checked)} className="mt-1" /><span><strong>Configure scheduled dispensing</strong><br /><span className="text-xs text-pd-muted">Leave off for OTC medication. Scanning never sets a daily schedule.</span></span></label>}

      {scheduled && <Field label="Instructions" htmlFor="slot-instruction">
        <select id="slot-instruction" name="instruction" required defaultValue={mode === "scan" ? "" : INSTRUCTION_OPTIONS[0]} className={input}>{mode === "scan" && <option value="" disabled>Choose instructions</option>}{INSTRUCTION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select>
      </Field>}

      {scheduled && <Field label="Time" htmlFor="slot-time"><input id="slot-time" name="localTime" type="time" required defaultValue={mode === "scan" ? "" : "08:00"} className={input} /></Field>}

      {scheduled && <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-pd-muted">Repeat on</legend>
        <div className="flex justify-between gap-1">
          {WEEKDAYS.map((day, index) => {
            const on = days.includes(day);
            return (
              <button key={day} type="button" aria-pressed={on} aria-label={day} onClick={() => setDays(on ? days.filter((d) => d !== day) : [...days, day])} className={`pd-focus grid size-10 place-items-center rounded-full border text-xs font-bold transition-colors ${on ? "border-pd-accent-soft/60 bg-pd-accent/25 text-pd-text" : "border-pd-line text-pd-muted"}`}>{DAY_LABELS[index]}</button>
            );
          })}
        </div>
      </fieldset>}

      {unavailableMessage && <p className="text-sm text-pd-warn">{unavailableMessage}</p>}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={!onSave || saving || (scheduled && days.length === 0)} className="pd-press pd-focus flex min-h-12 w-full items-center justify-center rounded-full bg-gradient-to-br from-pd-accent to-pd-accent-2 text-base font-semibold text-white shadow-[0_8px_20px_-8px_rgba(84,121,255,0.9)] disabled:opacity-50">
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
