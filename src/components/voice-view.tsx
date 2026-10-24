"use client";

import { Icon, type IconName } from "./mobile-ui";

export type VoicePhase = "IDLE" | "LISTENING" | "PROCESSING" | "SPEAKING";
export type VoiceConnection = "CHECKING" | "READY" | "TEXT_ONLY";

export type VoiceViewProps = {
  phase: VoicePhase;
  connection: VoiceConnection;
  caption: string;
  transcript: string;
  textInput: string;
  /** A report/device action waiting for explicit patient confirmation. */
  pending: { kind: "REPORT"; medicationName: string; report: "TAKEN" | "NOT_TAKEN" } | { kind: "DEVICE" } | null;
  /** Present when more than one dose could match a spoken report. */
  doseChoices: Array<{ id: string; medicationName: string; scheduledFor: number }> | null;
  success: string | null;
  error: string | null;
  onToggleListening: () => void;
  onReplay: () => void;
  onStopSpeaking: () => void;
  onCancelAll: () => void;
  onSuggest: (phrase: string) => void;
  onTextInput: (value: string) => void;
  onSubmitText: () => void;
  onChooseDose: (id: string) => void;
  onConfirm: () => void;
  onCancelPending: () => void;
  onStartDemo: () => void;
  onPlayReminder: () => void;
  onOpenDispenser?: () => void;
};

const suggestionTone = {
  blue: "bg-[#e3efff] text-[#1e4f8a]",
  teal: "bg-[#d9f5ef] text-[#0f766e]",
  amber: "bg-[#fef3d7] text-[#8a5a00]",
  coral: "bg-[#fde4e4] text-[#b42323]",
} as const;

const suggestions: Array<{ phrase: string; icon: IconName; tone: keyof typeof suggestionTone }> = [
  { phrase: "I'm ready for my medication", icon: "pill", tone: "blue" },
  { phrase: "I took my medication", icon: "check", tone: "teal" },
  { phrase: "I haven't taken my medication yet", icon: "clock", tone: "amber" },
  { phrase: "My dispenser isn't working", icon: "alert", tone: "coral" },
];

/** Decorative only: bar heights are fixed, never derived from audio. */
const barHeights = [28, 44, 62, 36, 78, 52, 90, 60, 100, 70, 86, 48, 74, 40, 64, 30, 56, 38, 24, 18];

