"use client";

import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { CarouselGraphic, Icon, MedicationIcon } from "./mobile-ui";

const steps = ["Connect", "Map Slots", "Verify", "Complete"] as const;
const SUPPORTED_TEST_SLOT = 6;

type SlotAssignment = { name: string; localTime: string; demoInventory: number };

/**
 * Setup & Slot Mapping. Purely informational/navigational: selecting a slot or advancing a step
 * never sends a Bluetooth command, moves the carousel, or writes data. Real configuration stays
 * in the protected caregiver workspace and the supervised controls stay in My Dispenser.
 */
export function SetupSheet({ authUiConfigured, onClose }: { authUiConfigured: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<number>(1);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="setup-title" className="ps-canvas absolute inset-0 z-40 flex flex-col overflow-hidden rounded-[2.2rem] pt-9">
      <header className="flex items-center gap-2 px-4 pb-3">
        <button type="button" onClick={() => (step === 0 ? onClose() : setStep(step - 1))} aria-label={step === 0 ? "Close setup" : "Previous step"} className="ps-focus -ml-1 grid size-11 place-items-center rounded-full text-[#0f172a] hover:bg-white/70"><Icon name="back" /></button>
        <h2 id="setup-title" ref={titleRef} tabIndex={-1} className="ps-display flex-1 text-center text-[1.05rem] font-semibold text-[#0f172a] outline-none">Setup &amp; Slot Mapping</h2>
        <button type="button" onClick={onClose} aria-label="Close setup" className="ps-focus grid size-11 place-items-center rounded-full text-[#0f172a] hover:bg-white/70"><Icon name="close" /></button>
      </header>

      <ol aria-label="Setup progress" className="grid grid-cols-4 px-4 pb-2">
        {steps.map((label, index) => (
          <li key={label} className="relative flex flex-col items-center gap-0.5 text-[0.7rem]" aria-current={index === step ? "step" : undefined}>
            {index < steps.length - 1 && <span aria-hidden="true" className={`absolute left-1/2 top-[0.85rem] h-px w-full ${index < step ? "bg-[#14b8a6]" : "bg-[#cfe0ee]"}`} />}
            <button type="button" onClick={() => setStep(index)} className={`ps-focus relative z-10 grid size-7 place-items-center rounded-full text-xs font-bold ${index === step ? "bg-[#0f766e] text-white" : index < step ? "bg-[#14b8a6] text-white" : "border border-[#b7cde6] bg-white text-[#475569]"}`} aria-label={`Step ${index + 1}: ${label}`}>
              {index < step ? <Icon name="check" size={14} strokeWidth={2.6} /> : index + 1}
            </button>
            <span className={index === step ? "font-semibold text-[#0f172a]" : "text-[#64748b]"}>{label}</span>
          </li>
        ))}
      </ol>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 demo-mobile-scroll">
        {authUiConfigured ? <SetupBody step={step} selected={selected} onSelect={setSelected} onClose={onClose} /> : <p className="ps-card p-4 text-sm text-[#475569]">Authentication setup is required to read slot assignments.</p>}
      </div>

      <footer className="bg-white px-4 pb-4 pt-3 shadow-[0_-6px_18px_-14px_rgba(15,76,117,0.3)]">
        {step < steps.length - 1 ? (
          <button type="button" onClick={() => setStep(step + 1)} className="ps-cta flex min-h-[3.4rem] w-full items-center justify-center gap-2 rounded-full text-[1rem] font-semibold">Continue to {steps[step + 1]} <Icon name="arrow" size={18} /></button>
        ) : (
          <button type="button" onClick={onClose} className="ps-cta flex min-h-[3.4rem] w-full items-center justify-center gap-2 rounded-full text-[1rem] font-semibold">Done</button>
        )}
      </footer>
    </div>
  );
}

