"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArduinoStatusPanel } from "./arduino-status-panel";
import { AuthControls } from "./auth-controls";
import { DemoCarePanel } from "./demo-care-panel";
import { MockDispensingPanel } from "./mock-dispensing-panel";
import { PatientDashboard } from "./patient-dashboard";
import { PatientReminders } from "./patient-reminders";
import { PatientSupplyReminder } from "./patient-supply-reminder";
import { VoiceCompanion } from "./voice-companion";
import { demoTabs, getDemoPanelStates, type DemoTabId } from "@/lib/demo-navigation";

export function DemoStudio({ authUiConfigured }: { authUiConfigured: boolean }) {
  const [activeTab, setActiveTab] = useState<DemoTabId>("today");
  const scrollAreaRef = useRef<HTMLElement>(null);
  const panels = getDemoPanelStates(activeTab);

  function selectTab(tab: DemoTabId) {
    setActiveTab(tab);
    scrollAreaRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#111a1c] text-[#163a40]">
      <div className="mx-auto grid min-h-screen max-w-[1440px] items-center gap-10 px-4 py-4 lg:grid-cols-[minmax(280px,0.75fr)_minmax(390px,470px)] lg:px-10 xl:grid-cols-[minmax(360px,0.8fr)_minmax(390px,470px)_minmax(80px,0.2fr)]">
        <aside className="hidden max-w-md text-white lg:block">
          <Link href="/patient" className="inline-flex items-center gap-3" aria-label="Return to PillSense patient view">
            <span className="grid size-12 place-items-center rounded-2xl bg-[#087f78] text-xl font-black">P</span>
            <span>
              <span className="block text-xl font-semibold">PillSense</span>
              <span className="block text-xs text-white/55">CalHacks medication-support prototype</span>
            </span>
          </Link>
          <p className="mt-10 text-xs font-bold uppercase tracking-[0.24em] text-[#8bd5c3]">Mobile Demo Studio</p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-[-0.035em]">
            One live app.<br />One supervised device.
          </h1>
          <p className="mt-5 max-w-sm text-base leading-7 text-white/65">
            A phone-proportioned mobile-web preview running real Clerk, Convex, Cartesia, and Web Bluetooth interactions in this desktop Chrome tab.
          </p>
          <div className="mt-8 flex flex-wrap gap-2 text-xs font-semibold text-white/70">
            <span className="rounded-full border border-white/15 bg-white/5 px-3 py-2">Live React UI</span>
            <span className="rounded-full border border-white/15 bg-white/5 px-3 py-2">Direct browser BLE</span>
            <span className="rounded-full border border-white/15 bg-white/5 px-3 py-2">Synthetic demo data</span>
          </div>
          <div className="mt-10 flex gap-3 text-sm">
            <Link href="/patient" className="rounded-full border border-white/20 px-4 py-2.5 text-white/80 hover:border-white/40">Full patient view</Link>
            <Link href="/caregiver" className="rounded-full border border-white/20 px-4 py-2.5 text-white/80 hover:border-white/40">Caregiver view</Link>
          </div>
        </aside>

        <section aria-label="PillSense mobile web preview" className="relative mx-auto flex h-[min(900px,calc(100dvh-2rem))] min-h-[620px] w-[min(430px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[2.8rem] border-[7px] border-[#263538] bg-[#f7f8f6] shadow-[0_30px_90px_rgba(0,0,0,0.48)]">
          <div aria-hidden="true" className="absolute left-1/2 top-2 z-30 h-5 w-24 -translate-x-1/2 rounded-full bg-[#111a1c]" />
          <header className="relative z-20 shrink-0 border-b border-[#dce5e1] bg-[#f7f8f6]/95 px-5 pb-4 pt-9 backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#087f78] text-lg font-black text-white">P</span>
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold tracking-tight text-[#163a40]">PillSense</p>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6b8589]">Mobile web preview</p>
                </div>
              </div>
              <details className="group relative">
                <summary className="grid min-h-11 cursor-pointer list-none place-items-center rounded-full border border-[#d5e1dd] bg-white px-3 text-xs font-bold text-[#163a40]">Account</summary>
                <div className="absolute right-0 top-12 z-40 w-72 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
                  {authUiConfigured ? (
                    <AuthControls />
                  ) : (
                    <p className="text-sm leading-6 text-amber-700">
                      Clerk or Convex public configuration is missing.
                    </p>
                  )}
                </div>
              </details>
            </div>
          </header>

          <section ref={scrollAreaRef} className="demo-mobile-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 pt-5">
            {panels.map((panel) => (
              <div
                key={panel.id}
                id={`demo-panel-${panel.id}`}
                role="tabpanel"
                aria-labelledby={`demo-tab-${panel.id}`}
                aria-hidden={panel.ariaHidden}
                className={`${panel.className} demo-mobile-content`}
              >
                {panel.id === "today" && <TodayPanel authUiConfigured={authUiConfigured} />}
                {panel.id === "dispenser" && <DispenserPanel authUiConfigured={authUiConfigured} />}
                {panel.id === "voice" && <VoicePanel authUiConfigured={authUiConfigured} />}
                {panel.id === "schedule" && <SchedulePanel authUiConfigured={authUiConfigured} />}
                {panel.id === "care" && <CarePanel authUiConfigured={authUiConfigured} />}
              </div>
            ))}
          </section>

          <nav aria-label="Mobile demo navigation" className="z-20 grid shrink-0 grid-cols-5 border-t border-[#d7e2de] bg-white/95 px-1 pb-3 pt-2 backdrop-blur">
            {demoTabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  id={`demo-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`demo-panel-${tab.id}`}
                  onClick={() => selectTab(tab.id)}
                  className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[10px] font-bold transition-colors ${active ? "bg-[#ddf3eb] text-[#087f78]" : "text-[#6b7f82] hover:bg-[#f2f5f3]"}`}
                >
                  <DemoIcon tab={tab.id} active={active} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </section>
        <div className="hidden xl:block" />
      </div>
    </main>
  );
}

function SectionIntro({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 px-1">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#087f78]">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-[#163a40]">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[#60777b]">{children}</p>
    </div>
  );
}

function TodayPanel({ authUiConfigured }: { authUiConfigured: boolean }) {
  return (
    <div className="space-y-5">
      <SectionIntro eyebrow="Today" title="Your routine, clearly organized.">
        Live schedule information from the authenticated PillSense care relationship.
      </SectionIntro>
      {authUiConfigured ? (
        <>
          <PatientSupplyReminder />
          <PatientDashboard />
        </>
      ) : <ConfigurationRequired />}
    </div>
  );
}

function DispenserPanel({ authUiConfigured }: { authUiConfigured: boolean }) {
  return (
    <div className="space-y-5">
      <SectionIntro eyebrow="Dispenser" title="Supervised hardware, explicit boundaries.">
        Real motor positioning and simulated medication dispensing remain separate workflows.
      </SectionIntro>
      <div className="rounded-[1.4rem] border border-dashed border-[#a8cfc5] bg-[#edf7f3] p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-white text-[#087f78] shadow-sm"><DemoIcon tab="dispenser" active /></span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#087f78]">Hardware visual reserved</p>
            <p className="mt-1 text-sm text-[#49686d]">H5 will add an approved real 3D or isometric asset here.</p>
          </div>
        </div>
      </div>
      <ArduinoStatusPanel />
      {authUiConfigured ? <MockDispensingPanel /> : <ConfigurationRequired />}
    </div>
  );
}

function VoicePanel({ authUiConfigured }: { authUiConfigured: boolean }) {
  return (
    <div className="space-y-5">
      <SectionIntro eyebrow="Voice" title="A calm companion with visible confirmation.">
        Cartesia speech and patient reporting use the existing handlers. Voice never directly starts the real motor.
      </SectionIntro>
      {authUiConfigured ? <VoiceCompanion /> : <ConfigurationRequired />}
    </div>
  );
}

function SchedulePanel({ authUiConfigured }: { authUiConfigured: boolean }) {
  return (
    <div className="space-y-5">
      <SectionIntro eyebrow="Schedule" title="Reminders with honest evidence.">
        Motor completion and ingestion remain distinct; all synthetic time controls stay labeled.
      </SectionIntro>
      {authUiConfigured ? <PatientReminders /> : <ConfigurationRequired />}
    </div>
  );
}

function CarePanel({ authUiConfigured }: { authUiConfigured: boolean }) {
  return (
    <div className="space-y-5">
      <SectionIntro eyebrow="Care" title="Caregiver context, only when authorized.">
        Review real reactive alerts here or open the complete protected caregiver and agent workspaces.
      </SectionIntro>
      {authUiConfigured ? <DemoCarePanel /> : <ConfigurationRequired />}
    </div>
  );
}

function ConfigurationRequired() {
  return (
    <section className="rounded-[1.4rem] border border-amber-200 bg-amber-50 p-5">
      <h2 className="text-lg font-semibold text-[#163a40]">Authentication setup required</h2>
      <p className="mt-2 text-sm leading-6 text-amber-900">
        Add the documented Clerk and Convex public environment configuration to enable private app data.
      </p>
    </section>
  );
}

function DemoIcon({ tab, active }: { tab: DemoTabId; active: boolean }) {
  const common = { width: 21, height: 21, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: active ? 2.2 : 1.8 };
  if (tab === "today") return <svg aria-hidden="true" {...common}><path d="M5 5.5h14v14H5z" rx="3" /><path d="M8 3v5M16 3v5M8 12h8M8 16h5" /></svg>;
  if (tab === "dispenser") return <svg aria-hidden="true" {...common}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2" /><path d="M12 4v6M18.9 16l-5.2-3" /></svg>;
  if (tab === "voice") return <svg aria-hidden="true" {...common}><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" /></svg>;
  if (tab === "schedule") return <svg aria-hidden="true" {...common}><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h7" /></svg>;
  return <svg aria-hidden="true" {...common}><path d="M12 20s-7-4.2-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.8-7 10-7 10Z" /><path d="M9 12h6" /></svg>;
}
