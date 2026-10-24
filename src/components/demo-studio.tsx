"use client";

import Link from "next/link";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { ArduinoStatusPanel } from "./arduino-status-panel";
import { AuthControls } from "./auth-controls";
import { DemoCarePanel } from "./demo-care-panel";
import { BrandMark, Icon, ScreenHeader, type IconName } from "./mobile-ui";
import { MockDispensingPanel } from "./mock-dispensing-panel";
import { ScheduleScreen } from "./schedule-screen";
import { SetupSheet } from "./setup-sheet";
import { TodayScreen } from "./today-screen";
import { VoiceCompanion } from "./voice-companion";
import { demoTabs, getDemoPanelStates, type DemoTabId } from "@/lib/demo-navigation";

const tabIcons: Record<DemoTabId, IconName> = { today: "home", dispenser: "cube", voice: "mic", schedule: "calendar", care: "people" };

export function DemoStudio({ authUiConfigured }: { authUiConfigured: boolean }) {
  const [activeTab, setActiveTab] = useState<DemoTabId>("today");
  const [setupOpen, setSetupOpen] = useState(false);
  const scrollAreaRef = useRef<HTMLElement>(null);
  const panels = getDemoPanelStates(activeTab);

  const selectTab = useCallback((tab: DemoTabId) => {
    setActiveTab(tab);
    scrollAreaRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const closeSetup = useCallback(() => setSetupOpen(false), []);
  const goToday = useCallback(() => selectTab("today"), [selectTab]);
  const goDispenser = useCallback(() => selectTab("dispenser"), [selectTab]);
  const goSchedule = useCallback(() => selectTab("schedule"), [selectTab]);

  const account = (icon: IconName = "gear") => (
    <AccountMenu authUiConfigured={authUiConfigured} icon={icon} />
  );

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

        <section aria-label="PillSense mobile web preview" className="ps-canvas relative mx-auto flex h-[min(858px,calc(100dvh-2rem))] min-h-[620px] w-[min(404px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[2.8rem] border-[7px] border-[#0f1b26] shadow-[0_30px_90px_rgba(0,0,0,0.55)]">
          <div aria-hidden="true" className="absolute left-1/2 top-2 z-30 h-6 w-28 -translate-x-1/2 rounded-full bg-[#0f1b26]" />

          <section ref={scrollAreaRef} inert={setupOpen} className="demo-mobile-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-10 pt-11">
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
                    ? <TodayScreen account={account("people")} onOpenDispenser={goDispenser} onOpenSchedule={goSchedule} />
                    : <ConfigurationRequired />
                )}
                {panel.id === "dispenser" && (
                  <div className="space-y-4">
                    <ScreenHeader title="My Dispenser" subtitle="Arduino Uno R4 WiFi prototype" onBack={goToday} right={account()} />
                    <ArduinoStatusPanel onOpenSetup={() => setSetupOpen(true)} />
                    {authUiConfigured ? <MockDispensingPanel /> : <ConfigurationRequired />}
                  </div>
                )}
                {panel.id === "voice" && (
                  <div>
                    <ScreenHeader title="Voice Companion" subtitle="Speak, read, or tap" onBack={goToday} right={account()} />
                    {authUiConfigured ? <VoiceCompanion onOpenDispenser={goDispenser} /> : <ConfigurationRequired />}
                  </div>
                )}
                {panel.id === "schedule" && (
                  <div>
                    <ScreenHeader title="Schedule" subtitle="Persisted doses and reminders" onBack={goToday} right={account()} />
                    {authUiConfigured ? <ScheduleScreen /> : <ConfigurationRequired />}
                  </div>
                )}
                {panel.id === "care" && (
                  <div>
                    <ScreenHeader title="Caregiver" subtitle="Shown only when authorized" right={account("people")} />
                    {authUiConfigured ? <DemoCarePanel /> : <ConfigurationRequired />}
                  </div>
                )}
              </div>
            ))}
          </section>

          <nav aria-label="Mobile demo navigation" role="tablist" inert={setupOpen} className="relative z-20 grid shrink-0 grid-cols-5 items-end bg-white px-1 pb-2.5 pt-1.5 shadow-[0_-6px_18px_-14px_rgba(15,76,117,0.3)]">
            {demoTabs.map((tab) => {
              const active = activeTab === tab.id;
              const isVoice = tab.id === "voice";
              return (
                <button
                  key={tab.id}
                  id={`demo-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`demo-panel-${tab.id}`}
                  onClick={() => selectTab(tab.id)}
                  className={`ps-focus flex min-h-14 flex-col items-center justify-end gap-0.5 rounded-2xl px-1 text-[0.625rem] transition-colors ${active ? "font-bold text-[#0f766e]" : "font-medium text-[#64748b]"}`}
                >
                  {isVoice ? (
                    <span aria-hidden="true" className={`ps-orb -mt-5 grid size-[3.6rem] place-items-center rounded-full text-white ring-[3px] ring-white ${active ? "" : "opacity-95"}`}><Icon name="mic" size={26} strokeWidth={2} /></span>
                  ) : (
                    <Icon name={tabIcons[tab.id]} size={22} strokeWidth={active ? 2.1 : 1.7} className={active ? "fill-[#14b8a6]/25" : undefined} />
                  )}
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {setupOpen && <SetupSheet authUiConfigured={authUiConfigured} onClose={closeSetup} />}
        </section>
        <div className="hidden xl:block" />
      </div>
    </main>
  );
}

function AccountMenu({ authUiConfigured, icon }: { authUiConfigured: boolean; icon: IconName }) {
  return (
    <details className="group relative shrink-0">
      <summary aria-label="Account and settings" className="ps-focus grid size-10 cursor-pointer list-none place-items-center rounded-full border border-[#e3ecf6] bg-white text-[#334155] shadow-[0_2px_8px_-4px_rgba(15,76,117,0.25)] [&::-webkit-details-marker]:hidden">
        <Icon name={icon} size={20} />
      </summary>
      <div className="absolute right-0 top-12 z-40 w-72 rounded-2xl border border-[#dbe7f3] bg-white p-4 shadow-xl">
        {authUiConfigured ? (
          <AuthControls />
        ) : (
          <p className="text-sm leading-6 text-amber-700">Clerk or Convex public configuration is missing.</p>
        )}
      </div>
    </details>
  );
}

function ConfigurationRequired(): ReactNode {
  return (
    <section className="ps-card border-amber-200 bg-amber-50 p-5">
      <h2 className="ps-display text-lg font-semibold text-[#0f172a]">Authentication setup required</h2>
      <p className="mt-2 text-sm leading-6 text-amber-900">
        Add the documented Clerk and Convex public environment configuration to enable private app data.
      </p>
    </section>
  );
}
