"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../../convex/_generated/api";
import { AuthRequired } from "./auth-required";
import { INSTRUCTION_OPTIONS } from "../../convex/lib/instructionOptions";
import { getAvailableSlots } from "@/lib/slots";
import { MedicationCameraScanner } from "./medication-camera-scanner";
import type { MedicationScan } from "@/lib/medication-scan";
import { productDetailsForSave, scanFormDefaults } from "@/lib/medication-scan";
import { medicationSaveError } from "../lib/medication-save-error";

const weekdays = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
type Weekday = (typeof weekdays)[number];

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function CaregiverMedicationSetup() {
  const { isLoading, isAuthenticated } = useConvexAuth();

  if (isLoading) {
    return <StateCard title="Checking access…">Confirming Clerk and Convex authentication.</StateCard>;
  }
  if (!isAuthenticated) {
    return <AuthRequired message="Medication setup is private and requires Convex to accept your Clerk session." />;
  }
  return <AuthenticatedMedicationSetup />;
}

function AuthenticatedMedicationSetup() {
  const setup = useQuery(api.caregiver.setup);
  const ensureCareTeam = useMutation(api.demo.ensureCareTeam);
  const createMedication = useMutation(api.medications.createWithAssignment);
  const [onboarding, setOnboarding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState<Weekday[]>([
    "SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT",
  ]);
  const [timezone, setTimezone] = useState("America/Toronto");
  const [name, setName] = useState("");
  const [scan, setScan] = useState<MedicationScan | null>(null);
  const [scheduled, setScheduled] = useState(true);

  if (setup === undefined) {
    return <StateCard title="Loading care team…">Fetching the authenticated caregiver workspace.</StateCard>;
  }

  if (setup.status === "needs_onboarding") {
    return (
      <StateCard title="Create a synthetic care pair">
        <p>This explicit demo action creates one synthetic patient, one Uno R4 dispenser record, and a caregiver relationship owned by your authenticated account.</p>
        {error && <InlineError message={error} />}
        <button
          type="button"
          disabled={onboarding}
          onClick={async () => {
            setOnboarding(true);
            setError(null);
            try {
              await ensureCareTeam({});
            } catch (caught) {
              setError(messageFromError(caught));
            } finally {
              setOnboarding(false);
            }
          }}
          className="mt-5 rounded-full bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {onboarding ? "Creating demo pair…" : "Create demo caregiver + patient"}
        </button>
      </StateCard>
    );
  }

  if (setup.status === "unauthorized") {
    return <StateCard title="Caregiver access required">This account does not have the caregiver role required for medication setup.</StateCard>;
  }
  if (setup.status === "unavailable") {
    return <StateCard title="Care team unavailable">The paired demo patient or device record could not be found.</StateCard>;
  }

  const readySetup = setup;
  const occupiedSlots = new Set(readySetup.medications.map((medication) => medication.slot));
  const availableSlots = getAvailableSlots(occupiedSlots);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError(null);
    setSuccess(null);
    setSaving(true);
    const form = new FormData(formElement);
    try {
      const result = await createMedication({
        patientId: readySetup.patient.id,
        name: String(form.get("name") ?? ""),
        instructions: scheduled ? String(form.get("instructions") ?? "") : "",
        scheduled,
        productDetails: scan ? productDetailsForSave(scan) : undefined,
        slot: Number(form.get("slot")),
        localTime: String(form.get("localTime") ?? ""),
        weekdays: selectedDays,
        timezone,
        demoInventory: Number(form.get("demoInventory")),
      });
      setSuccess(`Medication assigned to Slot ${result.slot}.`);
      formElement.reset();
      setSelectedDays([...weekdays]);
      setName(""); setScan(null); setScheduled(true);
    } catch (caught) {
      setError(medicationSaveError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
      <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-teal-700">{readySetup.patient.displayName}</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Add medication schedule</h2>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{readySetup.device.label}</span>
        </div>

        <MedicationCameraScanner tone="light" onScan={(result) => {
          setScan(result);
          const defaults = scanFormDefaults(result);
          setName(defaults.name);
          setScheduled(defaults.scheduled);
          setSuccess(null);
        }} />
        {scan && <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-4">
          <h3 className="font-semibold">Visible label details · review and correct</h3>
          <p className="mt-1 text-xs text-slate-600">Blank fields were not readable. Package quantity is not the pill count loaded into the dispenser.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {([ ["brand", "Brand"], ["activeIngredient", "Active ingredient"], ["strength", "Strength"], ["dosageForm", "Dosage form"], ["din", "DIN"], ["ndc", "NDC"], ["quantity", "Package quantity"] ] as const).map(([field, label]) =>
              <Field key={field} label={label} htmlFor={`scan-${field}`}><input id={`scan-${field}`} value={scan[field] ?? ""} maxLength={160} onChange={(event) => setScan({ ...scan, [field]: event.target.value || null })} className="input" /></Field>
            )}
          </div>
          {scan.otherVisibleDetails.length > 0 && <p className="mt-3 text-xs text-slate-600">Other visible details: {scan.otherVisibleDetails.join(" · ")}</p>}
        </div>}

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field label="Medication name" htmlFor="name">
            <input id="name" name="name" required maxLength={120} placeholder="Iron Pills" value={name} onChange={(event) => setName(event.target.value)} className="input" />
          </Field>
          <Field label="Compartment" htmlFor="slot">
            <select id="slot" name="slot" required defaultValue="" className="input">
              <option value="" disabled>Select Slot 1–7</option>
              {[1, 2, 3, 4, 5, 6, 7].map((slot) => (
                <option key={slot} value={slot} disabled={!availableSlots.includes(slot as 1 | 2 | 3 | 4 | 5 | 6 | 7)}>
                  Slot {slot}{occupiedSlots.has(slot) ? " — already occupied" : ""}
                </option>
              ))}
            </select>
          </Field>
          {scheduled && <Field label="Local time" htmlFor="localTime">
            <input id="localTime" name="localTime" required type="time" defaultValue="09:00" className="input" />
          </Field>}
          {scheduled && <Field label="IANA timezone" htmlFor="timezone">
            <input id="timezone" required value={timezone} onChange={(event) => setTimezone(event.target.value)} className="input" />
          </Field>}
          <Field label="Demo inventory" htmlFor="demoInventory">
            <select id="demoInventory" name="demoInventory" defaultValue="1" className="input">
              <option value="1">1 inert demo pill loaded</option>
              <option value="0">Empty</option>
            </select>
          </Field>
          {scheduled && <Field label="Instructions" htmlFor="instructions" wide>
            <select id="instructions" name="instructions" defaultValue={INSTRUCTION_OPTIONS[0]} className="input">
              {INSTRUCTION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </Field>}
        </div>

        <label className="mt-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <input type="checkbox" checked={scheduled} onChange={(event) => setScheduled(event.target.checked)} className="mt-1" />
          <span><strong>Configure scheduled dispensing</strong><br />Leave unchecked for an unscheduled OTC medication. Scanning a label never supplies directions or starts reminders.</span>
        </label>

        {scheduled && <fieldset className="mt-5">
          <legend className="text-sm font-semibold text-slate-700">Scheduled weekdays</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {weekdays.map((day) => {
              const selected = selectedDays.includes(day);
              return (
                <label key={day} className={`cursor-pointer rounded-full border px-3 py-2 text-xs font-semibold ${selected ? "border-teal-600 bg-teal-50 text-teal-800" : "border-slate-200 text-slate-500"}`}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => setSelectedDays((current) => selected ? current.filter((value) => value !== day) : [...current, day])}
                    className="sr-only"
                  />
                  {day}
                </label>
              );
            })}
          </div>
        </fieldset>}

        {error && <InlineError message={error} />}
        {success && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}
        <button type="submit" disabled={saving} className="mt-6 rounded-full bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60">
          {saving ? "Saving…" : "Save medication assignment"}
        </button>
      </form>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Active compartments</h2>
        {readySetup.medications.length === 0 ? (
          <p className="mt-3 text-sm leading-6 text-slate-600">No medications assigned yet. Slots 1–7 are available; position 0 remains reserved for home alignment.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {readySetup.medications.map((medication) => (
              <li key={medication.medicationId} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{medication.name}</span>
                  <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-800">Slot {medication.slot}</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">{medication.localTime ? `${medication.localTime} · ${medication.timezone}` : "Unscheduled · no automatic dispensing"}</p>
                <p className="mt-1 text-xs text-slate-500">{medication.weekdays.join(" · ")} · {medication.demoInventory} inert pill</p>
                {medication.productDetails && <p className="mt-1 text-xs text-slate-500">{[medication.productDetails.activeIngredient, medication.productDetails.strength, medication.productDetails.dosageForm, medication.productDetails.din && `DIN ${medication.productDetails.din}`].filter(Boolean).join(" · ")}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({ label, htmlFor, wide = false, children }: { label: string; htmlFor: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-2 block text-sm font-semibold text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function StateCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{children}</div>
    </section>
  );
}

function InlineError({ message }: { message: string }) {
  return <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{message}</p>;
}