function SetupBody({ step, selected, onSelect, onClose }: { step: number; selected: number; onSelect: (slot: number) => void; onClose: () => void }) {
  const auth = useConvexAuth();
  const dashboard = useQuery(api.patient.dashboard, auth.isAuthenticated ? {} : "skip");
  const assignments = new Map<number, SlotAssignment>();
  if (dashboard?.status === "ready") {
    for (const m of dashboard.medications) assignments.set(m.slot, { name: m.name, localTime: m.localTime, demoInventory: m.demoInventory });
  }
  const occupied = new Set(assignments.keys());
  const selectedAssignment = assignments.get(selected);

  if (step === 0) {
    return (
      <div className="space-y-3">
        <section className="ps-card p-4">
          <h3 className="ps-display text-lg font-semibold text-[#0f172a]">Connect your dispenser</h3>
          <p className="mt-2 text-sm leading-6 text-[#475569]">Pairing happens over Web Bluetooth in this browser tab, from My Dispenser. This setup guide never creates a second connection.</p>
          <button type="button" onClick={onClose} className="ps-focus mt-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-[#b7cde6] bg-white px-5 text-sm font-semibold text-[#0f766e]"><Icon name="bluetooth" size={18} /> Go to pairing controls</button>
        </section>
        <section className="ps-card p-4 text-sm leading-6 text-[#475569]">
          <p className="font-semibold text-[#0f172a]">What to expect</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>The carousel has positions 0–7. Position 0 is the home reference; positions 1–7 hold medications.</li>
            <li>Battery level and live position are not reported by this prototype.</li>
          </ul>
        </section>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="space-y-3">
        <div className="px-1">
          <div className="mx-auto w-[min(100%,15.5rem)]">
            <CarouselGraphic variant="map" selectedSlot={selected} occupiedSlots={occupied} onSelectSlot={onSelect} />
          </div>
          <p className="mt-1 text-center text-[0.7rem] leading-4 text-[#64748b]">Illustrative map — selecting a slot does <strong>not</strong> move the hardware.</p>
        </div>
        <section aria-live="polite" className="ps-card p-3.5">
          {selected === 0 ? (
            <>
              <p className="text-base font-semibold text-[#0f172a]">Slot 0 · Home reference</p>
              <p className="mt-1 text-sm leading-6 text-[#475569]">The position you align to by hand before startup. It is not a medication slot and its alignment is not sensor-verified.</p>
            </>
          ) : (
            <>
              <div className="flex items-start gap-3">
                {selectedAssignment && <MedicationIcon size={44} />}
                <div className="min-w-0 flex-1">
                  <p className="text-[0.95rem] font-semibold text-[#0f172a]">Slot {selected}</p>
                  <p className="truncate text-sm text-[#475569]">{selectedAssignment ? `${selectedAssignment.name} · ${selectedAssignment.localTime}` : "No medication assigned"}</p>
                </div>
                {selected === SUPPORTED_TEST_SLOT && <span className="shrink-0 rounded-full bg-[#fef3d7] px-2.5 py-0.5 text-[0.7rem] font-semibold text-[#8a5a00]">Supervised test slot</span>}
              </div>
              {selectedAssignment && <p className="mt-2 text-xs text-[#64748b]">Demo inventory: {selectedAssignment.demoInventory} inert {selectedAssignment.demoInventory === 1 ? "pill" : "pills"}</p>}
              <p className="mt-2 text-xs leading-5 text-[#64748b]">{selected === SUPPORTED_TEST_SLOT ? "Slot 6 is the only slot the supervised motor test can target, on an empty carousel." : "Hardware movement is only supported for the Slot 6 supervised test."}</p>
            </>
          )}
        </section>
        <section aria-labelledby="all-slots-title">
          <h3 id="all-slots-title" className="px-1 text-[0.95rem] font-semibold text-[#0f172a]">All slots</h3>
          <ul className="ps-card mt-1.5 divide-y divide-[#e6eef6] overflow-hidden">
            {[1, 2, 3, 4, 5, 6, 7].map((slot) => {
              const assignment = assignments.get(slot);
              return (
                <li key={slot}>
                  <button type="button" onClick={() => onSelect(slot)} aria-pressed={selected === slot} className={`ps-focus flex min-h-12 w-full items-center gap-3 px-3 text-left ${selected === slot ? "bg-[#d9f5ef]/60" : ""}`}>
                    <span aria-hidden="true" className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${selected === slot ? "bg-[#0f766e] text-white" : "bg-[#e8eef5] text-[#475569]"}`}>{slot}</span>
                    <span className={`min-w-0 flex-1 truncate text-sm ${assignment ? "font-medium text-[#0f172a]" : "text-[#64748b]"}`}>{assignment ? assignment.name : "Unassigned"}</span>
                    {assignment && <span className="text-xs text-[#64748b]">{assignment.localTime}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        <Link href="/caregiver" className="ps-focus flex min-h-11 items-center justify-between rounded-2xl border border-[#d4e3f2] bg-white px-4 text-sm font-semibold text-[#0f766e]">Edit assignments in caregiver setup <Icon name="chevron" size={16} /></Link>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="space-y-3">
        <section className="ps-card p-4">
          <h3 className="ps-display text-lg font-semibold text-[#0f172a]">Verify by hand</h3>
          <p className="mt-2 text-sm leading-6 text-[#475569]">PillSense cannot detect the carousel position. Before any supervised movement you confirm each of these yourself in My Dispenser:</p>
          <ul className="mt-3 space-y-2 text-sm text-[#1e293b]">
            {["The carousel is empty — no medications.", "You aligned the device to Slot 0 before startup.", "Hands, cables and objects are clear of moving parts."].map((line) => (
              <li key={line} className="flex gap-2"><span aria-hidden="true" className="mt-0.5 text-[#0f766e]"><Icon name="shield" size={16} /></span>{line}</li>
            ))}
          </ul>
          <button type="button" onClick={onClose} className="ps-focus mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border border-[#b7cde6] bg-white px-5 text-sm font-semibold text-[#0f766e]">Go to supervised controls <Icon name="arrow" size={16} /></button>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <section className="ps-card p-4">
        <h3 className="ps-display text-lg font-semibold text-[#0f172a]">Setup review</h3>
        <p className="mt-2 text-sm leading-6 text-[#475569]">{occupied.size} of 7 medication slots currently have an assignment.</p>
        <p className="mt-3 text-xs leading-5 text-[#64748b]">This guide did not move the device, change any assignment, or verify alignment. Slot 6 remains the only supported supervised motor-test target, and a completed test does not prove pill release or ingestion.</p>
      </section>
    </div>
  );
}
