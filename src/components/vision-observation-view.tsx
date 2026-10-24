import type { LocalSessionStatus, ObservationType } from "@/lib/vision/types";

const labels: Record<ObservationType, string> = {
  CAMERA_STARTED: "Camera started",
  CAMERA_STOPPED: "Camera stopped",
  PERSON_VISIBLE: "Single person visible",
  PERSON_NOT_VISIBLE: "Single person not visible",
  HAND_AT_MOUTH_DETECTED: "Hand-to-mouth gesture observed",
  CAMERA_ERROR: "Camera error",
};

export type VisionViewState = {
  status: LocalSessionStatus | "IDLE" | "STARTING" | "STOPPING";
  bridge: "CHECKING" | "CONNECTED" | "UNAVAILABLE";
  personVisible?: boolean;
  lastType?: ObservationType;
  lastTimestamp?: number;
  lastGestureAt?: number;
  error?: string;
};

export function VisionObservationView({ state, onStart, onStop }: {
  state: VisionViewState;
  onStart: () => void;
  onStop: () => void;
}) {
  const active = state.status === "ACTIVE" || state.status === "STARTING" || state.status === "STOPPING";
  const activity = state.status === "IDLE" ? "Camera inactive" : state.status === "ACTIVE"
    ? state.personVisible === true ? "Observing · person visible" : state.personVisible === false ? "Observing · person not visible" : "Observing"
    : state.status === "STARTING" ? "Requesting camera" : state.status === "STOPPING" ? "Stopping camera" : state.status;
  return (
    <section className="ps-card border-[#b9e4dc] bg-[#f1fbf8] p-4" aria-labelledby="vision-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.16em] text-[#0f766e]">Local camera observation</p>
          <h2 id="vision-heading" className="ps-display mt-1 text-lg font-semibold text-[#0f172a]">Hand-to-mouth demo</h2>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-[0.65rem] font-bold text-[#475569]">Bridge {state.bridge.toLowerCase()}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-[#475569]">
        Runs OpenCV and MediaPipe only on this Windows computer. No images or video are uploaded or stored.
      </p>
      <div className="mt-3 rounded-xl border border-[#cdebe5] bg-white p-3 text-sm text-[#334155]" aria-live="polite">
        <span className="font-semibold">{activity}</span>
        <span className="mt-1 block text-xs">{state.lastType ? labels[state.lastType] : "No observation session has started."}</span>
        {state.lastTimestamp && <span className="mt-1 block text-xs text-[#64748b]">{new Date(state.lastTimestamp).toLocaleTimeString()}</span>}
      </div>
      <p className="mt-2 text-xs font-medium text-[#0f766e]">
        {state.lastGestureAt ? `Last genuine gesture observation: ${new Date(state.lastGestureAt).toLocaleTimeString()}` : "No gesture observed in this page session."}
      </p>
      <p className="mt-2 text-[0.7rem] leading-5 text-[#64748b]">
        Gesture detection is an observation only. It does not verify pill ingestion and cannot trigger the dispenser.
      </p>
      {state.error && <p role="alert" className="mt-3 rounded-xl bg-rose-100 p-3 text-xs text-rose-900">{state.error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onStart} disabled={active} className="ps-focus min-h-11 flex-1 rounded-full bg-[#0f766e] px-3 text-sm font-bold text-white disabled:opacity-45">Start camera</button>
        <button type="button" onClick={onStop} disabled={!active || state.status === "STARTING" || state.status === "STOPPING"} className="ps-focus min-h-11 flex-1 rounded-full border border-[#9bcfc5] bg-white px-3 text-sm font-bold text-[#0f766e] disabled:opacity-45">Stop camera</button>
      </div>
    </section>
  );
}
