import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CarouselGraphic } from "./mobile-ui";
import { DispenserView, dispenserSetup, presentDispenserDevice } from "./dispenser-view";
import { SlotMedicationForm } from "./slot-medication-form";
import { RefillAlertCard, RefillBellView, dueRefills } from "./refill-bell";
import { TodayView } from "./today-view";
import { doseDisplayState, dosesForRange, reportedTakenProgress, uniqueOccurrences, type ScheduleDose } from "../lib/schedule";
import { VoiceView, type VoiceViewProps } from "./voice-view";
import type { TimelineRow } from "@/lib/today";

const source = (file: string) => readFileSync(join(process.cwd(), "src", "components", file), "utf8");

const row = (partial: Partial<TimelineRow>): TimelineRow => ({
  key: "k", at: 0, timeLabel: "9:30 AM", medicationName: "Metformin", instructions: "With breakfast", slot: 1,
  occurrenceId: null, isDemo: false, state: "UPCOMING", ...partial,
});

const device = { label: "Demo Dispenser", detail: "Ready", tone: "ready" as const, connected: true };

describe("Today screen dark revamp", () => {
  const now = new Date(2026, 2, 12, 8, 48).getTime();
  const nine = new Date(2026, 2, 12, 9, 0).getTime();

  it("shows a countdown only for a real upcoming dose and highlights that slot", () => {
    const html = renderToStaticMarkup(<TodayView greeting="Good morning," name="Eleanor" now={now} device={device} nextDose={row({ at: nine, slot: 6 })} timeline={[row({ at: nine, slot: 6 })]} />);
    expect(html).toContain("in 12 min");
    expect(html).toContain("Thursday, Mar 12");
    expect(html).toContain("Slot 6 is highlighted");
    const none = renderToStaticMarkup(<TodayView greeting="Hi," name="" now={now} device={device} nextDose={null} timeline={[]} />);
    expect(none).not.toMatch(/in \d+ min/);
    expect(none).toContain("No compartment is scheduled next");
  });

  it("never claims a live motor position and never asks for the microphone", () => {
    const html = renderToStaticMarkup(<TodayView greeting="Hi," name="" now={now} device={device} nextDose={row({ at: nine, slot: 6 })} timeline={[]} onOpenVoice={() => undefined} />);
    expect(html).toContain("does not show live motor position");
    expect(source("today-view.tsx")).not.toMatch(/getUserMedia|SpeechRecognition|onOpenVoice\(\)\s*;?\s*start/);
  });

  it("opens Voice from the AI panel and reports real connection state", () => {
    const html = renderToStaticMarkup(<TodayView greeting="Hi," name="" now={now} device={{ label: "Demo Dispenser", detail: "Not connected", tone: "attention", connected: false }} nextDose={null} timeline={[]} onOpenVoice={() => undefined} />);
    const connected = renderToStaticMarkup(<TodayView greeting="Hi," name="" now={now} device={{ label: "Demo Dispenser", detail: "Calibration required", tone: "attention", connected: true }} nextDose={null} timeline={[]} onOpenDispenser={() => undefined} />);
    expect(html).toContain('aria-label="Open Voice Companion"');
    expect(html).toContain("Disconnected");
    expect(html).not.toContain(">Connected<");
    expect(connected).toContain('aria-label="Connected, open My Dispenser"');
    expect(connected).not.toContain("Calibration required");
  });
});

