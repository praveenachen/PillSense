"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { VoiceView } from "./voice-view";
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

export function VoiceCompanion({ onOpenDispenser }: { onOpenDispenser?: () => void } = {}) {
  const auth = useConvexAuth();
  if (auth.isLoading || !auth.isAuthenticated) return null;
  return <AuthenticatedVoiceCompanion onOpenDispenser={onOpenDispenser} />;
}

function AuthenticatedVoiceCompanion({ onOpenDispenser }: { onOpenDispenser?: () => void }) {
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

  async function startDemo() {
    setError(null);
    try {
      const id = await createDemoDue({});
      setNow(Date.now());
      setDemoOccurrenceId(id);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function chooseDose(id: string) {
    const dose = relevant.find((candidate) => candidate.id === id);
    if (!dose || !selectionReport) return;
    setPending({ kind: "REPORT", occurrenceId: dose.id, medicationName: dose.medicationName, report: selectionReport });
    setSelectionReport(null);
    void speak(`Confirm recording ${dose.medicationName} as ${selectionReport === "TAKEN" ? "taken" : "not taken"}.`);
  }

  return (
    <VoiceView
      phase={phase}
      connection={connection}
      caption={caption}
      transcript={transcript}
      textInput={textInput}
      pending={pending}
      doseChoices={selectionReport && relevant.length > 1 ? relevant : null}
      success={success}
      error={error}
      onToggleListening={phase === "LISTENING" ? stopListening : startListening}
      onReplay={() => void speak(caption)}
      onStopSpeaking={stopSpeaking}
      onCancelAll={cancelAll}
      onSuggest={(phrase) => void interpret(phrase)}
      onTextInput={setTextInput}
      onSubmitText={() => void interpret(textInput)}
      onChooseDose={chooseDose}
      onConfirm={() => void confirmPending()}
      onCancelPending={() => { setPending(null); void speak("Cancelled. No information was changed."); }}
      onStartDemo={() => void startDemo()}
      onPlayReminder={() => { const dose = due[0]; void speak(dose ? `PillSense reminder. ${dose.medicationName} is due for the supervised demonstration in Slot ${dose.slot}.` : "No medication is currently due."); }}
      onOpenDispenser={onOpenDispenser}
    />
  );
}
