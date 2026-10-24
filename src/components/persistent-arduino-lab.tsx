"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useCallback, useState } from "react";
import { api } from "../../convex/_generated/api";
import { ArduinoStatusPanel, type ArduinoLabSnapshot } from "./arduino-status-panel";
import { VisionObservationPanel } from "./vision-observation-panel";
import { HardwareLabDiagnostics, type TimedBleDiagnostic } from "./hardware-lab-diagnostics";
import { AuthRequired } from "./auth-required";
import { BrandMark, Icon } from "./mobile-ui";
import type { H3DiagnosticEntry } from "@/lib/dispenser/web-bluetooth-status-transport";

type LabTab = "controls" | "diagnostics" | "camera";

/**
 * This root-owned lab keeps the one Web Bluetooth transport mounted while the
 * operator changes lab tabs or app routes. The UI is hidden outside the
 * internal route, but the existing one-dispatch page-session lock is retained.
 */
export function PersistentArduinoLab({ authUiConfigured }: { authUiConfigured: boolean }) {
  const visible = usePathname() === "/hardware-lab";
  return <main aria-hidden={!visible} inert={!visible} className={visible ? "hardware-lab-dark min-h-screen bg-[#070a12] px-4 py-6 text-pd-text sm:px-6 sm:py-8" : "hidden"}>
    <div className="mx-auto max-w-5xl">
      <header className="flex items-center gap-3">
        <BrandMark size={42} />
        <div className="min-w-0 flex-1"><p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-pd-accent-soft">Authenticated operator workspace</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Hardware Lab</h1></div>
        <Link href="/demo" className="pd-focus inline-flex min-h-11 items-center gap-2 rounded-full border border-pd-line bg-pd-surface px-4 text-sm font-semibold text-pd-text"><Icon name="back" size={17} /> <span className="hidden sm:inline">Patient app</span></Link>
      </header>
      <section className="mt-5 rounded-[1.35rem] border border-amber-300/20 bg-amber-300/[.06] p-4 text-sm leading-6 text-pd-text/85">Internal H6C test surface. Real hardware, simulated device data, camera observations, and care-agent records stay explicitly separate. None proves medication ingestion or sensor-verified alignment.</section>
      {!authUiConfigured ? <div className="mt-5"><LabConfigurationRequired /></div> : <ProtectedHardwareLab visible={visible} />}
    </div>
  </main>;
}

function ProtectedHardwareLab({ visible }: { visible: boolean }) {
  const auth = useConvexAuth();
  if (auth.isLoading) return <LabNotice title="Checking operator access" detail="Waiting for Clerk and Convex authentication…" />;
  if (!auth.isAuthenticated) return <div className="mt-5"><AuthRequired dark message="The Hardware Lab requires an authenticated Convex session and authorized synthetic-care operator role." /></div>;
  return <AuthorizedLabGate visible={visible} />;
}

function AuthorizedLabGate({ visible }: { visible: boolean }) {
  const access = useQuery(api.hardwareLab.access);
  if (access === undefined) return <LabNotice title="Checking operator scope" detail="Validating the signed-in account on the Convex server…" />;
  if (!access.authorized) return <LabNotice title="Operator access unavailable" detail={access.reason === "CAREGIVER_REQUIRED" ? "Sign in with the caregiver demo account. Patient accounts cannot access privileged lab controls." : access.reason === "ONBOARDING_REQUIRED" ? "Complete authenticated demo onboarding before opening the lab." : "Create an explicit active caregiver relationship to a synthetic demo patient before enabling lab controls."} />;
  return <AuthorizedHardwareLab visible={visible} operatorName={access.operatorName} patientName={access.patientName} />;
}

function AuthorizedHardwareLab({ visible, operatorName, patientName }: { visible: boolean; operatorName: string; patientName: string }) {
  const [tab, setTab] = useState<LabTab>("controls");
  const [ble, setBle] = useState<ArduinoLabSnapshot | null>(null);
  const [bleEvents, setBleEvents] = useState<TimedBleDiagnostic[]>([]);
  const captureDiagnostic = useCallback((entry: H3DiagnosticEntry) => {
    setBleEvents((current) => [{ ...entry, at: Date.now() }, ...current].slice(0, 100));
  }, []);
  const captureSnapshot = useCallback((snapshot: ArduinoLabSnapshot) => setBle(snapshot), []);

  return <>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-pd-muted"><span>Operator: <strong className="text-pd-text">{operatorName}</strong> · synthetic scope: <strong className="text-pd-text">{patientName}</strong></span><span className="inline-flex items-center gap-2"><span className={`size-2 rounded-full ${ble?.connected ? "bg-emerald-400 shadow-[0_0_9px_#34d399]" : "bg-rose-400 shadow-[0_0_9px_#fb7185]"}`} />{ble?.connected ? "Arduino connected" : "Arduino disconnected"}</span></div>
    <nav aria-label="Hardware Lab sections" className="mt-4 grid grid-cols-3 rounded-2xl border border-pd-line bg-pd-surface p-1.5">{(["controls", "diagnostics", "camera"] as const).map((item) => <button key={item} type="button" aria-current={tab === item ? "page" : undefined} onClick={() => setTab(item)} className={`pd-focus min-h-11 rounded-xl px-3 text-sm font-semibold capitalize transition ${tab === item ? "bg-pd-accent text-white shadow-[0_0_20px_rgba(124,92,255,.28)]" : "text-pd-muted hover:text-pd-text"}`}>{item}</button>)}</nav>

    <section aria-hidden={tab !== "controls"} inert={tab !== "controls"} className={tab === "controls" ? "mt-5" : "hidden"}><ArduinoStatusPanel onDiagnostic={captureDiagnostic} onSnapshot={captureSnapshot} /></section>
    <section aria-hidden={tab !== "diagnostics"} inert={tab !== "diagnostics"} className={tab === "diagnostics" ? "mt-5" : "hidden"}><HardwareLabDiagnostics ble={ble} bleEvents={bleEvents} /></section>
    {visible && <section aria-hidden={tab !== "camera"} inert={tab !== "camera"} className={tab === "camera" ? "mt-5 rounded-[1.35rem] border border-pd-line bg-pd-surface/45 p-4 sm:p-5" : "hidden"}><VisionObservationPanel /></section>}
    {!visible && <span className="sr-only">Hardware Lab keeps only the BLE controller mounted; leaving the route releases any local camera session.</span>}
  </>;
}

function LabNotice({ title, detail }: { title: string; detail: string }) {
  return <section className="mt-5 rounded-[1.35rem] border border-pd-line bg-pd-surface p-6"><h2 className="text-lg font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-pd-muted">{detail}</p><p className="mt-3 text-xs text-amber-200">Privileged controls remain unavailable.</p></section>;
}

function LabConfigurationRequired() {
  return <section className="rounded-[1.35rem] border border-amber-300/20 bg-amber-300/[.06] p-6"><h2 className="text-lg font-semibold">Authentication configuration required</h2><p className="mt-2 text-sm leading-6 text-pd-muted">Clerk and Convex public environment configuration is required. No protected lab data or controls are exposed.</p></section>;
}
