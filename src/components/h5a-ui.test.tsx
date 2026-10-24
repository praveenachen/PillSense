import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CarouselGraphic } from "./mobile-ui";
import { TodayView } from "./today-view";
import { VoiceView, type VoiceViewProps } from "./voice-view";
import type { TimelineRow } from "@/lib/today";

const source = (file: string) => readFileSync(join(process.cwd(), "src", "components", file), "utf8");

const row = (partial: Partial<TimelineRow>): TimelineRow => ({
  key: "k", at: 0, timeLabel: "9:30 AM", medicationName: "Metformin", instructions: "With breakfast", slot: 1,
  occurrenceId: null, isDemo: false, state: "NEXT", ...partial,
});

const device = { label: "Demo Dispenser", detail: "Ready", tone: "ready" as const };

describe("H5A Today view", () => {
  it("renders the greeting, device card, next dose and timeline from props", () => {
    const html = renderToStaticMarkup(
      <TodayView greeting="Good morning," name="Eleanor" summary="3 doses scheduled today." device={device}
        nextDose={row({})} timeline={[row({ state: "TAKEN", key: "a", medicationName: "Vitamin D" }), row({ key: "b" })]} />,
    );
    expect(html).toContain("Good morning,");
    expect(html).toContain("Eleanor.");
    expect(html).toContain("Next medication");
    expect(html).toContain("Demo Dispenser");
    expect(html).toContain("Slot 1");
    expect(html).toContain("With breakfast");
    expect(html).toContain("Reported taken");
    const visibleText = html.replace(/<[^>]+>/g, " ");
    expect(visibleText).not.toMatch(/on track/i);
    expect(visibleText).not.toMatch(/\d+\s?%/);
    expect(visibleText).not.toMatch(/battery/i);
  });

  it("disables Mark as taken, with an explanation, when no persisted dose record exists", () => {
    const html = renderToStaticMarkup(
      <TodayView greeting="Hello," name="" summary="" device={device} nextDose={row({ occurrenceId: null })} timeline={[]}
        markTaken={{ busy: false, error: null, onConfirm: () => undefined }} />,
    );
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*Mark as taken/);
    expect(html).toContain("A schedule time alone is not a record");
  });

  it("enables Mark as taken only when a persisted occurrence is available", () => {
    const html = renderToStaticMarkup(
      <TodayView greeting="Hello," name="" summary="" device={device} nextDose={row({ occurrenceId: "occ", state: "DUE" })} timeline={[]}
        markTaken={{ busy: false, error: null, onConfirm: () => undefined }} />,
    );
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>[\s\S]{0,200}Mark as taken/);
  });
});

const noop = () => undefined;
const voiceProps = (overrides: Partial<VoiceViewProps> = {}): VoiceViewProps => ({
  phase: "IDLE", connection: "READY", caption: "Hello", transcript: "", textInput: "", pending: null, doseChoices: null,
  success: null, error: null, onToggleListening: noop, onReplay: noop, onStopSpeaking: noop, onCancelAll: noop,
  onSuggest: noop, onTextInput: noop, onSubmitText: noop, onChooseDose: noop, onConfirm: noop, onCancelPending: noop,
  onStartDemo: noop, onPlayReminder: noop, ...overrides,
});

describe("H5A voice view", () => {
  it("offers only the supported intent phrases and never a motor command", () => {
    const html = renderToStaticMarkup(<VoiceView {...voiceProps()} />);
    for (const phrase of ["ready for my medication", "I took my medication", "haven’t taken my medication yet", "dispenser isn’t working"]) expect(html).toContain(phrase);
    expect(html).toContain("Voice cannot dispense");
    expect(html).not.toMatch(/Run Slot|motor test|Remind me in/i);
  });

  it("disables the orb in text-only mode and explains why", () => {
    const html = renderToStaticMarkup(<VoiceView {...voiceProps({ connection: "TEXT_ONLY" })} />);
    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-label="Push to talk|<button[^>]*aria-label="Push to talk[^>]*disabled/);
    expect(html).toContain("Voice unavailable");
  });

  it("only animates the waveform while listening or speaking, and never fakes a transcript", () => {
    const idle = renderToStaticMarkup(<VoiceView {...voiceProps()} />);
    const listening = renderToStaticMarkup(<VoiceView {...voiceProps({ phase: "LISTENING" })} />);
    expect(idle).not.toContain("ps-bar-live");
    expect(listening).toContain("ps-bar-live");
    expect(listening).toContain("No transcript yet.");
  });

  it("shows explicit confirmation controls before a pending report is saved", () => {
    const html = renderToStaticMarkup(<VoiceView {...voiceProps({ pending: { kind: "REPORT", medicationName: "Metformin", report: "TAKEN" } })} />);
    expect(html).toContain("No action has been saved yet.");
    expect(html).toContain("Confirm");
  });
});

describe("carousel graphic", () => {
  it("labels position 0 as home and draws positions 1 through 7", () => {
    const html = renderToStaticMarkup(<CarouselGraphic variant="map" selectedSlot={6} onSelectSlot={() => undefined} />);
    expect(html).toContain("HOME");
    for (const slot of [1, 2, 3, 4, 5, 6, 7]) expect(html).toContain(`Slot ${slot}`);
    expect(html).not.toContain("Slot 8");
    expect(html).toContain("does not show live device position");
  });

  it("placeholder is not interactive, so it cannot imply hardware control", () => {
    const html = renderToStaticMarkup(<CarouselGraphic variant="placeholder" testTargetSlot={6} />);
    expect(html).not.toContain('role="button"');
  });
});

describe("hardware safety boundaries survive the redesign", () => {
  const arduino = source("arduino-status-panel.tsx");

  it("keeps a single dispatch path, the one-dispatch lock and all three confirmations", () => {
    expect(arduino.match(/runSupervisedSlot6MotorTest\(/g)).toHaveLength(1);
    expect(arduino).toContain("dispatchLocked.current");
    expect(arduino).toContain("I physically confirmed the carousel is empty.");
    expect(arduino).toContain("I physically aligned the device to Slot 0 before startup.");
    expect(arduino).toContain("I confirmed hands, cables, and other objects are clear of moving parts.");
    expect(arduino).toContain("getLastMotorResult(operationId)");
    expect(arduino).toContain("Run Slot 6 Test (Supervised)");
  });

  it("creates exactly one Bluetooth transport and no other component creates one", () => {
    expect(arduino.match(/new WebBluetoothDispenserStatusTransport\(/g)).toHaveLength(1);
    for (const file of ["voice-companion.tsx", "voice-view.tsx", "today-screen.tsx", "today-view.tsx", "schedule-screen.tsx", "demo-care-panel.tsx", "setup-sheet.tsx", "demo-studio.tsx", "mobile-ui.tsx"]) {
      expect(source(file)).not.toMatch(/WebBluetooth|ble-protocol|runSupervised|navigator\.bluetooth/);
    }
  });

  it("voice, setup and schedule never import the hardware panel", () => {
    for (const file of ["voice-companion.tsx", "voice-view.tsx", "setup-sheet.tsx", "schedule-screen.tsx", "today-screen.tsx"]) {
      expect(source(file)).not.toContain("arduino-status-panel");
    }
  });

  it("keeps every demo tab mounted and mounts the hardware panel exactly once", () => {
    const studio = source("demo-studio.tsx");
    expect(studio.match(/<ArduinoStatusPanel/g)).toHaveLength(1);
    expect(studio).toContain("getDemoPanelStates");
    expect(studio).not.toMatch(/activeTab === "dispenser" &&/);
  });
});
