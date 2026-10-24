"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { parseConfirmation, parseVoiceIntent } from "@/lib/voice/intents";
import { canCommitVoiceAction, canProcessRecording, MICROPHONE_UNAVAILABLE_MESSAGE, TRANSCRIPTION_UNAVAILABLE_MESSAGE } from "@/lib/voice/session-safety";

type Phase = "IDLE" | "LISTENING" | "PROCESSING" | "SPEAKING";
type PendingAction =
  | { kind: "REPORT"; occurrenceId: Id<"doseOccurrences">; medicationName: string; report: "TAKEN" | "NOT_TAKEN" }
  | { kind: "DEVICE"; idempotencyKey: string; transcript: string };

const MAX_RECORDING_MS = 10_000;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Voice interaction failed. Touch controls remain available.";
}

export function VoiceCompanion() {
  const auth = useConvexAuth();
  if (auth.isLoading || !auth.isAuthenticated) return null;
  return <AuthenticatedVoiceCompanion />;
}

function AuthenticatedVoiceCompanion() {
  const [now, setNow] = useState(() => Date.now());
  const doses = useQuery(api.occurrences.listForPatient, { now });
  const reportIngestion = useMutation(api.dispensing.reportIngestion);
  const reportDeviceIssue = useMutation(api.deviceIssues.report);
  const createDemoDue = useMutation(api.occurrences.createDemoDue);
  const [phase, setPhase] = useState<Phase>("IDLE");
  const [connection, setConnection] = useState<"CHECKING" | "READY" | "TEXT_ONLY">("CHECKING");
  const [caption, setCaption] = useState("Select Play reminder or Push to Talk. Every spoken message appears here.");
  const [transcript, setTranscript] = useState("");
  const [textInput, setTextInput] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [selectionReport, setSelectionReport] = useState<"TAKEN" | "NOT_TAKEN" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [demoOccurrenceId, setDemoOccurrenceId] = useState<Id<"doseOccurrences"> | null>(null);
  const announcedDemoRef = useRef<Id<"doseOccurrences"> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);

  const stopSpeaking = useCallback(() => {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    setPhase((current) => current === "SPEAKING" ? "IDLE" : current);
  }, []);

  const speak = useCallback(async (text: string) => {
    stopSpeaking();
    setCaption(text);
    setError(null);
    if (connection === "TEXT_ONLY") return;
    setPhase("PROCESSING");
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), signal: controller.signal });
      if (!response.ok) throw new Error("Cartesia speech is unavailable; the full message is still shown as text.");
      const blob = await response.blob();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPhase("IDLE");
      audio.onerror = () => { setPhase("IDLE"); setError("Audio playback failed. The message remains available as text."); };
      setPhase("SPEAKING");
      await audio.play();
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") setError(errorMessage(caught));
      setPhase("IDLE");
    } finally { requestRef.current = null; }
  }, [connection, stopSpeaking]);

  useEffect(() => {
    void fetch("/api/voice/status", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error();
      const data = await response.json() as { configured?: boolean };
      setConnection(data.configured ? "READY" : "TEXT_ONLY");
    }).catch(() => setConnection("TEXT_ONLY"));
    return () => {
      requestRef.current?.abort();
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  const relevant = doses?.occurrences.filter((dose) => dose.ingestionReport === "UNREPORTED" && dose.scheduledFor <= now + 30 * 60_000) ?? [];
  const due = relevant.filter((dose) => now >= dose.eligibleFrom && now <= dose.expiresAt);

  useEffect(() => {
    if (!demoOccurrenceId || !doses) return;
    const demo = doses.occurrences.find((dose) => dose.id === demoOccurrenceId);
    if (!demo || announcedDemoRef.current === demoOccurrenceId) return;
    announcedDemoRef.current = demoOccurrenceId;
    void speak(`PillSense reminder. ${demo.medicationName} is ready for your supervised demonstration. Please say, I'm ready for my medication, or use a visible action below.`);
  }, [demoOccurrenceId, doses, speak]);

  async function confirmPending() {
    if (!canCommitVoiceAction(Boolean(pending), true) || !pending) return;
    setPhase("PROCESSING"); setError(null); setSuccess(null);
    try {
      if (pending.kind === "REPORT") {
        await reportIngestion({ occurrenceId: pending.occurrenceId, report: pending.report });
        const text = `${pending.medicationName} was recorded as ${pending.report === "TAKEN" ? "taken" : "not taken"}. No dispensing action was issued.`;
        setSuccess(text); setPending(null); setNow(Date.now()); await speak(text);
      } else {
        const result = await reportDeviceIssue({ idempotencyKey: pending.idempotencyKey, transcript: pending.transcript });
        const text = `Your device problem was shared with the caregiver. The observed device state was ${result.observedState.toLowerCase().replaceAll("_", " ")}. No motor retry was attempted.`;
        setSuccess(text); setPending(null); await speak(text);
      }
    } catch (caught) { setError(errorMessage(caught)); setPhase("IDLE"); }
  }

  async function interpret(text: string) {
    const cleaned = text.trim();
    setTranscript(cleaned); setSuccess(null); setError(null);
    if (!cleaned) { await speak("I did not hear a supported request. Please try again or use one of the visible choices."); return; }
    if (pending) {
      const confirmation = parseConfirmation(cleaned);
      if (confirmation === "CONFIRM") { await confirmPending(); return; }
      if (confirmation === "CANCEL") { setPending(null); await speak("Cancelled. No information was changed."); return; }
      await speak("Please say confirm or cancel, or use the visible confirmation buttons."); return;
    }
    const intent = parseVoiceIntent(cleaned);
    if (intent.type === "SCHEDULED_DOSE_ASSISTANCE") {
      if (due.length === 1) {
        const dose = due[0];
        await speak(`${dose.medicationName} is due for the supervised demonstration in Slot ${dose.slot}. Use the visible demo dispenser controls below. Voice will not operate the motor.`);
      } else if (due.length > 1) await speak("More than one medication is due. Please choose one from the visible dose list before continuing.");
      else if (relevant.some((dose) => dose.attemptStatus === "COMPLETED")) await speak("The available dose already has a completed motor attempt. That does not confirm ingestion. Use the visible Taken or Not Taken report controls if appropriate.");
      else await speak("There is no dose currently available for the supervised demonstration. No dispensing action was issued.");
      return;
    }
    if (intent.type === "REPORT_TAKEN_OR_NOT_TAKEN") {
      if (relevant.length > 1) { setSelectionReport(intent.report); await speak("More than one dose could match. Select the correct medication on screen, then confirm."); return; }
      if (relevant.length === 0) {
        const already = doses?.occurrences.find((dose) => dose.ingestionReport === intent.report);
        await speak(already ? `${already.medicationName} is already recorded as ${intent.report === "TAKEN" ? "taken" : "not taken"}. Nothing was changed.` : "There is no single relevant dose to update. Nothing was changed.");
        return;
      }
      const dose = relevant[0];
      setPending({ kind: "REPORT", occurrenceId: dose.id, medicationName: dose.medicationName, report: intent.report });
      await speak(`I understood: record ${dose.medicationName} as ${intent.report === "TAKEN" ? "taken" : "not taken"}. Say confirm, or use the Confirm button. Nothing changes until you confirm.`);
      return;
    }
    if (intent.type === "REPORT_DEVICE_PROBLEM") {
      setPending({ kind: "DEVICE", idempotencyKey: crypto.randomUUID(), transcript: cleaned });
      await speak("I understood that the dispenser has a problem. Say confirm, or use the Confirm button, to notify the caregiver. This will not retry the motor.");
      return;
    }
    await speak(intent.type === "AMBIGUOUS" ? "I am not certain what you meant. Please repeat one clear action or choose a visible option." : "That request is not supported by the Voice Companion. Choose one of the three visible actions.");
  }

  function endTracks() { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; }

  async function transcribe(blob: Blob) {
    if (cancelledRef.current) return;
    setPhase("PROCESSING");
    const controller = new AbortController(); requestRef.current = controller;
    try {
      const form = new FormData(); form.append("audio", blob, "pillsense-voice.webm");
      const response = await fetch("/api/voice/transcribe", { method: "POST", body: form, signal: controller.signal });
      if (!response.ok) throw new Error(TRANSCRIPTION_UNAVAILABLE_MESSAGE);
      const data = await response.json() as { text?: unknown };
      if (typeof data.text !== "string") throw new Error("The transcription response was invalid.");
      setPhase("IDLE"); await interpret(data.text);
    } catch (caught) { if ((caught as Error).name !== "AbortError") setError(errorMessage(caught)); setPhase("IDLE"); }
    finally { requestRef.current = null; }
  }

  async function startListening() {
    setError(null); setSuccess(null); stopSpeaking(); cancelledRef.current = false;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("Microphone recording is unavailable. Use the text and touch controls."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream; chunksRef.current = [];
      const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => { if (recordingTimerRef.current) window.clearTimeout(recordingTimerRef.current); endTracks(); const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }); if (canProcessRecording(cancelledRef.current, blob.size)) void transcribe(blob); };
      recorder.start(); setPhase("LISTENING");
      recordingTimerRef.current = window.setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, MAX_RECORDING_MS);
    } catch { endTracks(); setPhase("IDLE"); setError(MICROPHONE_UNAVAILABLE_MESSAGE); }
  }

  function stopListening() { if (recorderRef.current?.state === "recording") recorderRef.current.stop(); }
  function cancelAll() { cancelledRef.current = true; requestRef.current?.abort(); if (recorderRef.current?.state === "recording") recorderRef.current.stop(); endTracks(); stopSpeaking(); setPending(null); setSelectionReport(null); setPhase("IDLE"); setCaption("Cancelled. No information was changed."); }

  return <section aria-labelledby="voice-companion-title" className="rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-teal-50 p-6 shadow-sm md:p-8">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-bold uppercase tracking-[0.16em] text-sky-700">Voice Companion · Cartesia</p><h2 id="voice-companion-title" className="mt-2 text-3xl font-semibold tracking-tight">Speak, read, or tap</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Three supported actions only. Voice cannot dispense, change medication, recommend a catch-up dose, or operate Bluetooth hardware.</p></div><div aria-live="polite" className="rounded-2xl border border-sky-200 bg-white px-4 py-3 text-sm"><span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${connection === "READY" ? "bg-emerald-500" : connection === "CHECKING" ? "bg-amber-500" : "bg-slate-400"}`} /><strong>{phase}</strong><span className="block text-xs text-slate-500">{connection === "READY" ? "Cartesia ready" : connection === "CHECKING" ? "Checking voice service" : "Text-only fallback"}</span></div></div>
    <div className="mt-6 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
      <div className="rounded-3xl bg-slate-950 p-5 text-white"><button type="button" onClick={phase === "LISTENING" ? stopListening : startListening} disabled={phase === "PROCESSING" || phase === "SPEAKING" || connection !== "READY"} className="min-h-28 w-full rounded-2xl bg-sky-500 px-6 py-5 text-xl font-bold text-slate-950 outline-none ring-offset-4 transition hover:bg-sky-400 focus-visible:ring-4 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:bg-slate-600">{phase === "LISTENING" ? "Stop and transcribe" : "Push to Talk"}<span className="mt-1 block text-sm font-medium">Maximum 10 seconds</span></button><button type="button" onClick={cancelAll} className="mt-3 min-h-12 w-full rounded-xl border border-slate-600 px-4 font-semibold outline-none focus-visible:ring-4 focus-visible:ring-sky-300">Cancel / stop everything</button><p className="mt-3 text-xs leading-5 text-slate-300">The microphone starts only after you press the button. Raw recordings are sent for transcription and are not stored by PillSense.</p></div>
      <div className="space-y-4"><div className="rounded-2xl border border-sky-200 bg-white p-5"><p className="text-xs font-bold uppercase tracking-wide text-sky-700">Spoken text and captions</p><p aria-live="polite" className="mt-2 text-lg leading-7 text-slate-900">{caption}</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void speak(caption)} disabled={!caption || phase === "LISTENING"} className="min-h-11 rounded-full bg-sky-700 px-4 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-300">Replay</button><button type="button" onClick={stopSpeaking} className="min-h-11 rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-300">Stop speaking</button></div></div><div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Recognized speech</p><p className="mt-2 min-h-7 text-base text-slate-800">{transcript || "No transcript yet."}</p></div></div>
    </div>
    <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5"><label htmlFor="voice-text-fallback" className="text-sm font-semibold text-slate-800">Text alternative</label><div className="mt-2 flex flex-col gap-2 sm:flex-row"><input id="voice-text-fallback" value={textInput} onChange={(event) => setTextInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void interpret(textInput); }} placeholder="Type one supported phrase" className="input min-h-12 flex-1" /><button type="button" onClick={() => void interpret(textInput)} className="min-h-12 rounded-full bg-slate-900 px-5 font-bold text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-300">Interpret text</button></div><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void interpret("I'm ready for my medication")} className="min-h-11 rounded-full border px-4 text-sm font-semibold">I’m ready for my medication</button><button type="button" onClick={() => void interpret("I took my medication")} className="min-h-11 rounded-full border px-4 text-sm font-semibold">I took it</button><button type="button" onClick={() => void interpret("I haven't taken my medication yet")} className="min-h-11 rounded-full border px-4 text-sm font-semibold">I haven’t taken it</button><button type="button" onClick={() => void interpret("My dispenser isn't working")} className="min-h-11 rounded-full border px-4 text-sm font-semibold">Report device problem</button></div></div>
    {selectionReport && relevant.length > 1 && <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-5"><h3 className="font-semibold">Choose the correct dose</h3><div className="mt-3 flex flex-wrap gap-2">{relevant.map((dose) => <button type="button" key={dose.id} onClick={() => { setPending({ kind: "REPORT", occurrenceId: dose.id, medicationName: dose.medicationName, report: selectionReport }); setSelectionReport(null); void speak(`Confirm recording ${dose.medicationName} as ${selectionReport === "TAKEN" ? "taken" : "not taken"}.`); }} className="min-h-12 rounded-xl border border-amber-300 bg-white px-4 text-left font-semibold">{dose.medicationName}<span className="block text-xs font-normal text-slate-500">{new Date(dose.scheduledFor).toLocaleString()}</span></button>)}</div></div>}
    {pending && <div role="alertdialog" aria-labelledby="voice-confirm-title" className="mt-5 rounded-2xl border-2 border-amber-400 bg-amber-50 p-5"><h3 id="voice-confirm-title" className="text-xl font-semibold">Confirm before saving</h3><p className="mt-2 text-sm text-slate-700">{pending.kind === "REPORT" ? `Record ${pending.medicationName} as ${pending.report === "TAKEN" ? "TAKEN" : "NOT TAKEN"}.` : "Send this patient-reported device problem to the caregiver."}</p><p className="mt-1 text-xs font-semibold text-amber-900">No action has been saved yet.</p><div className="mt-4 flex gap-3"><button type="button" onClick={() => void confirmPending()} className="min-h-12 rounded-full bg-emerald-700 px-6 font-bold text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300">Confirm</button><button type="button" onClick={() => { setPending(null); void speak("Cancelled. No information was changed."); }} className="min-h-12 rounded-full border border-slate-300 bg-white px-6 font-semibold">Cancel</button></div></div>}
    <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50 p-5"><div className="mr-auto"><p className="font-bold text-violet-950">VOICE DEMO · SYNTHETIC RECORD</p><p className="mt-1 text-sm text-violet-800">Creates one due demo occurrence without changing the medication schedule.</p></div><button type="button" onClick={async () => { setError(null); try { const id = await createDemoDue({}); setNow(Date.now()); setDemoOccurrenceId(id); } catch (caught) { setError(errorMessage(caught)); } }} className="min-h-12 rounded-full bg-violet-700 px-5 font-bold text-white">Start 60-second voice demo</button><button type="button" onClick={() => { const dose = due[0]; void speak(dose ? `PillSense reminder. ${dose.medicationName} is due for the supervised demonstration in Slot ${dose.slot}.` : "No medication is currently due."); }} className="min-h-12 rounded-full border border-violet-300 bg-white px-5 font-semibold text-violet-900">Play scheduled reminder</button></div>
    <a href="#mock-dispensing" className="mt-4 inline-flex text-sm font-semibold text-sky-800 underline">View supervised mock dispensing controls</a>
    {success && <p aria-live="polite" className="mt-4 rounded-xl bg-emerald-100 p-3 text-sm text-emerald-900">{success}</p>}{error && <p role="alert" className="mt-4 rounded-xl bg-rose-100 p-3 text-sm text-rose-900">{error}</p>}
  </section>;
}
