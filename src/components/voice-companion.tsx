"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { VoiceView, type VoiceMessage } from "./voice-view";
import { parseConfirmation, parseMedicationSessionIntent, parseVoiceIntent } from "@/lib/voice/intents";
import { canCommitVoiceAction, canProcessRecording, MICROPHONE_UNAVAILABLE_MESSAGE, TRANSCRIPTION_UNAVAILABLE_MESSAGE } from "@/lib/voice/session-safety";
import { runVoiceHardwareDemo, type VoiceHardwareStage } from "@/lib/voice/voice-hardware-demo";
import { useArduinoGateway } from "./arduino-gateway-provider";
import { VisionObservationPanel } from "./vision-observation-panel";
import { reminderPrompt } from "@/lib/voice/reminder-prompt";
import { replyAfterPlayback } from "@/lib/voice/playback-reply";
import { watchMicrophoneSilence, type MicrophoneSilenceWatch } from "@/lib/voice/microphone-silence";
import { selectFreshVoiceReminder } from "@/lib/voice/select-reminder";

type Phase = "IDLE" | "LISTENING" | "PROCESSING" | "SPEAKING";
type PendingAction =
  | { kind: "REPORT"; occurrenceId: Id<"doseOccurrences">; medicationName: string; report: "TAKEN" | "NOT_TAKEN" }
  | { kind: "DEVICE"; idempotencyKey: string; transcript: string };

const MAX_RECORDING_MS = 10_000;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Voice interaction failed. Touch controls remain available.";
}

type VoiceCompanionProps = { active?: boolean; demoMode?: boolean; startRequest?: { occurrenceId: string; token: number; requestedAt?: number } | null };

export function VoiceCompanion(props: VoiceCompanionProps = {}) {
  const auth = useConvexAuth();
  if (auth.isLoading || !auth.isAuthenticated) return null;
  return <AuthenticatedVoiceCompanion {...props} />;
}

