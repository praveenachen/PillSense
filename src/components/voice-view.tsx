"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./mobile-ui";
import { PhoneOverlay } from "./phone-overlay";
import { VoiceAura } from "./voice-aura";

export type VoicePhase = "IDLE" | "LISTENING" | "PROCESSING" | "SPEAKING";
export type VoiceConnection = "CHECKING" | "READY" | "TEXT_ONLY";
export type VoiceMessage = { id: number; role: "user" | "assistant"; text: string };

export type VoiceViewProps = {
  phase: VoicePhase;
  connection: VoiceConnection;
  caption: string;
  transcript: string;
  conversation: VoiceMessage[];
  medicationName?: string;
  textInput: string;
  pending: { kind: "REPORT"; medicationName: string; report: "TAKEN" | "NOT_TAKEN" } | { kind: "DEVICE" } | null;
  doseChoices: Array<{ id: string; medicationName: string; scheduledFor: number }> | null;
  success: string | null;
  error: string | null;
  /** True when a recording produced no speech; shows the "Nothing captured" popup. */
  nothingCaptured: boolean;
  onDismissNothing: () => void;
  onToggleListening: () => void;
  onStartConversation?: () => void;
  onReplay: () => void;
  onStopSpeaking: () => void;
  onCancelAll: () => void;
  onSuggest: (phrase: string) => void;
  onTextInput: (value: string) => void;
  onSubmitText: () => void;
  onChooseDose: (id: string) => void;
  onConfirm: () => void;
  onCancelPending: () => void;
};

type Suggestion = { label: string; phrase: string; icon: IconName };

function supportedSuggestions(medicationName?: string): Suggestion[] {
  const medication = medicationName ?? "my medication";
  return [
    { label: `I’m ready for ${medication}`, phrase: "I'm ready for my medication", icon: "pill" },
    { label: `I took ${medication}`, phrase: "I took my medication", icon: "check" },
    { label: `I haven’t taken ${medication} yet`, phrase: "I haven't taken my medication yet", icon: "clock" },
    { label: "My dispenser isn’t working", phrase: "My dispenser isn't working", icon: "alert" },
  ];
}