export function VoiceView(props: VoiceViewProps) {
  const { phase, connection, caption, transcript, textInput, pending, doseChoices, success, error } = props;
  const live = phase === "LISTENING" || phase === "SPEAKING";
  const orbDisabled = phase === "PROCESSING" || phase === "SPEAKING" || connection !== "READY";
  const statusLine = phase === "LISTENING"
    ? "Listening…"
    : phase === "PROCESSING"
      ? "Working on it…"
      : phase === "SPEAKING"
        ? "Speaking…"
        : connection === "READY"
          ? "Tap to talk"
          : connection === "CHECKING"
            ? "Checking voice service…"
            : "Voice unavailable — use the text options below";

  return (
    <section aria-labelledby="voice-companion-title" className="mx-auto w-full max-w-[32rem] space-y-2.5">
      <h3 id="voice-companion-title" className="sr-only">Voice Companion · Cartesia</h3>
      <p aria-live="polite" className="flex items-center justify-center gap-2 text-xs font-medium text-[#475569]">
        <span aria-hidden="true" className={`size-2 rounded-full ${connection === "READY" ? "bg-[#14b8a6]" : connection === "CHECKING" ? "bg-[#f59e0b]" : "bg-[#94a3b8]"}`} />
        {connection === "READY" ? "Voice ready" : connection === "CHECKING" ? "Checking voice service" : "Text-only fallback"}
        {phase !== "IDLE" && <span className="text-[#1e4f8a]">· {phase.charAt(0) + phase.slice(1).toLowerCase()}</span>}
      </p>

      <div className="relative mx-auto grid aspect-square w-full max-w-[10.5rem] place-items-center">
        <span aria-hidden="true" className="absolute -inset-[22%] rounded-full bg-[radial-gradient(circle,rgba(20,184,166,0.2)_0%,rgba(20,184,166,0.06)_55%,transparent_70%)]" />
        <span aria-hidden="true" className={`absolute inset-0 rounded-full border border-[#9fe0d6] bg-[#d9f5ef]/40 ${live ? "ps-ring-live" : ""}`} />
        <span aria-hidden="true" className={`absolute inset-[14%] rounded-full border border-[#7fd6c9] bg-[#c9f0e8]/55 ${live ? "ps-ring-live [animation-delay:0.6s]" : ""}`} />
        <button
          type="button"
          onClick={props.onToggleListening}
          disabled={orbDisabled}
          aria-label={phase === "LISTENING" ? "Stop and transcribe" : "Push to talk, maximum 10 seconds"}
          className="ps-orb relative grid size-[5.5rem] place-items-center rounded-full text-white outline-none transition focus-visible:ring-4 focus-visible:ring-[#14b8a6]/50 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {phase === "LISTENING"
            ? <span aria-hidden="true" className="size-7 rounded-md bg-white" />
            : <Icon name="mic" size={38} strokeWidth={1.7} />}
        </button>
      </div>

      <div className="text-center">
        <p className="ps-display text-[1.1rem] font-semibold text-[#0f172a]">{statusLine}</p>
        <p className="mt-0.5 text-xs text-[#64748b]">Recording stops after 10 seconds · nothing is stored by PillSense</p>
        {live && (
          <div aria-hidden="true" className="mx-auto mt-2 flex h-8 max-w-[14rem] items-center justify-center gap-[3px]">
            {barHeights.map((height, index) => (
              <span key={index} className="ps-bar-live w-[3px] rounded-full bg-[#0f766e]" style={{ height: `${height}%`, animationDelay: `${(index % 7) * 0.09}s` }} />
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[#d6e6fa] bg-[#eaf3ff] p-3 text-center">
        <p className="text-xs font-semibold text-[#1e4f8a]">PillSense says</p>
        <p aria-live="polite" className="mt-0.5 text-[0.85rem] font-medium leading-5 text-[#0f172a]">{caption}</p>
        <p className="mt-2 text-xs font-semibold text-[#1e4f8a]">You said</p>
        <p className="mt-0.5 min-h-5 text-sm text-[#0f172a]">{transcript || <span className="text-[#64748b]">No transcript yet.</span>}</p>
        <div className="mt-2 flex justify-center gap-1.5">
          <button type="button" onClick={props.onReplay} disabled={!caption || phase === "LISTENING"} className="ps-cta min-h-11 rounded-full px-4 text-[0.8rem] font-semibold">Replay</button>
          <button type="button" onClick={props.onStopSpeaking} className="ps-focus min-h-11 rounded-full border border-[#b7cde6] bg-white px-3 text-[0.8rem] font-semibold text-[#334155]">Stop speaking</button>
          <button type="button" onClick={props.onCancelAll} className="ps-focus min-h-11 rounded-full border border-[#b7cde6] bg-white px-3 text-[0.8rem] font-semibold text-[#334155]">Cancel all</button>
        </div>
      </div>

      <section aria-labelledby="voice-suggestions-title">
        <h3 id="voice-suggestions-title" className="px-1 text-[0.9rem] font-semibold text-[#0f172a]">Say or tap one of these</h3>
        <p className="px-1 text-[0.7rem] leading-4 text-[#64748b]">Supported actions only. Voice cannot dispense, change medication, suggest a catch-up dose, or operate the Bluetooth motor.</p>
        <div className="mt-2 space-y-1.5">
          {suggestions.map(({ phrase, icon, tone }) => (
            <button key={phrase} type="button" onClick={() => props.onSuggest(phrase)} className="ps-card ps-focus flex min-h-12 w-full items-center gap-3 px-3 text-left">
              <span aria-hidden="true" className={`grid size-8 shrink-0 place-items-center rounded-full ${suggestionTone[tone]}`}><Icon name={icon} size={18} /></span>
              <span className="min-w-0 flex-1 text-sm font-medium text-[#0f172a]">{phrase.replace(/'/g, "’")}</span>
              <Icon name="chevron" size={16} className="shrink-0 text-[#94a3b8]" />
            </button>
          ))}
        </div>
      </section>

      <div className="ps-card ps-legacy-scope p-3.5">
        <label htmlFor="voice-text-fallback" className="text-sm font-semibold text-[#0f172a]">Text alternative</label>
        <div className="mt-2 flex gap-2">
          <input id="voice-text-fallback" value={textInput} onChange={(event) => props.onTextInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") props.onSubmitText(); }} placeholder="Type one supported phrase" className="input min-h-11 min-w-0 flex-1" />
          <button type="button" onClick={props.onSubmitText} className="ps-cta min-h-11 rounded-full px-5 text-sm font-semibold">Send</button>
        </div>
      </div>

      {doseChoices && (
        <div className="rounded-2xl border border-[#f6d58b] bg-[#fff8e6] p-4">
          <h3 className="font-semibold text-[#0f172a]">Choose the correct dose</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {doseChoices.map((dose) => (
              <button type="button" key={dose.id} onClick={() => props.onChooseDose(dose.id)} className="min-h-12 rounded-2xl border border-[#f0c25c] bg-white px-4 text-left text-sm font-semibold">
                {dose.medicationName}<span className="block text-xs font-normal text-[#64748b]">{new Date(dose.scheduledFor).toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {pending && (
        <div role="alertdialog" aria-labelledby="voice-confirm-title" className="rounded-2xl border-2 border-[#f0c25c] bg-[#fff8e6] p-4">
          <h3 id="voice-confirm-title" className="ps-display text-lg font-semibold text-[#0f172a]">Confirm before saving</h3>
          <p className="mt-2 text-sm text-[#334155]">{pending.kind === "REPORT" ? `Record ${pending.medicationName} as ${pending.report === "TAKEN" ? "TAKEN" : "NOT TAKEN"}.` : "Send this patient-reported device problem to the caregiver."}</p>
          <p className="mt-1 text-xs font-semibold text-[#8a5a00]">No action has been saved yet.</p>
          <div className="mt-4 flex gap-3">
            <button type="button" onClick={props.onConfirm} className="ps-cta min-h-12 rounded-full px-6 font-semibold">Confirm</button>
            <button type="button" onClick={props.onCancelPending} className="ps-focus min-h-12 rounded-full border border-[#cbd5e1] bg-white px-6 font-semibold text-[#334155]">Cancel</button>
          </div>
        </div>
      )}

      <details className="rounded-2xl border border-dashed border-[#9bc3e6] bg-white/60 p-4">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-[#1e4f8a]">Voice demo · synthetic record</summary>
        <p className="mt-1 text-sm text-[#475569]">Creates one due demo occurrence without changing the medication schedule.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={props.onStartDemo} className="ps-cta min-h-12 rounded-full px-5 text-sm font-semibold">Start 60-second voice demo</button>
          <button type="button" onClick={props.onPlayReminder} className="ps-focus min-h-12 rounded-full border border-[#b7cde6] bg-white px-5 text-sm font-semibold text-[#334155]">Play scheduled reminder</button>
        </div>
      </details>
      {props.onOpenDispenser
        ? <button type="button" onClick={props.onOpenDispenser} className="ps-focus inline-flex min-h-11 items-center text-sm font-semibold text-[#0f766e] underline">View supervised mock dispensing controls</button>
        : <a href="#mock-dispensing" className="inline-flex min-h-11 items-center text-sm font-semibold text-[#0f766e] underline">View supervised mock dispensing controls</a>}
      {success && <p aria-live="polite" className="rounded-2xl bg-[#d9f5ef] p-3 text-sm text-[#0b4f45]">{success}</p>}
      {error && <p role="alert" className="rounded-2xl bg-[#fde4e4] p-3 text-sm text-[#8f1d1d]">{error}</p>}
    </section>
  );
}
