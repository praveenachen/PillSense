"use client";

import Link from "next/link";
import { Suspense, useCallback, useRef, useState, type ReactNode } from "react";
import { AuthControls } from "./auth-controls";
import { DemoCarePanel } from "./demo-care-panel";
import { DispenserScreen } from "./dispenser-screen";
import { BrandMark, Icon, type IconName } from "./mobile-ui";
import { PatientNav } from "./patient-nav";
import { ScheduleScreen } from "./schedule-screen";
import { SetupSheet } from "./setup-sheet";
import { TodayScreen } from "./today-screen";
import { VoiceCompanion } from "./voice-companion";
import { getDemoPanelStates, type DemoTabId } from "@/lib/demo-navigation";

export function DemoStudio({ authUiConfigured }: { authUiConfigured: boolean }) {
  const [activeTab, setActiveTab] = useState<DemoTabId>("today");
  const [setupOpen, setSetupOpen] = useState(false);
  const [voiceRequest, setVoiceRequest] = useState<{ occurrenceId: string; token: number; requestedAt: number } | null>(null);
  const scrollAreaRef = useRef<HTMLElement>(null);
  const voiceRequestToken = useRef(0);
  const panels = getDemoPanelStates(activeTab);

  const selectTab = useCallback((tab: DemoTabId) => {
    setActiveTab(tab);
    scrollAreaRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const closeSetup = useCallback(() => setSetupOpen(false), []);
  const goDispenser = useCallback(() => selectTab("dispenser"), [selectTab]);
  const goSchedule = useCallback(() => selectTab("schedule"), [selectTab]);
  const goVoice = useCallback(() => {
    setVoiceRequest(null);
    selectTab("voice");
  }, [selectTab]);
  const goScheduledVoice = useCallback((occurrenceId: string) => {
    setVoiceRequest({ occurrenceId, token: ++voiceRequestToken.current, requestedAt: Date.now() });
    selectTab("voice");
  }, [selectTab]);

  const todayAccount = () => (
    <AccountMenu authUiConfigured={authUiConfigured} icon="user" dark />
  );
  const isDarkPatientScreen = activeTab === "today" || activeTab === "dispenser" || activeTab === "voice" || activeTab === "schedule" || activeTab === "care";

  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(120%_90%_at_20%_0%,#14405a_0%,#0b2233_55%,#08141f_100%)] text-[#0f172a]">
      <div className="mx-auto grid min-h-screen max-w-[1440px] items-center gap-10 px-4 py-4 lg:grid-cols-[minmax(280px,0.75fr)_minmax(390px,420px)] lg:px-10 xl:grid-cols-[minmax(360px,0.8fr)_minmax(390px,420px)_minmax(80px,0.2fr)]">
        <aside className="hidden max-w-md text-white lg:block">
          <Link href="/patient" className="inline-flex items-center gap-3" aria-label="Return to PillSense patient view">
            <BrandMark size={48} />
            <span>
              <span className="ps-display block text-xl font-semibold">PillSense</span>
              <span className="block text-xs text-white/60">CalHacks medication-support prototype</span>
            </span>
          </Link>
          <p className="mt-10 text-xs font-bold uppercase tracking-[0.24em] text-[#7fe0d2]">Mobile Demo Studio</p>
          <h1 className="ps-display mt-4 text-4xl font-semibold leading-tight">
            One live app.<br />One supervised device.
          </h1>
          <p className="mt-5 max-w-sm text-base leading-7 text-white/70">
            A phone-proportioned mobile-web preview running real Clerk, Convex, Cartesia, and Web Bluetooth interactions in this desktop Chrome tab.
          </p>
          <div className="mt-8 flex flex-wrap gap-2 text-xs font-semibold text-white/75">
            <span className="rounded-full border border-white/15 bg-white/5 px-3 py-2">Live React UI</span>
            <span className="rounded-full border border-white/15 bg-white/5 px-3 py-2">Direct browser BLE</span>
            <span className="rounded-full border border-white/15 bg-white/5 px-3 py-2">Synthetic demo data</span>
          </div>
          <div className="mt-10 flex gap-3 text-sm">
            <Link href="/patient" className="rounded-full border border-white/20 px-4 py-2.5 text-white/80 hover:border-white/40">Full patient view</Link>
            <Link href="/caregiver" className="rounded-full border border-white/20 px-4 py-2.5 text-white/80 hover:border-white/40">Caregiver view</Link>
          </div>
        </aside>

        <section aria-label="PillSense mobile web preview" className={`${isDarkPatientScreen ? "pd-canvas" : "ps-canvas"} relative mx-auto flex h-[min(858px,calc(100dvh-2rem))] min-h-[620px] w-[min(404px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[2.8rem] border-[7px] border-[#0f1b26] shadow-[0_30px_90px_rgba(0,0,0,0.55)]`}>
          <div aria-hidden="true" className="absolute left-1/2 top-2 z-30 h-6 w-28 -translate-x-1/2 rounded-full bg-[#0f1b26]" />

          <section ref={scrollAreaRef} inert={setupOpen} className={`demo-mobile-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain [&>#demo-panel-voice]:min-h-full [&>#demo-panel-voice.block]:flex [&>#demo-panel-voice.block]:flex-col [&>#demo-panel-care]:min-h-full [&>#demo-panel-care.block]:flex [&>#demo-panel-care.block]:flex-col ${isDarkPatientScreen ? "px-5" : "px-4"} pb-10 pt-11`}>
            {panels.map((panel) => (
              <div
                key={panel.id}
                id={`demo-panel-${panel.id}`}
                role="tabpanel"
                aria-labelledby={`demo-tab-${panel.id}`}
                aria-hidden={panel.ariaHidden}
                inert={panel.ariaHidden}
                className={`${panel.className} demo-mobile-content`}
              >
                {panel.id === "today" && (
                  authUiConfigured
                    ? <TodayScreen account={todayAccount} onOpenDispenser={goDispenser} onOpenSchedule={goSchedule} onOpenVoice={goVoice} onOpenReminder={goScheduledVoice} />
                    : <ConfigurationRequired />
                )}
                {panel.id === "dispenser" && (
                  authUiConfigured
                    ? <Suspense fallback={<section className="pd-card p-5 text-sm text-pd-muted">Loading your dispenser…</section>}><DispenserScreen onOpenSetup={() => setSetupOpen(true)} /></Suspense>
                    : <ConfigurationRequired />
                )}
                {panel.id === "voice" && (
                  authUiConfigured ? <VoiceCompanion demoMode active={activeTab === "voice"} startRequest={voiceRequest} /> : <ConfigurationRequired />
                )}
                {panel.id === "schedule" && (
                  authUiConfigured ? <ScheduleScreen /> : <ConfigurationRequired dark />
                )}
                {panel.id === "care" && (
                  authUiConfigured ? <DemoCarePanel account={todayAccount()} /> : <ConfigurationRequired dark />
                )}
              </div>
            ))}
          </section>

          <PatientNav activeTab={activeTab} onSelect={selectTab} inert={setupOpen} />

          {setupOpen && <SetupSheet authUiConfigured={authUiConfigured} onClose={closeSetup} />}
        </section>
        <div className="hidden xl:block" />
      </div>
    </main>
  );
}

function AccountMenu({ authUiConfigured, icon, dark }: { authUiConfigured: boolean; icon: IconName; dark?: boolean }) {
  return (
    <details className="group relative shrink-0">
      <summary
        aria-label="Account and settings"
        className={`ps-focus grid cursor-pointer list-none place-items-center rounded-full [&::-webkit-details-marker]:hidden ${dark
          ? "size-11 border border-pd-line bg-pd-surface-2 text-pd-text transition-colors duration-200 hover:border-pd-accent/50"
          : "size-10 border border-[#e3ecf6] bg-white text-[#334155] shadow-[0_2px_8px_-4px_rgba(15,76,117,0.25)]"}`}
      >
        <Icon name={icon} size={20} />
      </summary>
      <div className="absolute right-0 top-12 z-40 w-72 rounded-2xl border border-[#dbe7f3] bg-white p-4 text-[#0f172a] shadow-xl">
        {authUiConfigured ? (
          <AuthControls />
        ) : (
          <p className="text-sm leading-6 text-amber-700">Clerk or Convex public configuration is missing.</p>
        )}
      </div>
    </details>
  );
}

function ConfigurationRequired({ dark = false }: { dark?: boolean } = {}): ReactNode {
  return (
    <section className={dark ? "pd-card p-5" : "ps-card border-amber-200 bg-amber-50 p-5"}>
      <h2 className={dark ? "text-lg font-semibold text-pd-text" : "ps-display text-lg font-semibold text-[#0f172a]"}>Authentication setup required</h2>
      <p className={`mt-2 text-sm leading-6 ${dark ? "text-pd-muted" : "text-amber-900"}`}>
        Add the documented Clerk and Convex public environment configuration to enable private app data.
      </p>
    </section>
  );
}
