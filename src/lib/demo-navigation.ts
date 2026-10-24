export const demoTabs = [
  { id: "today", label: "Today" },
  { id: "dispenser", label: "Dispenser" },
  { id: "voice", label: "Voice" },
  { id: "schedule", label: "Schedule" },
  { id: "care", label: "Care" },
] as const;

export type DemoTabId = (typeof demoTabs)[number]["id"];

export type DemoPanelState = {
  id: DemoTabId;
  active: boolean;
  /** All panels stay rendered so browser-owned BLE state survives tab changes. */
  mounted: true;
  className: "block" | "hidden";
  ariaHidden: boolean;
};

export function getDemoPanelStates(activeTab: DemoTabId): DemoPanelState[] {
  return demoTabs.map(({ id }) => {
    const active = id === activeTab;
    return {
      id,
      active,
      mounted: true,
      className: active ? "block" : "hidden",
      ariaHidden: !active,
    };
  });
}

export function isDemoTabId(value: string): value is DemoTabId {
  return demoTabs.some(({ id }) => id === value);
}
