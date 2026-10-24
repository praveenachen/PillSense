import type { LocalSessionStatus, ObservationType } from "@/lib/vision/types";

const labels: Record<ObservationType, string> = {
  CAMERA_STARTED: "Camera started",
  CAMERA_STOPPED: "Camera stopped and released",
  PERSON_VISIBLE: "Person visible",
  PERSON_NOT_VISIBLE: "Person not visible",
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

export type PersistedVisionEvent = {
  _id?: string;
  type: ObservationType;
  occurredAt: number;
  source: string;
  diagnostic?: string;
};

export function VisionObservationView({ state, previewUrl, cameraIndex = 0, persistedEvents = [], onCameraIndex = () => undefined, onStart, onStop }: {
  state: VisionViewState;
  previewUrl?: string | null;
  cameraIndex?: number;
  persistedEvents?: PersistedVisionEvent[];
  onCameraIndex?: (index: number) => void;
  onStart: () => void;
  onStop: () => void;
}) {
  const active = state.status === "ACTIVE" || state.status === "STARTING" || state.status === "STOPPING";
  const running = state.status === "ACTIVE";
  const activity = state.status === "IDLE" ? "Camera inactive" : state.status === "ACTIVE"
    ? state.personVisible === true ? "Observing · person visible" : state.personVisible === false ? "Observing · person not visible" : "Observing"
    : state.status === "STARTING" ? "Requesting camera" : state.status === "STOPPING" ? "Stopping camera" : state.status;

  return <section aria-labelledby="vision-heading" className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-pd-accent-soft">Real local detector</p><h2 id="vision-heading" className="mt-1 text-xl font-semibold text-pd-text">Live camera observation</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-pd-muted">OpenCV and MediaPipe run only on this computer. No images or video are uploaded or stored.</p></div>
      <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${running ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : "border-pd-line bg-pd-surface text-pd-muted"}`}><span className={`size-2 rounded-full ${running ? "bg-emerald-400 shadow-[0_0_10px_#34d399]" : "bg-slate-500"}`} />{running ? "Running" : state.bridge === "CONNECTED" ? "Bridge ready" : state.bridge.toLowerCase()}</span>
    </div>

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.65fr)]">
      <div className="overflow-hidden rounded-[1.35rem] border border-pd-line bg-black/45">
        <div className="aspect-video w-full">{previewUrl ? <LocalPreviewImage src={previewUrl} /> : <div className="grid h-full place-items-center px-6 text-center text-sm text-pd-muted">{active ? "Waiting for the first annotated frame…" : "Start an observation to show the local annotated preview."}</div>}</div>
        <div className="flex items-center justify-between gap-3 border-t border-pd-line px-4 py-3 text-xs"><span className="font-semibold text-pd-text">{activity}</span><span className="text-pd-muted">Session limit: 5 minutes</span></div>
      </div>
      <div className="space-y-3">
        <StateRow label="Person visible" value={state.personVisible === undefined ? "No reading" : state.personVisible ? "Yes" : "No"} tone={state.personVisible ? "green" : "neutral"} />
        <StateRow label="Hand near mouth" value={state.lastGestureAt ? `Hand-to-mouth gesture observed at ${new Date(state.lastGestureAt).toLocaleTimeString()}` : "Not observed"} tone={state.lastGestureAt ? "amber" : "neutral"} />
        <StateRow label="Pill / tray presence" value="Unavailable · no detector" tone="neutral" />
        <StateRow label="Ingestion" value="Not camera-verified" tone="neutral" />
        <label className="block rounded-2xl border border-pd-line bg-pd-surface/80 p-3 text-xs font-semibold text-pd-muted">OpenCV camera<select value={cameraIndex} onChange={(event) => onCameraIndex(Number(event.target.value))} disabled={active} className="mt-2 min-h-11 w-full rounded-xl border border-pd-line bg-[#111625] px-3 text-sm text-pd-text outline-none disabled:opacity-50">{[0, 1, 2].map((index) => <option key={index} value={index}>Camera {index}</option>)}</select></label>
      </div>
    </div>

    {state.error && <p role="alert" className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200">{state.error}</p>}
    <div className="grid grid-cols-2 gap-3"><button type="button" onClick={onStart} disabled={active || state.bridge !== "CONNECTED"} className="pd-focus min-h-12 rounded-2xl bg-pd-accent px-4 text-sm font-bold text-white shadow-[0_0_24px_rgba(124,92,255,.2)] disabled:cursor-not-allowed disabled:opacity-40">Start observation</button><button type="button" onClick={onStop} disabled={!active || state.status === "STARTING" || state.status === "STOPPING"} className="pd-focus min-h-12 rounded-2xl border border-pd-line bg-pd-surface px-4 text-sm font-bold text-pd-text disabled:cursor-not-allowed disabled:opacity-40">Stop and release camera</button></div>

    <div className="rounded-[1.35rem] border border-pd-line bg-pd-surface/65 p-4">
      <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-pd-text">Convex observation timeline</h3><span className="rounded-full bg-pd-accent/10 px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-wide text-pd-accent-soft">Real events</span></div>
      <div className="mt-3 divide-y divide-pd-line">{persistedEvents.length === 0 ? <p className="py-4 text-sm text-pd-muted">No persisted camera events are available.</p> : persistedEvents.slice(0, 8).map((event, index) => <div key={event._id ?? `${event.type}:${event.occurredAt}:${index}`} className="flex gap-3 py-3"><span className={`mt-1 size-2.5 shrink-0 rounded-full ${event.type === "CAMERA_ERROR" ? "bg-rose-400" : event.type === "HAND_AT_MOUTH_DETECTED" ? "bg-amber-300" : "bg-emerald-400"}`} /><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-pd-text">{labels[event.type]}</span><span className="block text-xs text-pd-muted">{new Date(event.occurredAt).toLocaleString()} · {event.source === "WINDOWS_OPENCV_MEDIAPIPE" ? "Real local observation" : event.source}</span>{event.diagnostic && <span className="mt-1 block text-xs text-pd-muted">{event.diagnostic}</span>}</span></div>)}</div>
    </div>
    <p className="text-xs leading-5 text-pd-muted">A gesture is non-clinical observation evidence only. It cannot dispatch the motor and does not verify pill ingestion, release, or collection; a patient report remains separate.</p>
  </section>;
}

function StateRow({ label, value, tone }: { label: string; value: string; tone: "green" | "amber" | "neutral" }) {
  const dot = tone === "green" ? "bg-emerald-400 shadow-[0_0_9px_#34d399]" : tone === "amber" ? "bg-amber-300 shadow-[0_0_9px_#fcd34d]" : "bg-slate-500";
  return <div className="rounded-2xl border border-pd-line bg-pd-surface/80 p-3"><span className="flex items-center gap-2 text-xs font-semibold text-pd-muted"><span className={`size-2 rounded-full ${dot}`} />{label}</span><span className="mt-1.5 block text-sm font-semibold text-pd-text">{value}</span></div>;
}

function LocalPreviewImage({ src }: { src: string }) {
  // This short-lived localhost blob cannot use the Next image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Live local camera with MediaPipe landmark overlays" className="h-full w-full object-contain" />;
}