function AuthenticatedVoiceCompanion({ active = true, demoMode = false, startRequest }: VoiceCompanionProps) {
  const [now, setNow] = useState(() => Date.now());
  const doses = useQuery(api.occurrences.listForPatient, { now });
  const reportIngestion = useMutation(api.dispensing.reportIngestion);
  const reportDeviceIssue = useMutation(api.deviceIssues.report);
  const claimGreeting = useMutation(api.medicationSessions.claimGreeting);
  const recordGreetingOutcome = useMutation(api.medicationSessions.recordGreetingOutcome);
  const respondToSession = useMutation(api.medicationSessions.respond);
  const setCameraConsent = useMutation(api.medicationSessions.setCameraConsent);
  const prepareHardwareDispatch = useMutation(api.medicationSessions.prepareHardwareDispatch);
  const markHardwareDispatched = useMutation(api.medicationSessions.markHardwareDispatched);
  const recordHardwareEvent = useMutation(api.medicationSessions.recordHardwareEvent);
  const gateway = useArduinoGateway();
  const [phase, setPhase] = useState<Phase>("IDLE");
  const [connection, setConnection] = useState<"CHECKING" | "READY" | "TEXT_ONLY">("CHECKING");
  const [caption, setCaption] = useState("");
  const [transcript, setTranscript] = useState("");
  const [conversation, setConversation] = useState<VoiceMessage[]>([]);
  const [textInput, setTextInput] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [selectionReport, setSelectionReport] = useState<"TAKEN" | "NOT_TAKEN" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [nothingCaptured, setNothingCaptured] = useState(false);
  const [hardwareStage, setHardwareStage] = useState<VoiceHardwareStage | null>(null);
  const hardwareRun = useRef(false);
  const messageIdRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const silenceWatchRef = useRef<MicrophoneSilenceWatch | null>(null);
  const cancelledRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const speechRequestRef = useRef<AbortController | null>(null);
  const playbackGenerationRef = useRef(0);
  const activeRef = useRef(active);
  const autoListenRef = useRef(false);
  const listenRef = useRef<(() => Promise<void>) | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const listeningStartRef = useRef(false);
  const lifecycleRef = useRef(0);
  const launchedRequestRef = useRef<number | null>(null);
  const scheduledStartRef = useRef(false);
  const [selectedReminder, setSelectedReminder] = useState<{ id: string; requestToken: number | null } | null>(null);
  const conversationScopeRef = useRef<string | null>(null);
  const conversationScopeInitialized = useRef(false);

  const addMessage = useCallback((role: VoiceMessage["role"], text: string) => {
    const cleaned = text.trim();
    if (!cleaned) return;
    const id = ++messageIdRef.current;
    setConversation((current) => [...current, { id, role, text: cleaned }].slice(-20));
  }, []);

  const stopSpeaking = useCallback(() => {
    playbackGenerationRef.current += 1;
    speechRequestRef.current?.abort();
    if (audioRef.current) audioRef.current.onended = null;
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    setPhase((current) => current === "SPEAKING" ? "IDLE" : current);
  }, []);

  const speak = useCallback(async (text: string, recordMessage = true, expectsReply = text.trim().endsWith("?")) => {
    const lifecycle = lifecycleRef.current;
    stopSpeaking();
    const generation = playbackGenerationRef.current;
    setCaption(text);
    if (recordMessage) addMessage("assistant", text);
    setError(null);
    if (connection === "TEXT_ONLY" || !activeRef.current || cancelledRef.current) return false;
    setPhase("PROCESSING");
    const controller = new AbortController();
    speechRequestRef.current = controller;
    try {
      const response = await fetch("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), signal: controller.signal });
      if (!response.ok) throw new Error("Cartesia speech is unavailable; the full message is still shown as text.");
      const blob = await response.blob();
      if (!activeRef.current || cancelledRef.current || lifecycle !== lifecycleRef.current || generation !== playbackGenerationRef.current) return false;
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      const isCurrent = () => generation === playbackGenerationRef.current && lifecycle === lifecycleRef.current && activeRef.current && !cancelledRef.current;
      audio.onended = replyAfterPlayback({
        expectsReply,
        isCurrent,
        onFinished: () => setPhase("IDLE"),
        onReply: () => { if (autoListenRef.current) void listenRef.current?.(); },
      });
      audio.onerror = () => {
        if (!isCurrent()) return;
        audio.onended = null;
        setPhase("IDLE");
        setError("Audio playback failed. The message remains available as text.");
      };
      setPhase("SPEAKING");
      await audio.play();
      return true;
    } catch (caught) {
      if (generation !== playbackGenerationRef.current || lifecycle !== lifecycleRef.current) return false;
      if (audioRef.current) audioRef.current.onended = null;
      if ((caught as Error).name !== "AbortError") setError(errorMessage(caught));
      setPhase("IDLE");
      return false;
    } finally { if (speechRequestRef.current === controller) speechRequestRef.current = null; }
  }, [addMessage, connection, stopSpeaking]);

  useEffect(() => {
    void fetch("/api/voice/status", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error();
      const data = await response.json() as { configured?: boolean };
      setConnection(data.configured ? "READY" : "TEXT_ONLY");
    }).catch(() => setConnection("TEXT_ONLY"));
    return () => {
      cancelledRef.current = true;
      activeRef.current = false;
      autoListenRef.current = false;
      lifecycleRef.current += 1;
      audioRef.current?.pause();
      if (recordingTimerRef.current) window.clearTimeout(recordingTimerRef.current);
      silenceWatchRef.current?.stop();
      requestRef.current?.abort();
      speechRequestRef.current?.abort();
      playbackGenerationRef.current += 1;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const reminderNow = Math.max(now, startRequest?.requestedAt ?? 0);
  const relevant = doses?.occurrences.filter((dose) => dose.ingestionReport === "UNREPORTED" && dose.scheduledFor <= reminderNow + 30 * 60_000) ?? [];
  const due = relevant.filter((dose) => reminderNow >= dose.eligibleFrom && reminderNow <= dose.expiresAt);
  const freshReminder = selectFreshVoiceReminder(doses?.occurrences ?? [], reminderNow, demoMode);
  const requestToken = startRequest?.token ?? null;
  const pinnedReminder = selectedReminder?.requestToken === requestToken ? relevant.find((dose) => dose.id === selectedReminder.id) : undefined;
  const scheduledDose = pinnedReminder ?? (startRequest ? due.find((dose) => dose.id === startRequest.occurrenceId) : demoMode ? freshReminder : due[0]);
  const interaction = useQuery(
    api.medicationSessions.getForOccurrence,
    scheduledDose ? { occurrenceId: scheduledDose.id } : "skip",
  );

  const startScheduledConversation = useCallback(async (greetOnResume = false, dose = scheduledDose) => {
    if (!dose || scheduledStartRef.current) return;
    scheduledStartRef.current = true;
    conversationScopeRef.current = dose.id;
    conversationScopeInitialized.current = true;
    setSelectedReminder({ id: dose.id, requestToken });
    cancelledRef.current = false;
    autoListenRef.current = true;
    const lifecycle = lifecycleRef.current;
    setError(null);
    try {
      const claimed = await claimGreeting({ occurrenceId: dose.id });
      if (!activeRef.current || cancelledRef.current || lifecycle !== lifecycleRef.current) return;
      const played = await speak(reminderPrompt(claimed.session, greetOnResume));
      if (claimed.shouldPlay) await recordGreetingOutcome({
        sessionId: claimed.session.id,
        outcome: played ? "PLAYED" : connection === "TEXT_ONLY" ? "PLAYBACK_BLOCKED" : "FAILED",
      });
    } catch (caught) {
      if (!activeRef.current || lifecycle !== lifecycleRef.current) return;
      setError(errorMessage(caught));
    } finally {
      scheduledStartRef.current = false;
    }
  }, [scheduledDose, requestToken, claimGreeting, speak, recordGreetingOutcome, connection]);

  // A new synthetic scenario must not inherit the old chat, pending report,
  // or local hardware banner. Never switch away from an operation still running.
  useEffect(() => {
    if (!doses || hardwareRun.current) return;
    let disposed = false;
    // Reconcile the external Convex update asynchronously, with cleanup so an
    // older query notification cannot wipe a conversation just opened by a click.
    queueMicrotask(() => {
      if (disposed || hardwareRun.current) return;
      const next = demoMode && freshReminder && pinnedReminder?.attemptStatus === "COMPLETED" && freshReminder.id !== pinnedReminder.id
        ? freshReminder : scheduledDose;
      const nextId = next?.id ?? null;
      if (conversationScopeInitialized.current && conversationScopeRef.current === nextId) return;
      conversationScopeInitialized.current = true;
      cancelRef.current?.();
      conversationScopeRef.current = nextId;
      if (next && next.id !== scheduledDose?.id) setSelectedReminder({ id: next.id, requestToken });
      setConversation([]);
      setCaption("");
      setTranscript("");
      setTextInput("");
      setError(null);
      setSuccess(null);
      setNothingCaptured(false);
      setHardwareStage(null);
    });
    return () => { disposed = true; };
  }, [doses, freshReminder, pinnedReminder, scheduledDose, requestToken, demoMode]);

  function startFromVisual() {
    if (hardwareRun.current || (pinnedReminder && ["AUTHORIZED", "DISPATCHED", "UNKNOWN"].includes(pinnedReminder.attemptStatus))) {
      setError("The existing hardware attempt needs reconciliation. No new movement will be started.");
      return;
    }
    if (!freshReminder) {
      setError(doses ? demoMode ? "No fresh Iron Pills demo reminder is ready. Prepare a new successful-dose demo scenario, then click the visual again. Existing movement results are retained." : "No fresh medication reminder is currently due." : "Loading the current reminder. Try again in a moment.");
      return;
    }
    cancelRef.current?.();
    setConversation([]);
    setCaption("");
    setTranscript("");
    setHardwareStage(null);
    void startScheduledConversation(true, freshReminder);
  }

  useEffect(() => {
    activeRef.current = active;
    if (!active) cancelRef.current?.();
  }, [active]);

  useEffect(() => {
    if (!active || !startRequest || connection === "CHECKING" || !scheduledDose || launchedRequestRef.current === startRequest.token) return;
    launchedRequestRef.current = startRequest.token;
    void startScheduledConversation();
  }, [active, startRequest, connection, scheduledDose, startScheduledConversation]);

  async function runArmedHardwareDemo(occurrenceId: Id<"doseOccurrences">) {
    if (hardwareRun.current) return;
    hardwareRun.current = true;
    console.info("[PillSense voice hardware] readiness_preflight", {
      reactConnected: gateway.connected,
      liveGattConnected: gateway.isConnected(),
      hasConnectionBinding: Boolean(gateway.connectionId),
    });
    setHardwareStage("PREPARING");
    setError(null);
    setSuccess(null);
    try {
      const outcome = await runVoiceHardwareDemo({
        occurrenceId,
        connectionId: gateway.connectionId,
        isConnected: gateway.isConnected,
        ensureConnected: gateway.ensureArmedConnection,
        prepare: (args) => prepareHardwareDispatch({
          occurrenceId: args.occurrenceId as Id<"doseOccurrences">,
          connectionId: args.connectionId,
        }),
        markDispatched: markHardwareDispatched,
        dispatch: gateway.dispatchSlot6,
        reconcile: gateway.getLastResult,
        record: recordHardwareEvent,
        onStage: setHardwareStage,
      });
      if (outcome.stage === "COMPLETED") {
        const text = "The motor sequence is complete. Please check that the carousel returned to Slot 0.";
        await speak(text);
      } else if (outcome.stage === "UNKNOWN") {
        await speak("The hardware outcome is uncertain. I will not send another movement command. An operator must reconcile the existing result.");
      } else if (outcome.alreadyPersisted) {
        await speak("This reminder already has a hardware attempt. I will not send another movement command.");
      }
    } catch (caught) {
      console.info("[PillSense voice hardware] readiness_blocked", {
        errorName: caught instanceof Error ? caught.name : "UnknownError",
        liveGattConnected: gateway.isConnected(),
        hasConnectionBinding: Boolean(gateway.connectionId),
      });
      setHardwareStage("BLOCKED");
      const text = errorMessage(caught);
      await speak(`${text} No movement command will be retried automatically.`);
      setError(text);
    } finally {
      hardwareRun.current = false;
    }
  }

  async function reconcilePersistedHardware() {
    const hardware = interaction?.hardware;
    if (!hardware?.operationId || hardware.status !== "DISPATCHED" || hardwareRun.current) return;
    hardwareRun.current = true;
    setError(null);
    setHardwareStage("MOVING");
    try {
      if (!gateway.isConnected()) await gateway.connect();
      const result = await gateway.getLastResult(hardware.operationId);
      const type = result.kind === "DONE" ? "MOTOR_COMPLETED"
        : result.kind === "STARTED" ? "MOTOR_STARTED"
          : result.kind === "REJECTED" ? "FAULT"
            : "UNKNOWN";
      await recordHardwareEvent({
        commandId: hardware.operationId,
        operationId: hardware.operationId,
        type,
        occurredAt: Date.now(),
      });
      if (result.kind === "DONE") {
        setHardwareStage("COMPLETED");
        await speak("The Arduino reported that the complete motor step sequence finished. No second movement command was sent. Please physically verify Slot 0.");
      } else if (result.kind === "STARTED") {
        setHardwareStage("MOVING");
        setSuccess("The existing operation is still in progress. Reconciliation sent no movement command.");
      } else {
        setHardwareStage("UNKNOWN");
        await speak("The existing hardware operation is uncertain. I will not send another movement command.");
      }
    } catch (caught) {
      setHardwareStage("UNKNOWN");
      setError(`${errorMessage(caught)} Only read-only reconciliation was attempted; MOVE was not resent.`);
    } finally {
      hardwareRun.current = false;
    }
  }

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

  async function interpret(text: string, source: "VOICE" | "TEXT" = "TEXT") {
    if (!activeRef.current) return;
    cancelledRef.current = false;
    const cleaned = text.trim();
    setTranscript(cleaned); setSuccess(null); setError(null);
    if (cleaned) addMessage("user", cleaned);
    if (!cleaned) { setNothingCaptured(true); return; }
    const parsedSessionIntent = interaction ? parseMedicationSessionIntent(cleaned) : null;
    const boundedIntent = interaction && (parsedSessionIntent === "REQUEST_MORE_INFORMATION" || parsedSessionIntent === "REQUEST_SUPPLY_INFORMATION" || !["DECLINED", "COMPLETED"].includes(interaction.state))
      ? parsedSessionIntent : null;
    if (boundedIntent && scheduledDose) {
      const result = await respondToSession({ occurrenceId: scheduledDose.id, intent: boundedIntent, source });
      if (result.hardwareDispatchEligible) {
        setCaption(result.response);
        addMessage("assistant", result.response);
        await runArmedHardwareDemo(scheduledDose.id);
      } else {
        await speak(result.response);
      }
      return;
    }
    if (pending) {
      const confirmation = parseConfirmation(cleaned);
      if (confirmation === "CONFIRM") { await confirmPending(); return; }
      if (confirmation === "CANCEL") { setPending(null); await speak("Cancelled. No information was changed."); return; }
      await speak("Please say confirm or cancel, or use the visible confirmation buttons.", true, true); return;
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
      await speak(`I understood: record ${dose.medicationName} as ${intent.report === "TAKEN" ? "taken" : "not taken"}. Say confirm, or use the Confirm button. Nothing changes until you confirm.`, true, true);
      return;
    }
    if (intent.type === "REPORT_DEVICE_PROBLEM") {
      setPending({ kind: "DEVICE", idempotencyKey: crypto.randomUUID(), transcript: cleaned });
      await speak("I understood that the dispenser has a problem. Say confirm, or use the Confirm button, to notify the caregiver. This will not retry the motor.", true, true);
      return;
    }
    await speak(intent.type === "AMBIGUOUS" ? "I am not certain what you meant. Please repeat one clear action or choose a visible option." : "That request is not supported by the Voice Companion. Choose one of the four visible actions.");
  }

  function endTracks() { silenceWatchRef.current?.stop(); silenceWatchRef.current = null; streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; }

  async function transcribe(blob: Blob) {
    if (cancelledRef.current) return;
    const lifecycle = lifecycleRef.current;
    setPhase("PROCESSING");
    const controller = new AbortController(); requestRef.current = controller;
    try {
      const form = new FormData(); form.append("audio", blob, "pillsense-voice.webm");
      const response = await fetch("/api/voice/transcribe", { method: "POST", body: form, signal: controller.signal });
      if (!response.ok) throw new Error(TRANSCRIPTION_UNAVAILABLE_MESSAGE);
      const data = await response.json() as { text?: unknown };
      if (!activeRef.current || cancelledRef.current || lifecycle !== lifecycleRef.current) return;
      if (typeof data.text !== "string") throw new Error("The transcription response was invalid.");
      setPhase("IDLE"); await interpret(data.text, "VOICE");
    } catch (caught) {
      if (!activeRef.current || cancelledRef.current || lifecycle !== lifecycleRef.current) return;
      if ((caught as Error).name !== "AbortError") setError(errorMessage(caught));
      setPhase("IDLE");
    }
    finally { if (requestRef.current === controller) requestRef.current = null; }
  }

  async function startListening() {
    if (!activeRef.current || listeningStartRef.current || recorderRef.current?.state === "recording") return;
    listeningStartRef.current = true;
    const lifecycle = lifecycleRef.current;
    autoListenRef.current = true;
    setError(null); setSuccess(null); setNothingCaptured(false); stopSpeaking(); cancelledRef.current = false;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { listeningStartRef.current = false; setError("Microphone recording is unavailable. Use the text and touch controls."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!activeRef.current || cancelledRef.current || lifecycle !== lifecycleRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : undefined);
      let silence: MicrophoneSilenceWatch | null = null;
      let stoppedForSilence = false;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        silence?.stop();
        if (silenceWatchRef.current === silence) silenceWatchRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        if (lifecycle !== lifecycleRef.current || !activeRef.current || cancelledRef.current) return;
        if (recordingTimerRef.current) window.clearTimeout(recordingTimerRef.current);
        if (streamRef.current === stream) streamRef.current = null;
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (stoppedForSilence && silence?.available && !silence.heardActivity()) { setPhase("IDLE"); setNothingCaptured(true); }
        else if (canProcessRecording(cancelledRef.current, blob.size)) void transcribe(blob);
        else { setPhase("IDLE"); setNothingCaptured(true); }
      };
      recorder.start(); setPhase("LISTENING");
      silence = watchMicrophoneSilence(stream, () => {
        if (recorder.state === "recording") { stoppedForSilence = true; recorder.stop(); }
      });
      silenceWatchRef.current = silence;
      recordingTimerRef.current = window.setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, MAX_RECORDING_MS);
    } catch (caught) {
      if (!activeRef.current || cancelledRef.current || lifecycle !== lifecycleRef.current) return;
      endTracks(); setPhase("IDLE");
      const name = caught instanceof DOMException ? caught.name : "";
      setError(name === "NotAllowedError" || name === "SecurityError"
        ? "The browser is blocking the microphone for this site. Click the lock icon in the address bar, set Microphone to Allow, then tap the orb again."
        : name === "NotFoundError" || name === "OverconstrainedError"
          ? "No microphone was found. Connect one, or use the text and touch controls."
          : MICROPHONE_UNAVAILABLE_MESSAGE);
    } finally { listeningStartRef.current = false; }
  }

  function stopListening() { if (recorderRef.current?.state === "recording") recorderRef.current.stop(); }
  function cancelAll() {
    autoListenRef.current = false;
    lifecycleRef.current += 1;
    cancelledRef.current = true;
    if (recordingTimerRef.current) window.clearTimeout(recordingTimerRef.current);
    requestRef.current?.abort();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    endTracks();
    stopSpeaking();
    setPending(null);
    setSelectionReport(null);
    setPhase("IDLE");
  }

  useEffect(() => {
    listenRef.current = startListening;
    cancelRef.current = cancelAll;
  });

  function chooseDose(id: string) {
    const dose = relevant.find((candidate) => candidate.id === id);
    if (!dose || !selectionReport) return;
    setPending({ kind: "REPORT", occurrenceId: dose.id, medicationName: dose.medicationName, report: selectionReport });
    setSelectionReport(null);
    void speak(`Confirm recording ${dose.medicationName} as ${selectionReport === "TAKEN" ? "taken" : "not taken"}.`, true, true);
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {startRequest && doses && !scheduledDose && !freshReminder && <p role="status" className="pd-card p-3 text-sm text-pd-muted">This reminder is no longer available. Open Home to choose your current reminder.</p>}
      {interaction?.state === "CAMERA_OBSERVATION_PENDING" && interaction.cameraConsent && (
        <section className="pd-card border-pd-accent/25 p-3 text-pd-text">
          <p className="mb-3 text-xs leading-5 text-pd-muted">Optional consented local observation is available now that the motor sequence has completed. A gesture does not prove ingestion.</p>
          <VisionObservationPanel />
        </section>
      )}
      <VoiceView
      phase={phase}
      connection={connection}
      caption={caption}
      transcript={transcript}
      conversation={conversation}
      medicationName={scheduledDose?.medicationName ?? relevant[0]?.medicationName}
      textInput={textInput}
      pending={pending}
      doseChoices={selectionReport && relevant.length > 1 ? relevant : null}
      success={success}
      error={error}
      nothingCaptured={nothingCaptured}
      onDismissNothing={() => setNothingCaptured(false)}
      onToggleListening={phase === "LISTENING" ? stopListening : startListening}
      onStartConversation={conversation.length === 0 ? demoMode ? startFromVisual : scheduledDose ? () => void startScheduledConversation(true) : undefined : undefined}
      onReplay={() => void speak(caption, false, Boolean(pending) || caption.trim().endsWith("?"))}
      onStopSpeaking={stopSpeaking}
      onCancelAll={cancelAll}
      onSuggest={(phrase) => void interpret(phrase)}
      onTextInput={setTextInput}
      onSubmitText={() => void interpret(textInput)}
      onChooseDose={chooseDose}
      onConfirm={() => void confirmPending()}
      onCancelPending={() => { setPending(null); void speak("Cancelled. No information was changed."); }}
      />
      {(hardwareStage || interaction?.hardware) && <details className="text-xs text-pd-muted" aria-label="Voice hardware status"><summary className="pd-focus min-h-11 cursor-pointer py-3">Dispenser status</summary><div className="space-y-2 pb-3" aria-live="polite">
        <p>{hardwareStage === "PREPARING" ? "Preparing dispenser"
          : hardwareStage === "MOVING" || interaction?.state === "MOVEMENT_IN_PROGRESS" ? "Physical movement in progress"
            : hardwareStage === "COMPLETED" || interaction?.hardware?.status === "COMPLETED" ? "Motor sequence completed"
              : hardwareStage === "UNKNOWN" || interaction?.hardware?.status === "UNKNOWN" ? "Hardware outcome uncertain" : "Hardware action blocked"}</p>
        <p>Motor status only. Medication taken is reported separately.</p>
        {interaction?.hardware?.status === "DISPATCHED" && <button type="button" onClick={() => void reconcilePersistedHardware()} className="pd-focus min-h-11 rounded-full border border-pd-line px-4 text-pd-text">{gateway.connected ? "Get existing result (read-only)" : "Reconnect and reconcile (read-only)"}</button>}
      </div></details>}
      {interaction && scheduledDose && <details className="text-xs text-pd-muted"><summary className="pd-focus min-h-11 cursor-pointer py-3">Reminder options</summary><div className="space-y-3 pb-3">
        {interaction.education.available && <button type="button" onClick={() => void interpret("side effects")} disabled={phase !== "IDLE"} className="pd-focus min-h-11 rounded-full border border-pd-line px-4 text-pd-text disabled:opacity-50">Hear side-effect information</button>}
        <label className="flex items-start gap-2 leading-5"><input type="checkbox" checked={interaction.cameraConsent} onChange={(event) => void setCameraConsent({ occurrenceId: scheduledDose.id, consent: event.target.checked })} className="mt-1 accent-violet-500" /><span>Allow optional local camera observation. A gesture does not prove ingestion.</span></label>
        <button type="button" onClick={() => { setPending({ kind: "REPORT", occurrenceId: scheduledDose.id, medicationName: scheduledDose.medicationName, report: "TAKEN" }); void speak(`Confirm recording ${scheduledDose.medicationName} as taken.`, true, true); }} className="pd-focus min-h-11 rounded-full border border-pd-line px-4 text-pd-text">Report medication taken</button>
      </div></details>}
    </div>
  );
}
