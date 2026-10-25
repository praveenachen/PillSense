"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { LocalVisionClient } from "@/lib/vision/client";
import { createVisionSessionId, type VisionSnapshot } from "@/lib/vision/types";
import { VisionObservationView, type VisionViewState } from "./vision-observation-view";

const EVENT_POLL_MS = 750;
const PREVIEW_POLL_MS = 250;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Vision observation failed.";

type RecoveryState =
  | { kind: "OWNED"; sessionId: string; expiresAt: number; local: "SAME" | "MISSING" | "OTHER" | "UNAVAILABLE" }
  | { kind: "OTHER"; expiresAt: number };

export function VisionObservationPanel() {
  const { isAuthenticated } = useConvexAuth();
  if (!isAuthenticated) return null;
  return <AuthenticatedVisionObservationPanel />;
}

function AuthenticatedVisionObservationPanel() {
  const [state, setState] = useState<VisionViewState>({ status: "IDLE", bridge: "CHECKING" });
  const [cameraIndex, setCameraIndex] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<RecoveryState | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const clientRef = useRef(new LocalVisionClient());
  const sessionRef = useRef<string | null>(null);
  const lastEventRef = useRef<string | undefined>(undefined);
  const eventTimerRef = useRef<number | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const stoppedRef = useRef(true);
  const localStatusRef = useRef<VisionSnapshot["status"] | "IDLE">("IDLE");
  const startInFlightRef = useRef(false);
  const initializationCancelledRef = useRef(false);
  const beginSession = useMutation(api.vision.beginSession);
  const inspectSession = useMutation(api.vision.inspectSession);
  const recordEvent = useMutation(api.vision.recordEvent);
  const closeSession = useMutation(api.vision.closeSession);
  const persisted = useQuery(api.vision.latest);

  const replacePreview = useCallback((next: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = next;
    setPreviewUrl(next);
  }, []);

  const clearTimers = useCallback(() => {
    if (eventTimerRef.current !== null) window.clearTimeout(eventTimerRef.current);
    if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current);
    eventTimerRef.current = null;
    previewTimerRef.current = null;
  }, []);

  const persistSnapshot = useCallback(async (snapshot: VisionSnapshot) => {
    localStatusRef.current = snapshot.status;
    setState((current) => ({
      ...current,
      status: snapshot.status,
      bridge: "CONNECTED",
      error: undefined,
      initializationPhase: snapshot.initializationPhase,
    }));
    for (const event of snapshot.events) {
      await recordEvent({
        sessionId: event.sessionId, eventId: event.eventId, type: event.type,
        source: event.source, occurredAt: event.timestamp,
        ...(event.diagnostic ? { diagnostic: event.diagnostic } : {}),
      });
      lastEventRef.current = event.eventId;
      setState((current) => ({
        ...current,
        status: snapshot.status,
        bridge: "CONNECTED",
        lastType: event.type,
        lastTimestamp: event.timestamp,
        personVisible: event.type === "PERSON_VISIBLE" ? true : event.type === "PERSON_NOT_VISIBLE" ? false : current.personVisible,
        lastGestureAt: event.type === "HAND_AT_MOUTH_DETECTED" ? event.timestamp : current.lastGestureAt,
        error: event.type === "CAMERA_ERROR" ? event.diagnostic ?? "The local camera stopped with an error." : event.type === "CAMERA_STARTED" ? undefined : current.error,
      }));
    }
    if (snapshot.status === "STOPPED" || snapshot.status === "ERROR" || snapshot.status === "EXPIRED") {
      stoppedRef.current = true;
      clearTimers();
      replacePreview(null);
      await closeSession({ sessionId: snapshot.sessionId, status: snapshot.status, endedAt: Date.now() });
      setState((current) => ({ ...current, status: snapshot.status }));
    }
  }, [clearTimers, closeSession, recordEvent, replacePreview]);

  const pollEvents = useCallback(async () => {
    const sessionId = sessionRef.current;
    if (!sessionId || stoppedRef.current) return;
    try {
      const snapshot = await clientRef.current.events(sessionId, lastEventRef.current);
      await persistSnapshot(snapshot);
      if (!stoppedRef.current) eventTimerRef.current = window.setTimeout(() => void pollEvents(), EVENT_POLL_MS);
    } catch (error) {
      stoppedRef.current = true;
      clearTimers();
      replacePreview(null);
      setState((current) => ({ ...current, status: "ERROR", error: errorMessage(error) }));
      await closeSession({ sessionId, status: "ERROR", endedAt: Date.now() }).catch(() => undefined);
    }
  }, [clearTimers, closeSession, persistSnapshot, replacePreview]);

  const pollPreview = useCallback(async () => {
    const sessionId = sessionRef.current;
    if (!sessionId || stoppedRef.current) return;
    try {
      if (localStatusRef.current === "ACTIVE") {
        const blob = await clientRef.current.preview(sessionId);
        if (blob && !stoppedRef.current) replacePreview(URL.createObjectURL(blob));
      }
    } catch (error) {
      setState((current) => ({ ...current, error: errorMessage(error) }));
    } finally {
      if (!stoppedRef.current) previewTimerRef.current = window.setTimeout(() => void pollPreview(), PREVIEW_POLL_MS);
    }
  }, [replacePreview]);

  const activateSnapshot = useCallback(async (sessionId: string, snapshot: VisionSnapshot) => {
    sessionRef.current = sessionId;
    lastEventRef.current = undefined;
    stoppedRef.current = !["STARTING", "ACTIVE"].includes(snapshot.status);
    await persistSnapshot(snapshot);
    if (!stoppedRef.current) {
      void pollEvents();
      void pollPreview();
    }
  }, [persistSnapshot, pollEvents, pollPreview]);

  const refreshRecovery = useCallback(async () => {
    const inspected = await inspectSession({});
    if (inspected.kind === "NONE") {
      setRecovery(null);
      try {
        await clientRef.current.health();
        setState((current) => ({ ...current, bridge: "CONNECTED" }));
      } catch {
        setState((current) => ({ ...current, bridge: "UNAVAILABLE" }));
      }
      return inspected;
    }
    if (inspected.kind === "OTHER_OPERATOR_ACTIVE") {
      setRecovery({ kind: "OTHER", expiresAt: inspected.expiresAt });
      return inspected;
    }
    try {
      const health = await clientRef.current.health();
      setState((current) => ({ ...current, bridge: "CONNECTED" }));
      const local = !health.cameraOwnerActive ? "MISSING"
        : health.activeSessionId === inspected.sessionId ? "SAME" : "OTHER";
      if (local === "SAME") setCameraIndex(health.cameraIndex);
      setRecovery({ kind: "OWNED", sessionId: inspected.sessionId, expiresAt: inspected.expiresAt, local });
    } catch {
      setState((current) => ({ ...current, bridge: "UNAVAILABLE" }));
      setRecovery({ kind: "OWNED", sessionId: inspected.sessionId, expiresAt: inspected.expiresAt, local: "UNAVAILABLE" });
    }
    return inspected;
  }, [inspectSession]);

  async function start() {
    if (!stoppedRef.current || startInFlightRef.current) return;
    startInFlightRef.current = true;
    initializationCancelledRef.current = false;
    let registeredSession: string | null = null;
    try {
      const inspected = await inspectSession({});
      if (inspected.kind !== "NONE") {
        await refreshRecovery();
        setState((current) => ({ ...current, status: "IDLE", error: "A previous camera session needs attention before a new observation can start." }));
        return;
      }
      const sessionId = createVisionSessionId();
      replacePreview(null);
      setState((current) => ({ ...current, status: "STARTING", error: undefined, personVisible: undefined, lastGestureAt: undefined }));
      const registration = await beginSession({ sessionId, startedAt: Date.now() });
      if (initializationCancelledRef.current) {
        if (registration.kind === "CREATED") {
          await closeSession({ sessionId: registration.sessionId, status: "STOPPED", endedAt: Date.now() });
        }
        setState((current) => ({ ...current, status: "IDLE", error: "Camera initialization was cancelled." }));
        return;
      }
      if (registration.kind === "RECOVER_EXISTING") {
        await refreshRecovery();
        setState((current) => ({ ...current, status: "IDLE", error: "The existing camera session must be recovered or stopped first." }));
        return;
      }
      registeredSession = registration.sessionId;
      sessionRef.current = registration.sessionId;
      stoppedRef.current = false;
      const snapshot = await clientRef.current.start(registration.sessionId, cameraIndex);
      if (initializationCancelledRef.current) {
        await clientRef.current.stopIfPresent(registration.sessionId).catch(() => undefined);
        await closeSession({ sessionId: registration.sessionId, status: "STOPPED", endedAt: Date.now() });
        stoppedRef.current = true;
        sessionRef.current = null;
        setState((current) => ({ ...current, status: "IDLE", error: "Camera initialization was cancelled." }));
        return;
      }
      setRecovery(null);
      await activateSnapshot(registration.sessionId, snapshot);
    } catch (error) {
      stoppedRef.current = true;
      localStatusRef.current = "IDLE";
      if (registeredSession) {
        await clientRef.current.stopIfPresent(registeredSession).catch(() => undefined);
        await closeSession({
          sessionId: registeredSession,
          status: initializationCancelledRef.current ? "STOPPED" : "ERROR",
          endedAt: Date.now(),
        }).catch(() => undefined);
      }
      sessionRef.current = null;
      setState((current) => ({
        ...current,
        status: initializationCancelledRef.current ? "IDLE" : "ERROR",
        error: initializationCancelledRef.current ? "Camera initialization was cancelled." : errorMessage(error),
      }));
    } finally {
      startInFlightRef.current = false;
      initializationCancelledRef.current = false;
    }
  }

  async function recoverPrevious() {
    if (recovery?.kind !== "OWNED" || recoveryBusy) return;
    setRecoveryBusy(true);
    initializationCancelledRef.current = false;
    setState((current) => ({ ...current, status: "STARTING", error: undefined }));
    try {
      const health = await clientRef.current.health();
      if (!health.cameraOwnerActive) {
        setRecovery({ ...recovery, local: "MISSING" });
        throw new Error("The restarted local service no longer owns this session. Stop the previous session, then start a new observation.");
      }
      if (health.activeSessionId !== recovery.sessionId) {
        setRecovery({ ...recovery, local: "OTHER" });
        throw new Error("The local camera is owned by a different session. Stop this persisted session without interrupting that owner.");
      }
      const remainingSeconds = (recovery.expiresAt - Date.now()) / 1000;
      if (remainingSeconds <= 0) {
        await refreshRecovery();
        throw new Error("The previous camera session expired. Start a new observation.");
      }
      const snapshot = await clientRef.current.attach(recovery.sessionId);
      if (initializationCancelledRef.current) {
        throw new Error("Camera recovery was cancelled.");
      }
      setRecovery(null);
      await activateSnapshot(recovery.sessionId, snapshot);
    } catch (error) {
      stoppedRef.current = true;
      localStatusRef.current = "IDLE";
      setState((current) => ({
        ...current,
        status: "IDLE",
        error: initializationCancelledRef.current ? "Camera recovery was cancelled." : errorMessage(error),
      }));
      await refreshRecovery().catch(() => undefined);
    } finally {
      setRecoveryBusy(false);
      initializationCancelledRef.current = false;
    }
  }

  async function stopPrevious() {
    if (recovery?.kind !== "OWNED" || recoveryBusy) return;
    setRecoveryBusy(true);
    let localWarning: string | undefined;
    try {
      try {
        const local = await clientRef.current.stopIfPresent(recovery.sessionId);
        if (local.outcome === "STOPPED") {
          await persistSnapshot(local.snapshot);
        }
      } catch (error) {
        localWarning = `The persisted session was closed, but the local bridge could not confirm camera release: ${errorMessage(error)}`;
      }
      // Convex closure is independent of local recovery. A Python 404 means the
      // restarted process already has no matching local camera session.
      await closeSession({ sessionId: recovery.sessionId, status: "STOPPED", endedAt: Date.now() });
      clearTimers();
      replacePreview(null);
      stoppedRef.current = true;
      sessionRef.current = null;
      lastEventRef.current = undefined;
      setRecovery(null);
      setState((current) => ({
        ...current,
        status: "IDLE",
        error: localWarning,
        personVisible: undefined,
        lastGestureAt: undefined,
      }));
    } catch (error) {
      setState((current) => ({ ...current, status: "ERROR", error: errorMessage(error) }));
      await refreshRecovery().catch(() => undefined);
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function stop(cancelledInitialization = false) {
    const sessionId = sessionRef.current;
    if (!sessionId || stoppedRef.current) return;
    setState((current) => ({ ...current, status: "STOPPING" }));
    clearTimers();
    try {
      const snapshot = await clientRef.current.stop(sessionId);
      await persistSnapshot(snapshot);
      if (cancelledInitialization) {
        sessionRef.current = null;
        lastEventRef.current = undefined;
        setState((current) => ({ ...current, status: "IDLE", error: "Camera initialization was cancelled." }));
      }
    } catch (error) {
      stoppedRef.current = true;
      replacePreview(null);
      setState((current) => ({
        ...current,
        status: cancelledInitialization ? "IDLE" : "ERROR",
        error: cancelledInitialization ? "Camera initialization was cancelled." : errorMessage(error),
      }));
      await closeSession({
        sessionId,
        status: cancelledInitialization ? "STOPPED" : "ERROR",
        endedAt: Date.now(),
      }).catch(() => undefined);
      if (cancelledInitialization) sessionRef.current = null;
    }
  }

  function cancelInitialization() {
    initializationCancelledRef.current = true;
    clientRef.current.cancelInitialization();
    void stop(true);
  }

  useEffect(() => {
    const client = clientRef.current;
    void refreshRecovery().catch((error) => {
      setState((current) => ({ ...current, bridge: "UNAVAILABLE", error: errorMessage(error) }));
    });
    const release = () => {
      const sessionId = sessionRef.current;
      if (sessionId && !stoppedRef.current) client.releaseOnUnload(sessionId);
    };
    window.addEventListener("beforeunload", release);
    return () => {
      window.removeEventListener("beforeunload", release);
      release();
      clearTimers();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, [clearTimers, refreshRecovery]);

  return <div className="space-y-4">
    {recovery && <RecoveryNotice recovery={recovery} busy={recoveryBusy} onRecover={() => void recoverPrevious()} onStop={() => void stopPrevious()} />}
    <VisionObservationView
      state={state}
      previewUrl={previewUrl}
      cameraIndex={cameraIndex}
      persistedEvents={persisted?.events ?? []}
      startBlocked={recovery !== null || recoveryBusy}
      onCameraIndex={setCameraIndex}
      onStart={() => void start()}
      onStop={() => state.status === "STARTING" ? cancelInitialization() : void stop()}
    />
  </div>;
}

function RecoveryNotice({ recovery, busy, onRecover, onStop }: {
  recovery: RecoveryState;
  busy: boolean;
  onRecover: () => void;
  onStop: () => void;
}) {
  if (recovery.kind === "OTHER") {
    return <section role="status" className="rounded-[1.35rem] border border-amber-300/25 bg-amber-300/10 p-4">
      <h3 className="text-sm font-bold text-amber-100">Camera reserved by another authorized operator</h3>
      <p className="mt-1 text-sm leading-6 text-amber-100/75">This session cannot be recovered or stopped from your account. It expires at {new Date(recovery.expiresAt).toLocaleTimeString()}.</p>
    </section>;
  }
  const detail = recovery.local === "SAME"
    ? "The local Python service still owns this exact session. Recovering attaches this tab without opening a second camera stream."
    : recovery.local === "MISSING"
      ? "Convex has an active session, but the restarted local service no longer owns it. Stop the previous session, then start a fresh observation."
      : recovery.local === "OTHER"
        ? "The local service is owned by a different session. This orphan can be closed, but that camera owner will not be interrupted."
        : "The local Python service is unavailable. You can still close this persisted session; restart the bridge before starting a new observation.";
  return <section role="status" className="rounded-[1.35rem] border border-pd-accent/30 bg-pd-accent/10 p-4">
    <h3 className="text-sm font-bold text-pd-text">Previous camera session found</h3>
    <p className="mt-1 text-sm leading-6 text-pd-muted">{detail}</p>
    <p className="mt-1 text-xs text-pd-muted">Session deadline: {new Date(recovery.expiresAt).toLocaleTimeString()}</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <button type="button" onClick={onRecover} disabled={busy || recovery.local !== "SAME"} className="pd-focus min-h-11 rounded-xl bg-pd-accent px-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">Recover session</button>
      <button type="button" onClick={onStop} disabled={busy} className="pd-focus min-h-11 rounded-xl border border-pd-line bg-pd-surface px-3 text-sm font-bold text-pd-text disabled:cursor-not-allowed disabled:opacity-40">Stop previous session</button>
    </div>
  </section>;
}
