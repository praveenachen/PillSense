"use client";

import { Icon, type IconName } from "./mobile-ui";
import { demoTabs, type DemoTabId } from "@/lib/demo-navigation";

const tabIcons: Record<DemoTabId, IconName> = { today: "home", dispenser: "cube", voice: "wave", schedule: "calendar", care: "people" };
const tabLabels: Record<DemoTabId, string> = { today: "Home", dispenser: "Dispenser", voice: "Voice", schedule: "Schedule", care: "Care" };

/**
 * Fixed bottom navigation shared by every patient screen. It lives outside the scrolling
 * area, so content never slides underneath it, and it respects the device safe area.
 */
export function PatientNav({ activeTab, onSelect, inert }: { activeTab: DemoTabId; onSelect: (tab: DemoTabId) => void; inert?: boolean }) {
  return (
    <nav
      aria-label="Mobile demo navigation"
      role="tablist"
      inert={inert}
      className="relative z-20 mx-3 mb-[max(0.5rem,env(safe-area-inset-bottom))] grid shrink-0 grid-cols-5 items-center rounded-[1.4rem] border border-pd-line bg-pd-surface/95 px-1 py-1 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.8)] backdrop-blur"
    >
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
            onClick={() => onSelect(tab.id)}
            className={`pd-focus flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[0.6875rem] leading-none transition-colors duration-200 ${active ? "font-semibold text-pd-accent-soft" : "font-medium text-pd-muted hover:text-pd-text"}`}
          >
            <Icon name={tabIcons[tab.id]} size={22} strokeWidth={active ? 2.1 : 1.7} className={active ? "fill-pd-accent/25" : undefined} />
            {tabLabels[tab.id]}
          </button>
        );
      })}
    </nav>
  );
}