export function VoiceView(props: VoiceViewProps) {
  const { phase, connection, caption, transcript, conversation, medicationName, textInput, pending, doseChoices, success, error } = props;
  const [glFailed, setGlFailed] = useState(false);
  const threadEnd = useRef<HTMLDivElement>(null);
  const markUnsupported = useCallback(() => setGlFailed(true), []);
  const active = phase !== "IDLE";
  const orbDisabled = phase === "PROCESSING" || phase === "SPEAKING" || connection !== "READY";
  const status = phase === "PROCESSING"
    ? "Thinking..."
    : phase === "SPEAKING"
      ? "PillSense is speaking."
      : connection === "CHECKING"
        ? "Getting voice ready..."
        : connection === "TEXT_ONLY"
          ? "Voice unavailable"
          : "I’m listening.";
  const support = phase === "PROCESSING"
    ? "Processing your last request."
    : phase === "SPEAKING"
      ? "You can stop playback at any time."
      : connection === "TEXT_ONLY"
        ? "Cartesia voice isn’t configured on the server. Use Type instead from the menu."
        : connection === "CHECKING"
          ? ""
          : "Tell me what you need, or just talk naturally.";
  const visualState = error ? "error" : phase.toLowerCase();
  const latestAssistant = [...conversation].reverse().find((message) => message.role === "assistant")?.text ?? caption;
  const latestUser = [...conversation].reverse().find((message) => message.role === "user")?.text ?? transcript;
  const hasConversation = Boolean(latestAssistant || latestUser);
  /** After the first exchange the orb gives way to a plain chat view with a record button at the bottom. */
  const chatMode = conversation.length > 0;
  const messageCount = conversation.length;
  useEffect(() => {
    if (messageCount > 0) threadEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messageCount]);

  return (
    <section aria-labelledby="voice-companion-title" className={`mx-auto flex w-full max-w-[32rem] flex-1 flex-col space-y-4 ${chatMode ? "" : "pt-8"}`}>
      <header className="relative -mx-5 flex min-h-12 items-center justify-center px-5">
        <h1 id="voice-companion-title" className="text-[1.75rem] font-semibold tracking-tight text-pd-text">PillSense</h1>
        <details className="group absolute right-5 top-0 z-20">
          <summary aria-label="Voice settings and accessibility" className="pd-focus grid size-11 cursor-pointer list-none place-items-center rounded-full text-pd-muted transition-colors hover:bg-white/5 hover:text-pd-text [&::-webkit-details-marker]:hidden">
            <Icon name="more" size={21} />
          </summary>
          <div className="absolute right-0 top-12 w-[min(20rem,calc(100vw-3.5rem))] rounded-pd-card border border-pd-line bg-pd-surface-2 p-4 text-left shadow-[0_20px_60px_rgba(0,0,0,0.65)]">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-pd-text">Voice &amp; accessibility</p>
              <span className="inline-flex items-center gap-1.5 text-xs text-pd-muted"><span aria-hidden="true" className={`size-2 rounded-full ${connection === "READY" ? "bg-pd-ok" : connection === "CHECKING" ? "bg-pd-warn" : "bg-pd-muted"}`} />{connection === "READY" ? "Ready" : connection === "CHECKING" ? "Checking" : "Text only"}</span>
            </div>
            <label htmlFor="voice-text-fallback" className="mt-4 block text-xs font-semibold text-pd-muted">Type instead</label>
            <div className="mt-2 flex gap-2">
              <input id="voice-text-fallback" value={textInput} onChange={(event) => props.onTextInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") props.onSubmitText(); }} placeholder="Type a supported request" className="pd-focus min-h-11 min-w-0 flex-1 rounded-pd-chip border border-pd-line bg-pd-bg px-3 text-sm text-pd-text placeholder:text-pd-muted" />
              <button type="button" onClick={props.onSubmitText} disabled={!textInput.trim()} className="pd-press pd-focus min-h-11 rounded-full bg-pd-accent px-4 text-sm font-semibold text-white disabled:opacity-45">Send</button>
            </div>
            <p className="mt-2 text-[0.68rem] leading-4 text-pd-muted">Voice supports the same bounded medication and device-report actions shown below.</p>
          </div>
        </details>
      </header>

      {!chatMode && (
        <>
      <div className="relative -mx-5 grid h-[17rem] w-[calc(100%+2.5rem)] place-items-center overflow-hidden" data-voice-state={visualState}>
        {glFailed ? (
          <>
            <div aria-hidden="true" className={`pd-voice-ribbons pd-voice-ribbons--${visualState}`}>
              <svg viewBox="0 0 800 200" preserveAspectRatio="none" className="pd-voice-ribbon pd-voice-ribbon--a"><path d="M0 110 C100 40 200 170 300 100 S500 30 600 110 S760 150 800 90" /></svg>
              <svg viewBox="0 0 800 200" preserveAspectRatio="none" className="pd-voice-ribbon pd-voice-ribbon--b"><path d="M0 100 C120 160 220 30 340 110 S540 170 640 90 S760 60 800 120" /></svg>
            </div>
            <span aria-hidden="true" className={`pd-voice-aura pd-voice-aura--${visualState}`} />
          </>
        ) : (
          <VoiceAura state={visualState} onUnsupported={markUnsupported} />
        )}
        <button
          type="button"
          onClick={phase === "IDLE" && props.onStartConversation ? props.onStartConversation : props.onToggleListening}
          disabled={orbDisabled}
          aria-label={phase === "LISTENING" ? "Stop recording and transcribe" : props.onStartConversation ? "Start medication conversation" : "Start push-to-talk recording, maximum 10 seconds"}
          className={`${glFailed ? `pd-voice-orb pd-voice-orb--${visualState}` : "pd-voice-hit"} pd-focus relative size-40 rounded-full disabled:cursor-not-allowed`}
        >
          {glFailed && (
            <>
              <span aria-hidden="true" className="pd-voice-orb-body" />
              <span aria-hidden="true" className="pd-voice-orb-swirl" />
              <span aria-hidden="true" className="pd-voice-orb-shine" />
            </>
          )}
        </button>
      </div>

      <div className="-mt-5 text-center" aria-live="polite">
        <p className="text-2xl font-semibold tracking-tight text-pd-text">{status}</p>
        {support && <p className="mx-auto mt-2 max-w-[18rem] text-sm leading-5 text-pd-text/70">{support}</p>}
      </div>
        </>
      )}

      {phase === "LISTENING" && (
        <p role="status" className="mx-auto flex w-fit items-center gap-2 rounded-full border border-red-500/40 bg-red-500/10 px-4 py-1.5 text-sm font-semibold text-red-300">
          <span aria-hidden="true" className="size-2.5 animate-pulse rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.9)]" />
          Recording…
        </p>
      )}
      {success && <p aria-live="polite" className="rounded-pd-chip border border-pd-ok/25 bg-pd-ok/10 p-3 text-sm leading-5 text-pd-ok">{success}</p>}
      {error && <div role="alert" className="rounded-pd-chip border border-red-500/35 bg-red-500/10 p-3 text-sm text-red-300"><p>{error}</p>{connection === "READY" && phase === "IDLE" && <button type="button" onClick={props.onToggleListening} className="pd-focus mt-2 min-h-10 rounded-full border border-red-400/40 px-4 text-xs font-semibold">Try again</button>}</div>}

      {active && !chatMode && (
        <div className="flex flex-col items-center gap-1.5">
          <button type="button" onClick={props.onCancelAll} aria-label="End" className="pd-press pd-focus grid size-16 place-items-center rounded-full border border-red-500/60 bg-red-500/15 text-red-300 shadow-[0_0_28px_rgba(239,68,68,0.45)]">
            <Icon name="close" size={26} strokeWidth={2.2} />
          </button>
          <span className="text-xs font-medium text-pd-text/80">End</span>
        </div>
      )}

      {hasConversation && (
        <section aria-label="Conversation" className="space-y-3">
          <h2 className="sr-only">Conversation</h2>
          <div className="space-y-2.5">
            {(conversation.length > 0 ? conversation : [
              ...(latestUser ? [{ id: -1, role: "user" as const, text: latestUser }] : []),
              ...(latestAssistant ? [{ id: -2, role: "assistant" as const, text: latestAssistant }] : []),
            ]).map((message) => (
              <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] px-4 py-2.5 text-sm leading-5 ${message.role === "user" ? "rounded-[1.25rem] rounded-br-md bg-gradient-to-br from-pd-accent to-pd-accent-2 text-white shadow-[0_6px_16px_-8px_rgba(84,121,255,0.9)]" : "rounded-[1.25rem] rounded-bl-md border border-pd-line bg-pd-surface-2 text-pd-text"}`}>
                  <span className="sr-only">{message.role === "user" ? "You: " : "PillSense: "}</span>{message.text}
                </div>
              </div>
            ))}
            {chatMode && phase === "PROCESSING" && (
              <div className="flex justify-start"><div role="status" aria-label="PillSense is thinking" className="flex gap-1 rounded-[1.25rem] rounded-bl-md border border-pd-line bg-pd-surface-2 px-4 py-3">{[0, 1, 2].map((dot) => <span key={dot} className="size-1.5 animate-pulse rounded-full bg-pd-accent-soft" style={{ animationDelay: `${dot * 160}ms` }} />)}</div></div>
            )}
            <div ref={threadEnd} />
          </div>
          <div className="flex flex-wrap gap-2">
            {phase === "SPEAKING" && <button type="button" onClick={props.onStopSpeaking} className="pd-focus min-h-10 rounded-full border border-pd-line px-4 text-xs font-semibold text-pd-text">Stop speaking</button>}
          </div>
        </section>
      )}

      {!chatMode && (
      <section aria-label="Suggested requests" className="space-y-2.5">
        {supportedSuggestions(medicationName).map(({ label, phrase, icon }) => (
          <button key={phrase} type="button" onClick={() => props.onSuggest(phrase)} disabled={active} className="pd-press pd-focus flex min-h-[3.25rem] w-full items-center gap-3 rounded-full border border-pd-line bg-pd-surface/70 px-4 text-left backdrop-blur disabled:opacity-45">
            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center text-pd-accent-soft"><Icon name={icon} size={18} /></span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-pd-text">{label}</span>
          </button>
        ))}
      </section>
      )}

      {props.nothingCaptured && (
        <PhoneOverlay label="Nothing captured" onClose={props.onDismissNothing}>
          <div className="pd-card-hero relative space-y-4 p-5 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.9)]">
            <button type="button" onClick={props.onDismissNothing} aria-label="Close" className="pd-focus absolute right-2 top-2 grid size-11 place-items-center rounded-full text-pd-muted"><Icon name="close" size={18} /></button>
            <div className="flex items-center gap-3 pr-8">
              <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-2xl border border-red-500/40 bg-red-500/15 text-red-400 shadow-[0_0_24px_rgba(239,68,68,0.45)]"><Icon name="alert" size={28} strokeWidth={2} /></span>
              <div className="min-w-0">
                <h2 className="text-xl font-semibold leading-tight text-pd-text">Nothing captured</h2>
                <p className="mt-0.5 text-sm text-pd-muted">I didn’t hear anything.</p>
              </div>
            </div>
            <ul className="space-y-2 rounded-pd-chip border border-pd-line bg-black/20 p-3 text-sm text-pd-text/85">
              <li className="flex gap-2"><span aria-hidden="true" className="text-pd-accent-soft">•</span>Check that your microphone is allowed and not muted.</li>
              <li className="flex gap-2"><span aria-hidden="true" className="text-pd-accent-soft">•</span>Speak clearly, a little closer to the device.</li>
              <li className="flex gap-2"><span aria-hidden="true" className="text-pd-accent-soft">•</span>Try again somewhere quieter.</li>
              <li className="flex gap-2"><span aria-hidden="true" className="text-pd-accent-soft">•</span>Or type your request from the menu, or tap a suggestion.</li>
            </ul>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={props.onDismissNothing} className="pd-press pd-focus flex min-h-12 items-center justify-center rounded-full border border-pd-line bg-white/5 px-2 text-sm font-semibold text-pd-muted">Dismiss</button>
              <button type="button" onClick={() => { props.onDismissNothing(); props.onToggleListening(); }} disabled={orbDisabled} className="pd-press pd-focus flex min-h-12 items-center justify-center rounded-full bg-gradient-to-br from-pd-accent to-pd-accent-2 px-2 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(84,121,255,0.9)] disabled:opacity-60">Try again</button>
            </div>
          </div>
        </PhoneOverlay>
      )}

      {doseChoices && (
        <section className="pd-card max-w-[85%] border-pd-warn/35 p-3">
          <h2 className="text-sm font-semibold text-pd-text">Choose the correct medication</h2>
          <div className="mt-2 space-y-1.5">{doseChoices.map((dose) => <button type="button" key={dose.id} onClick={() => props.onChooseDose(dose.id)} className="pd-focus flex min-h-10 w-full items-center justify-between gap-3 rounded-pd-chip border border-pd-line px-3 text-left text-xs font-semibold text-pd-text"><span>{dose.medicationName}</span><span className="font-normal text-pd-muted">{new Date(dose.scheduledFor).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></button>)}</div>
        </section>
      )}

      {pending && (
        <section role="alertdialog" aria-labelledby="voice-confirm-title" className="pd-card-hero max-w-[85%] border-pd-warn/40 p-3">
          <h2 id="voice-confirm-title" className="text-sm font-semibold text-pd-text">Confirm before saving</h2>
          <p className="mt-1 text-xs leading-4 text-pd-muted">{pending.kind === "REPORT" ? `Record ${pending.medicationName} as ${pending.report === "TAKEN" ? "taken" : "not taken"}.` : "Share this patient-reported device problem with the caregiver."}</p>
          <p className="mt-1 text-[0.68rem] font-semibold text-pd-warn">No action has been saved yet.</p>
          <div className="mt-2.5 flex gap-2">
            <button type="button" onClick={props.onConfirm} className="pd-press pd-focus min-h-10 flex-1 rounded-full bg-pd-accent text-xs font-semibold text-white">Confirm</button>
            <button type="button" onClick={props.onCancelPending} className="pd-focus min-h-10 flex-1 rounded-full border border-pd-line text-xs font-semibold text-pd-muted">Cancel</button>
          </div>
        </section>
      )}

      {chatMode && <div aria-hidden="true" className="min-h-4 flex-1" />}

      {chatMode && (
        <div className="sticky bottom-0 -mx-5 -mb-6 flex items-center justify-center gap-5 px-5 pb-1 pt-3">
          <button
            type="button"
            onClick={props.onToggleListening}
            disabled={orbDisabled}
            aria-label={phase === "LISTENING" ? "Stop recording and transcribe" : "Record a message"}
            className={`pd-press pd-focus grid size-16 place-items-center rounded-full border text-white disabled:opacity-50 ${phase === "LISTENING" ? "animate-pulse border-red-400/70 bg-red-500 shadow-[0_0_30px_rgba(239,68,68,0.7)]" : "border-pd-accent-soft/60 bg-gradient-to-br from-pd-accent to-pd-accent-2 shadow-[0_0_28px_rgba(119,116,255,0.7)]"}`}
          >
            {phase === "LISTENING" ? <span aria-hidden="true" className="size-5 rounded-md bg-white" /> : <Icon name="wave" size={28} strokeWidth={1.8} />}
          </button>
          {active && (
            <button type="button" onClick={props.onCancelAll} aria-label="End" className="pd-press pd-focus grid size-12 place-items-center rounded-full border border-red-500/60 bg-red-500/15 text-red-300">
              <Icon name="close" size={22} strokeWidth={2.2} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
