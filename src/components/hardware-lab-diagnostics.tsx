"use client";

import { useQuery } from "convex/react";
import { Suspense, useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { ArduinoLabSnapshot } from "./arduino-status-panel";
import type { H3DiagnosticEntry } from "@/lib/dispenser/web-bluetooth-status-transport";
import { MockDispensingPanel } from "./mock-dispensing-panel";
import { VoiceDeveloperPanel } from "./voice-developer-panel";
import { PatientReminders } from "./patient-reminders";
import { CaregiverRefills } from "./caregiver-refills";

export type TimedBleDiagnostic = H3DiagnosticEntry & { at: number };

type Availability = "CHECKING" | "AVAILABLE" | "UNAVAILABLE" | "NOT_CONFIGURED";

export function HardwareLabDiagnostics({ ble, bleEvents }: { ble: ArduinoLabSnapshot | null; bleEvents: TimedBleDiagnostic[] }) {
  const runs = useQuery(api.agentRuns.listForCaregiver);
  const vision = useQuery(api.vision.latest);
  const [voice, setVoice] = useState<Availability>("CHECKING");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/voice/status", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Voice status unavailable");
        const result = await response.json() as { configured?: boolean };
        setVoice(result.configured ? "AVAILABLE" : "NOT_CONFIGURED");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setVoice("UNAVAILABLE");
      });
    return () => controller.abort();
  }, []);

  const latestRun = runs?.status === "ready" ? runs.runs[0] : undefined;
  const latestVision = vision?.events[0];
  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Observable service availability">
      <AvailabilityCard label="Convex" value="Authenticated" detail="Live protected query" tone="ok" />
      <AvailabilityCard label="Arduino BLE" value={ble?.connected ? "Connected" : "Disconnected"} detail={ble?.lastResponse ? `Last: ${ble.lastResponse}` : "No response read"} tone={ble?.connected ? "ok" : "neutral"} />
      <AvailabilityCard label="Camera" value={vision?.session.status ?? (vision === undefined ? "Checking" : "No sessions")} detail={latestVision ? new Date(latestVision.occurredAt).toLocaleTimeString() : "No observation event"} tone={vision?.session.status === "ACTIVE" ? "ok" : "neutral"} />
      <AvailabilityCard label="Voice" value={voice.replaceAll("_", " ").toLowerCase()} detail="Server configuration check" tone={voice === "AVAILABLE" ? "ok" : "neutral"} />
      <AvailabilityCard label="Care agent" value={latestRun?.status ?? (runs === undefined ? "Checking" : "No runs")} detail={latestRun ? `${latestRun.actions.length} recorded actions` : "Protected read-only view"} tone={latestRun?.status === "COMPLETED" ? "ok" : "neutral"} />
      <AvailabilityCard label="Pill detector" value="Unavailable" detail="No pill/tray model exists" tone="neutral" />
      <AvailabilityCard label="Motor evidence" value={ble?.dispatchEvidence?.replaceAll("_", " ").toLowerCase() ?? "No page event"} detail="Browser-observed only" tone={ble?.phase === "STEPS_COMPLETED" ? "ok" : "neutral"} />
      <AvailabilityCard label="Ingestion" value="Not camera-verified" detail="Patient report is separate" tone="neutral" />
    </section>

    <section className="rounded-[1.35rem] border border-pd-line bg-pd-surface/65 p-4">
      <div className="flex items-center justify-between gap-3"><div><p className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-pd-accent-soft">Real browser session</p><h2 className="mt-1 text-lg font-semibold text-pd-text">BLE event history</h2></div><span className="text-xs text-pd-muted">{bleEvents.length} events</span></div>
      {(ble?.operationId || ble?.error) && <div className="mt-3 rounded-xl border border-pd-line bg-black/15 p-3 text-xs"><p className="text-pd-muted">Operation ID: <span className="break-all font-mono text-pd-text">{ble.operationId ?? "not created"}</span></p>{ble.error && <p className="mt-2 text-rose-200">{ble.error}</p>}</div>}
      <div className="mt-3 max-h-80 divide-y divide-pd-line overflow-y-auto">{bleEvents.length === 0 ? <p className="py-5 text-sm text-pd-muted">Pair the Arduino or read status to begin a genuine BLE event history.</p> : bleEvents.map((event, index) => <div key={`${event.at}:${event.event}:${index}`} className="grid gap-1 py-3 sm:grid-cols-[7rem_1fr]"><time className="font-mono text-xs text-pd-muted">{new Date(event.at).toLocaleTimeString()}</time><div><p className="break-words font-mono text-xs font-semibold text-pd-text">{event.event}</p><p className="mt-1 break-all font-mono text-[0.68rem] leading-5 text-pd-muted">{formatDiagnostic(event)}</p></div></div>)}</div>
    </section>

    <DeveloperSection title="Mock device · simulated events" label="SIMULATED"><MockDispensingPanel /></DeveloperSection>
    <DeveloperSection title="Synthetic reminder scenarios" label="SYNTHETIC"><PatientReminders showDeveloperControls /></DeveloperSection>
    <DeveloperSection title="Synthetic refill scenarios" label="SYNTHETIC"><CaregiverRefills showDeveloperControls /></DeveloperSection>
    <DeveloperSection title="Voice demo · synthetic controls" label="SYNTHETIC"><Suspense fallback={<p className="text-sm text-pd-muted">Loading voice controls…</p>}><VoiceDeveloperPanel /></Suspense></DeveloperSection>

    <section className="rounded-[1.35rem] border border-pd-line bg-pd-surface/65 p-4">
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-pd-text">Care-agent activity</h2><span className="rounded-full bg-sky-400/10 px-2.5 py-1 text-[0.65rem] font-bold text-sky-300">READ ONLY</span></div>
      {runs === undefined ? <p className="mt-3 text-sm text-pd-muted">Loading protected investigation data…</p> : runs.status !== "ready" ? <p className="mt-3 text-sm text-amber-200">Caregiver access is unavailable.</p> : runs.runs.length === 0 ? <p className="mt-3 text-sm text-pd-muted">No investigations are recorded for the paired synthetic patient.</p> : <div className="mt-3 divide-y divide-pd-line">{runs.runs.slice(0, 6).map((run) => <div key={run.id} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs text-pd-text">{run.runId}</span><span className="text-xs font-semibold text-pd-accent-soft">{run.status}</span></div><p className="mt-1 text-xs text-pd-muted">{run.workflowType.replaceAll("_", " ").toLowerCase()} · {run.provider ?? "provider pending"} · {run.actions.length} actions</p></div>)}</div>}
    </section>
  </div>;
}

function formatDiagnostic(entry: TimedBleDiagnostic) {
  const values = Object.entries(entry).filter(([key, value]) => key !== "event" && key !== "at" && value !== undefined).map(([key, value]) => `${key}=${String(value)}`);
  return values.length ? values.join(" · ") : "No additional fields";
}

function AvailabilityCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "ok" | "neutral" }) {
  return <article className="rounded-2xl border border-pd-line bg-pd-surface/65 p-4"><p className="flex items-center gap-2 text-xs font-semibold text-pd-muted"><span className={`size-2 rounded-full ${tone === "ok" ? "bg-emerald-400 shadow-[0_0_9px_#34d399]" : "bg-slate-500"}`} />{label}</p><p className="mt-2 break-words text-sm font-semibold capitalize text-pd-text">{value}</p><p className="mt-1 text-xs leading-5 text-pd-muted">{detail}</p></article>;
}

function DeveloperSection({ title, label, children }: { title: string; label: string; children: React.ReactNode }) {
  return <details className="hardware-lab-legacy rounded-[1.35rem] border border-pd-line bg-pd-surface/65 p-4"><summary className="pd-focus flex min-h-11 cursor-pointer items-center justify-between gap-3 text-lg font-semibold text-pd-text"><span>{title}</span><span className="rounded-full bg-pd-accent/10 px-2.5 py-1 text-[0.65rem] font-bold tracking-wide text-pd-accent-soft">{label}</span></summary><div className="mt-4 text-[#0f172a]">{children}</div></details>;
}