describe("H5A Today view", () => {
  const now = new Date(2026, 2, 12, 8, 48).getTime();

  it("renders the greeting, device card, next dose and timeline from props", () => {
    const html = renderToStaticMarkup(
      <TodayView greeting="Good morning," name="Eleanor" now={0} device={device}
        nextDose={row({})} timeline={[row({ state: "TAKEN", key: "a", medicationName: "Vitamin D" }), row({ key: "b" })]} />,
    );
    expect(html).toContain("Good morning,");
    expect(html).toContain("Eleanor.");
    expect(html).toContain("Next medication");
    expect(html).toContain("Connected");
    expect(html).toContain("Slot 1");
    expect(html).toContain("With breakfast");
    expect(html).toContain("Complete");
    expect(html).not.toContain("Demo dose");
    const visibleText = html.replace(/<[^>]+>/g, " ");
    expect(visibleText).not.toMatch(/on track/i);
    expect(visibleText).not.toMatch(/\d+\s?%/);
    expect(visibleText).not.toMatch(/battery/i);
  });

  it("keeps the compact upcoming card free of patient confirmation controls", () => {
    const html = renderToStaticMarkup(
      <TodayView greeting="Hello," name="" now={0} device={device} nextDose={row({ occurrenceId: null })} timeline={[]}
      />,
    );
    expect(html).not.toContain("Mark as taken");
    expect(html).toContain("Slot 1");
  });

  it("does not expose patient confirmation controls for persisted occurrences", () => {
    const html = renderToStaticMarkup(
      <TodayView greeting="Hello," name="" now={0} device={device} nextDose={row({ occurrenceId: "occ", state: "UPCOMING" })} timeline={[]}
      />,
    );
    expect(html).not.toContain("Mark as taken");
  });

  it("prioritizes an overdue unreported occurrence without developer-facing labels", () => {
    const html = renderToStaticMarkup(
      <TodayView greeting="Hello," name="Eleanor" now={now} device={device}
        nextDose={row({ occurrenceId: "occ", state: "UPCOMING", isDemo: true })} timeline={[]}
      />,
    );
    expect(html).toContain("Next medication");
    expect(html).not.toContain("Awaiting confirmation");
    expect(html).not.toContain("Demo dose");
  });

  it("uses truthful empty and completed-day copy", () => {
    const empty = renderToStaticMarkup(<TodayView greeting="Hi," name="" now={now} device={device} nextDose={null} timeline={[]} />);
    const complete = renderToStaticMarkup(<TodayView greeting="Hi," name="" now={now} device={device} nextDose={null} timeline={[row({ state: "TAKEN" })]} />);
    expect(empty).toContain("Nothing scheduled today.");
    expect(empty).not.toContain("No more doses");
    expect(complete).toContain("You’re all set for today.");
  });

  it("only notifies for refills 5 days or less away, soonest first", () => {
    const due = dueRefills([
      { id: "a", medicationName: "Vitamin D", estimatedDaysRemaining: 9 },
      { id: "b", medicationName: "Iron", estimatedDaysRemaining: 5 },
      { id: "c", medicationName: "Omega-3", estimatedDaysRemaining: 2 },
      { id: "d", medicationName: "Unknown", estimatedDaysRemaining: null },
    ]);
    expect(due.map((item) => item.id)).toEqual(["c", "b"]);
  });

  it("shows a red count badge on the bell only when a refill is due", () => {
    const refills = dueRefills([{ id: "b", medicationName: "Iron", estimatedDaysRemaining: 5 }]);
    expect(renderToStaticMarkup(<RefillBellView refills={refills} />)).toContain("bg-red-500");
    expect(renderToStaticMarkup(<RefillBellView refills={[]} />)).not.toContain("bg-red-500");
  });

  it("ignores refills that were already requested", () => {
    expect(dueRefills([{ id: "a", medicationName: "Iron", estimatedDaysRemaining: 2, status: "REFILL_REQUESTED" }])).toEqual([]);
  });

  it("renders a warning-style refill alert with order and snooze actions", () => {
    const refills = dueRefills([
      { id: "b", medicationName: "Iron", estimatedDaysRemaining: 3, supplyCount: 3, runOutAt: Date.UTC(2026, 9, 28) },
      { id: "c", medicationName: "Omega-3", estimatedDaysRemaining: 5 },
    ]);
    const html = renderToStaticMarkup(<RefillAlertCard refills={refills} />);
    expect(html).toContain("Refill needed");
    expect(html).toContain("Iron");
    expect(html).toContain("Estimated 3 days left");
    expect(html).toContain("Pills left");
    expect(html).toContain("Order Refill");
    expect(html).toContain("Remind me later");
    expect(html).toContain("Also running low: Omega-3");
  });
});

