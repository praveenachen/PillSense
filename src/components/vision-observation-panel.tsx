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

export function VisionObservationPanel() {
  const { isAuthenticated } = useConvexAuth();
  if (!isAuthenticated) return null;
  return <AuthenticatedVisionObservationPanel />;
}

function AuthenticatedVisionObservationPanel() {
  const [state, setState] = useState<VisionViewState>({ status: "IDLE", bridge: "CHECKING" });
  const [cameraIndex, setCameraIndex] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const clientRef = useRef(new LocalVisionClient());
  const sessionRef = useRef<string | null>(null);
  const lastEventRef = useRef<string | undefined>(undefined);
  const eventTimerRef = useRef<number | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const stoppedRef = useRef(true);
  const beginSession = useMutation(api.vision.beginSession);
  const recordEvent = useMutation(api.vision.recordEvent);
  const closeSession = useMutation(api.vision.closeSession);
  const persisted = useQuery(api.vision.latest);

  const replacePreview = useCallback((next: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = next;
    setPreviewUrl(next);
  }, []);

  const persistSnapshot = useCallback(async (snapshot: VisionSnapshot) => {
    setState((current) => ({ ...current, status: snapshot.status, bridge: "CONNECTED", error: undefined }));
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
    if (snapshot.status !== "ACTIVE") {
      stoppedRef.current = true;
      replacePreview(null);
      await closeSession({ sessionId: snapshot.sessionId, status: snapshot.status, endedAt: Date.now() });
      setState((current) => ({ ...current, status: snapshot.status }));
    }
  }, [closeSession, recordEvent, replacePreview]);

  const pollEvents = useCallback(async () => {
    const sessionId = sessionRef.current;
    if (!sessionId || stoppedRef.current) return;
    try {
      const snapshot = await clientRef.current.events(sessionId, lastEventRef.current);
      await persistSnapshot(snapshot);
      if (!stoppedRef.current) eventTimerRef.current = window.setTimeout(() => void pollEvents(), EVENT_POLL_MS);
    } catch (error) {
      stoppedRef.current = true;
      replacePreview(null);
      setState((current) => ({ ...current, status: "ERROR", error: errorMessage(error) }));
      await closeSession({ sessionId, status: "ERROR", endedAt: Date.now() }).catch(() => undefined);
    }
  }, [closeSession, persistSnapshot, replacePreview]);

  const pollPreview = useCallback(async () => {
    const sessionId = sessionRef.current;
    if (!sessionId || stoppedRef.current) return;
    try {
      const blob = await clientRef.current.preview(sessionId);
      if (blob && !stoppedRef.current) replacePreview(URL.createObjectURL(blob));
    } catch (error) {
      setState((current) => ({ ...current, error: errorMessage(error) }));
    } finally {
      if (!stoppedRef.current) previewTimerRef.current = window.setTimeout(() => void pollPreview(), PREVIEW_POLL_MS);
    }
  }, [replacePreview]);

  async function start() {
    if (!stoppedRef.current) return;
    const sessionId = createVisionSessionId();
    sessionRef.current = sessionId;
    lastEventRef.current = undefined;
    stoppedRef.current = false;
    replacePreview(null);
    setState((current) => ({ ...current, status: "STARTING", error: undefined, personVisible: undefined, lastGestureAt: undefined }));
    try {
      await beginSession({ sessionId, startedAt: Date.now() });
      const snapshot = await clientRef.current.start(sessionId, cameraIndex);
      await persistSnapshot(snapshot);
      if (!stoppedRef.current) { void pollEvents(); void pollPreview(); }
    } catch (error) {
      stoppedRef.current = true;
      setState((current) => ({ ...current, status: "ERROR", bridge: "UNAVAILABLE", error: errorMessage(error) }));
      await closeSession({ sessionId, status: "ERROR", endedAt: Date.now() }).catch(() => undefined);
    }
  }

  async function stop() {
    const sessionId = sessionRef.current;
    if (!sessionId || stoppedRef.current) return;
    setState((current) => ({ ...current, status: "STOPPING" }));
    if (eventTimerRef.current !== null) window.clearTimeout(eventTimerRef.current);
    if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current);
    try {
      const snapshot = await clientRef.current.stop(sessionId);
      await persistSnapshot(snapshot);
    } catch (error) {
      stoppedRef.current = true;
      replacePreview(null);
      setState((current) => ({ ...current, status: "ERROR", error: errorMessage(error) }));
      await closeSession({ sessionId, status: "ERROR", endedAt: Date.now() }).catch(() => undefined);
    }
  }

  useEffect(() => {
    const client = clientRef.current;
    void client.health().then(() => setState((current) => ({ ...current, bridge: "CONNECTED" })), () => setState((current) => ({ ...current, bridge: "UNAVAILABLE" })));
    const release = () => { const sessionId = sessionRef.current; if (sessionId && !stoppedRef.current) client.releaseOnUnload(sessionId); };
    window.addEventListener("beforeunload", release);
    return () => {
      window.removeEventListener("beforeunload", release);
      release();
      if (eventTimerRef.current !== null) window.clearTimeout(eventTimerRef.current);
      if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  return <VisionObservationView state={state} previewUrl={previewUrl} cameraIndex={cameraIndex} persistedEvents={persisted?.events ?? []} onCameraIndex={setCameraIndex} onStart={() => void start()} onStop={() => void stop()} />;
}
