"use client";

import { useConvexAuth, useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { LocalVisionClient } from "@/lib/vision/client";
import { createVisionSessionId, type VisionSnapshot } from "@/lib/vision/types";
import { VisionObservationView, type VisionViewState } from "./vision-observation-view";

const POLL_MS = 750;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Vision observation failed.";

export function VisionObservationPanel() {
  const { isAuthenticated } = useConvexAuth();
  if (!isAuthenticated) return null;
  return <AuthenticatedVisionObservationPanel />;
}

function AuthenticatedVisionObservationPanel() {
  const [state, setState] = useState<VisionViewState>({ status: "IDLE", bridge: "CHECKING" });
  const clientRef = useRef(new LocalVisionClient());
  const sessionRef = useRef<string | null>(null);
  const lastEventRef = useRef<string | undefined>(undefined);
  const timerRef = useRef<number | null>(null);
  const stoppedRef = useRef(true);
  const beginSession = useMutation(api.vision.beginSession);
  const recordEvent = useMutation(api.vision.recordEvent);
  const closeSession = useMutation(api.vision.closeSession);

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
        error: event.type === "CAMERA_ERROR"
          ? event.diagnostic ?? "The local camera stopped with an error."
          : event.type === "CAMERA_STARTED" ? undefined : current.error,
      }));
    }
    if (snapshot.status !== "ACTIVE") {
      stoppedRef.current = true;
      await closeSession({ sessionId: snapshot.sessionId, status: snapshot.status, endedAt: Date.now() });
      setState((current) => ({ ...current, status: snapshot.status }));
    }
  }, [closeSession, recordEvent]);

  const poll = useCallback(async () => {
    const sessionId = sessionRef.current;
    if (!sessionId || stoppedRef.current) return;
    try {
      const snapshot = await clientRef.current.events(sessionId, lastEventRef.current);
      await persistSnapshot(snapshot);
      if (!stoppedRef.current) timerRef.current = window.setTimeout(() => void poll(), POLL_MS);
    } catch (error) {
      stoppedRef.current = true;
      setState((current) => ({ ...current, status: "ERROR", error: errorMessage(error) }));
      await closeSession({ sessionId, status: "ERROR", endedAt: Date.now() }).catch(() => undefined);
    }
  }, [closeSession, persistSnapshot]);

  async function start() {
    if (!stoppedRef.current) return;
    const sessionId = createVisionSessionId();
    sessionRef.current = sessionId;
    lastEventRef.current = undefined;
    stoppedRef.current = false;
    setState((current) => ({ ...current, status: "STARTING", error: undefined }));
    try {
      await beginSession({ sessionId, startedAt: Date.now() });
      const snapshot = await clientRef.current.start(sessionId);
      await persistSnapshot(snapshot);
      if (!stoppedRef.current) void poll();
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
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    try {
      const snapshot = await clientRef.current.stop(sessionId);
      await persistSnapshot(snapshot);
    } catch (error) {
      stoppedRef.current = true;
      setState((current) => ({ ...current, status: "ERROR", error: errorMessage(error) }));
      await closeSession({ sessionId, status: "ERROR", endedAt: Date.now() }).catch(() => undefined);
    }
  }

  useEffect(() => {
    const client = clientRef.current;
    void client.health().then(
      () => setState((current) => ({ ...current, bridge: "CONNECTED" })),
      () => setState((current) => ({ ...current, bridge: "UNAVAILABLE" })),
    );
    const release = () => {
      const sessionId = sessionRef.current;
      if (sessionId && !stoppedRef.current) client.releaseOnUnload(sessionId);
    };
    window.addEventListener("beforeunload", release);
    return () => {
      window.removeEventListener("beforeunload", release);
      release();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  return <div className="mt-4"><VisionObservationView state={state} onStart={() => void start()} onStop={() => void stop()} /></div>;
}