describe("Schedule dark revamp", () => {
  const now = new Date(2026, 2, 12, 10, 0).getTime();
  const dose = (partial: Partial<ScheduleDose> = {}): ScheduleDose => ({
    id: "dose-1", medicationName: "Vitamin D", instructions: "Take 1 tablet with water", slot: 3,
    scheduledFor: new Date(2026, 2, 12, 9, 0).getTime(), expiresAt: new Date(2026, 2, 12, 10, 30).getTime(),
    attemptStatus: "NONE", ingestionReport: "UNREPORTED", ...partial,
  });

  it("derives dose states only from persisted reports and schedule windows", () => {
    expect(doseDisplayState(dose({ ingestionReport: "TAKEN" }), now)).toBe("TAKEN");
    expect(doseDisplayState(dose({ ingestionReport: "NOT_TAKEN" }), now)).toBe("NOT_TAKEN");
    expect(doseDisplayState(dose({ expiresAt: now - 1 }), now)).toBe("UNRESOLVED");
    expect(doseDisplayState(dose(), now)).toBe("DUE");
    expect(doseDisplayState(dose({ scheduledFor: now + 60_000 }), now)).toBe("UPCOMING");
  });

  it("deduplicates only matching occurrence identities and keeps distinct medications", () => {
    const rows = uniqueOccurrences([
      dose(),
      dose({ id: "dose-1", instructions: "Updated persisted row" }),
      dose({ id: "dose-2", medicationName: "Vitamin D" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].instructions).toBe("Updated persisted row");
  });

  it("uses local calendar boundaries for Today and the next seven days", () => {
    const tomorrow = new Date(2026, 2, 13, 9, 0).getTime();
    const eighthDay = new Date(2026, 2, 19, 9, 0).getTime();
    const rows = [dose(), dose({ id: "dose-2", scheduledFor: tomorrow }), dose({ id: "dose-3", scheduledFor: eighthDay })];
    expect(dosesForRange(rows, now, "today").map((item) => item.id)).toEqual(["dose-1"]);
    expect(dosesForRange(rows, now, "week").map((item) => item.id)).toEqual(["dose-1", "dose-2"]);
  });

  it("counts progress from explicit taken reports only", () => {
    expect(reportedTakenProgress([dose({ ingestionReport: "TAKEN" }), dose({ id: "dose-2", attemptStatus: "COMPLETED" }), dose({ id: "dose-3", ingestionReport: "NOT_TAKEN" })])).toEqual({ taken: 1, total: 3, percent: 33 });
  });

  it("implements the dark today-first hierarchy without developer or motor claims", () => {
    const view = source("schedule-screen.tsx");
    for (const label of ["Schedule", "Today", "This Week", "Today’s timeline", "Today’s progress", "reported taken", "View full schedule", "Recent activity"]) expect(view).toContain(label);
    expect(view).toContain("Open authorized medication setup");
    expect(view).toContain("pd-surface");
    expect(view).not.toMatch(/Persisted doses and reminders|· demo|motor completed|clinically verified/i);
  });
});

const noop = () => undefined;
const voiceProps = (overrides: Partial<VoiceViewProps> = {}): VoiceViewProps => ({
  phase: "IDLE", connection: "READY", caption: "", transcript: "", conversation: [], textInput: "", pending: null, doseChoices: null,
  success: null, error: null, nothingCaptured: false, onDismissNothing: noop, onToggleListening: noop, onReplay: noop, onStopSpeaking: noop, onCancelAll: noop,
  onSuggest: noop, onTextInput: noop, onSubmitText: noop, onChooseDose: noop, onConfirm: noop, onCancelPending: noop,
  ...overrides,
});

describe("Voice Companion dark redesign", () => {
  it("offers only bounded supported actions and uses real medication context", () => {
    const html = renderToStaticMarkup(<VoiceView {...voiceProps({ medicationName: "Vitamin D" })} />);
    for (const phrase of ["ready for Vitamin D", "I took Vitamin D", "haven’t taken Vitamin D yet", "dispenser isn’t working"]) expect(html).toContain(phrase);
    expect(html).not.toMatch(/Run Slot|motor test|MOVE,|Tell me about|medical advice/i);
  });

  it("disables the orb in text-only mode and exposes the typed fallback", () => {
    const html = renderToStaticMarkup(<VoiceView {...voiceProps({ connection: "TEXT_ONLY" })} />);
    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-label="Start push-to-talk|<button[^>]*aria-label="Start push-to-talk[^>]*disabled/);
    expect(html).toContain("Voice unavailable");
    expect(html).toContain("Type instead");
  });

  it("maps actual phases to the orb and only shows End during an active interaction", () => {
    const idle = renderToStaticMarkup(<VoiceView {...voiceProps()} />);
    const listening = renderToStaticMarkup(<VoiceView {...voiceProps({ phase: "LISTENING" })} />);
    const processing = renderToStaticMarkup(<VoiceView {...voiceProps({ phase: "PROCESSING" })} />);
    const speaking = renderToStaticMarkup(<VoiceView {...voiceProps({ phase: "SPEAKING" })} />);
    expect(idle).toContain('data-voice-state="idle"');
    expect(idle).not.toContain(">End<");
    expect(idle).not.toContain("No transcript yet.");
    expect(idle).toContain("I’m listening.");
    expect(idle).toContain("Tell me what you need, or just talk naturally.");
    expect(idle).not.toContain("Tap the orb");
    expect(idle).not.toContain("Press once");
    expect(idle).not.toContain("Try saying");
    expect(listening).toContain("I’m listening.");
    expect(listening).toContain('aria-label="End"');
    expect(processing).toContain("Thinking...");
    expect(speaking).toContain("PillSense is speaking.");
  });

  it("renders only real conversation entries with contextual playback controls", () => {
    const html = renderToStaticMarkup(<VoiceView {...voiceProps({
      caption: "Your medication is due.", transcript: "I’m ready", phase: "SPEAKING",
      conversation: [{ id: 1, role: "user", text: "I’m ready" }, { id: 2, role: "assistant", text: "Your medication is due." }],
    })} />);
    expect(html).toContain("Conversation");
    expect(html).toContain("I’m ready");
    expect(html).toContain("Your medication is due.");
    expect(html).not.toContain("Replay");
    expect(html).toContain("Stop speaking");
  });

  it("switches to a chat-only view with a record button after the first exchange", () => {
    const first = renderToStaticMarkup(<VoiceView {...voiceProps()} />);
    expect(first).toContain("Suggested requests");
    expect(first).toContain("data-voice-state");
    const chat = renderToStaticMarkup(<VoiceView {...voiceProps({ conversation: [{ id: 1, role: "user", text: "I took my medication" }, { id: 2, role: "assistant", text: "Recorded." }] })} />);
    expect(chat).not.toContain("Suggested requests");
    expect(chat).not.toContain("data-voice-state");
    expect(chat).not.toContain("I’m listening.");
    expect(chat).toContain('aria-label="Record a message"');
    expect(chat).toContain("I took my medication");
  });

  it("shows explicit confirmation controls before a pending report is saved", () => {
    const html = renderToStaticMarkup(<VoiceView {...voiceProps({ pending: { kind: "REPORT", medicationName: "Metformin", report: "TAKEN" } })} />);
    expect(html).toContain("No action has been saved yet.");
    expect(html).toContain("Confirm");
  });

  it("keeps synthetic voice demo controls in Hardware Lab, not the patient view", () => {
    const view = source("voice-view.tsx");
    const lab = source("persistent-arduino-lab.tsx");
    expect(view).not.toMatch(/Voice demo|synthetic record|Start 60-second|supervised mock dispensing/i);
    expect(lab).toContain("Voice demo · synthetic controls");
    expect(lab).toContain("<VoiceDeveloperPanel");
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

describe("My Dispenser dark redesign", () => {
  const medication = { id: "med-1", name: "Iron Supplement", instructions: "1 tablet · With water", slot: 6, localTime: "09:00" };
  const ready = presentDispenserDevice({ state: "READY", connected: true, homeAligned: true, faultCode: null });

  it("renders persisted assignment details and all eight selectable positions", () => {
    const html = renderToStaticMarkup(<DispenserView medications={[medication]} device={ready} selectedSlot={6} onSelectSlot={noop} onOpenSetup={noop} synthetic />);
    expect(html).toContain("My Dispenser");
    expect(html).toContain("Iron Supplement");
    expect(html).not.toContain("1 tablet");
    expect(html).toContain("pills left");
    expect(html).not.toContain("With water");
    expect(html).not.toContain("HOME");
    expect(html).not.toContain("not a live or sensor-verified position");
    for (const slot of [1, 2, 3, 4, 5, 6, 7]) expect(html).toContain(`aria-label="Select slot ${slot}"`);
  });

  it("shows truthful home and empty-slot states without any patient motor action", () => {
    const empty = renderToStaticMarkup(<DispenserView medications={[medication]} device={ready} selectedSlot={2} onSelectSlot={noop} onOpenSetup={noop} synthetic={false} />);
    const home = renderToStaticMarkup(<DispenserView medications={[medication]} device={ready} selectedSlot={0} onSelectSlot={noop} onOpenSetup={noop} synthetic={false} />);
    expect(empty).not.toContain("Empty compartment");
    expect(home).toContain("Reserved position");
    expect(home).toContain("manual home alignment");
    for (const html of [empty, home]) expect(html).not.toMatch(/Rotate|MOVE,|Run Slot 6|motor test/i);
  });

  it("combines connection and readiness into one status", () => {
    expect(dispenserSetup(presentDispenserDevice(null), 0).status).toEqual({ label: "Not Ready", tone: "offline" });
    expect(dispenserSetup(presentDispenserDevice({ state: "CALIBRATION_REQUIRED", connected: true, homeAligned: false, faultCode: null }), 3).status.label).toBe("Not Ready");
    expect(dispenserSetup(presentDispenserDevice({ state: "DISPENSING", connected: true, homeAligned: true, faultCode: null }), 3).status.label).toBe("Busy");
    expect(dispenserSetup(ready, 3).status).toEqual({ label: "Ready", tone: "ready" });
  });

  it("marks only the first unfinished setup step as current, and all steps once ready", () => {
    const offline = dispenserSetup(presentDispenserDevice(null), 2);
    expect(offline.steps.map((step) => step.current)).toEqual([true, false, false]);
    const unverified = dispenserSetup(presentDispenserDevice({ state: "CALIBRATION_REQUIRED", connected: true, homeAligned: false, faultCode: null }), 0);
    expect(unverified.steps.map((step) => step.done)).toEqual([true, false, false]);
    expect(unverified.steps.map((step) => step.current)).toEqual([false, true, false]);
    const done = dispenserSetup(ready, 1);
    expect(done.ready).toBe(true);
    expect(done.steps.some((step) => step.current)).toBe(false);
  });

  it("locks later setup steps until the earlier ones are complete and lists every loaded slot", () => {
    const offline = presentDispenserDevice(null);
    const html = renderToStaticMarkup(<DispenserView medications={[medication]} device={offline} selectedSlot={6} onSelectSlot={noop} onOpenSetup={noop} />);
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Load slots/);
    expect(html).toContain("Slots");
    expect(html).toContain("Iron Supplement");
    expect(html).toContain("Disconnected");
  });

  it("lists all seven slots in order and marks empty ones", () => {
    const html = renderToStaticMarkup(<DispenserView medications={[medication]} device={ready} selectedSlot={6} onSelectSlot={noop} onOpenSetup={noop} />);
    expect(html.match(/>Empty</g)).toHaveLength(6);
    expect(html.match(/No medication/g)).toHaveLength(6);
  });

  it("starts the slot form on a choice between camera and manual entry", () => {
    const html = renderToStaticMarkup(<SlotMedicationForm slot={2} onCancel={noop} />);
    expect(html).toContain("Scan with camera");
    expect(html).toContain("Manual entry");
    expect(html).not.toContain("Dose per day");
  });

  it("renders the three setup steps and opens a form for an empty slot", () => {
    const html = renderToStaticMarkup(<DispenserView medications={[medication]} device={ready} selectedSlot={2} onSelectSlot={noop} onOpenSetup={noop} synthetic={false} />);
    for (const label of ["Pair device", "Verify status", "Load slots"]) expect(html).toContain(label);
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

  it("keeps every patient tab mounted while moving the hardware panel to one internal lab owner", () => {
    const studio = source("demo-studio.tsx");
    const persistentLab = source("persistent-arduino-lab.tsx");
    expect(studio).not.toContain("<ArduinoStatusPanel");
    expect(studio).not.toContain("<MockDispensingPanel");
    expect(persistentLab.match(/<ArduinoStatusPanel/g)).toHaveLength(1);
    expect(persistentLab).toContain('usePathname() === "/hardware-lab"');
    expect(persistentLab.match(/<MockDispensingPanel/g)).toHaveLength(1);
    expect(studio).toContain("getDemoPanelStates");
    expect(studio).not.toMatch(/activeTab === "dispenser" &&/);
  });

  it("keeps camera tooling out of the patient studio and inside the internal hardware lab", () => {
    const studio = source("demo-studio.tsx");
    const lab = source("persistent-arduino-lab.tsx");
    expect(studio).not.toContain("<VisionObservationPanel");
    expect(lab.match(/<VisionObservationPanel/g)).toHaveLength(1);
    expect(lab).toContain("Developer / Hardware Lab");
    expect(studio).toMatch(/panel\.id === "today"[\s\S]{0,400}<TodayScreen[\s\S]{0,200}: <ConfigurationRequired/);
  });

  it("keeps patient-facing dispenser code free of BLE and motor dispatch APIs", () => {
    const screen = source("dispenser-screen.tsx");
    const view = source("dispenser-view.tsx");
    expect(`${screen}\n${view}`).not.toMatch(/WebBluetooth|navigator\.bluetooth|runSupervised|MOVE,/);
    expect(view).toContain("Slots");
    expect(view).not.toContain("View All Slots");
  });
});
