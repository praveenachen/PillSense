"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { ArduinoStatusPanel } from "./arduino-status-panel";
import { MockDispensingPanel } from "./mock-dispensing-panel";
import { VisionObservationPanel } from "./vision-observation-panel";
import { BrandMark, Icon } from "./mobile-ui";
import { VoiceDeveloperPanel } from "./voice-developer-panel";

/**
 * The real BLE panel stays mounted at the application root so its single transport,
 * connection, and one-dispatch browser-session lock survive route navigation. It is
 * only visible on the explicit internal Hardware Lab route.
 */
export function PersistentArduinoLab({ authUiConfigured }: { authUiConfigured: boolean }) {
  const visible = usePathname() === "/hardware-lab";
  return (
    <main aria-hidden={!visible} inert={!visible} className={visible ? "min-h-screen bg-[#080b13] px-4 py-8 text-pd-text sm:px-6" : "hidden"}>
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center gap-3 border-b border-pd-line pb-6">
          <BrandMark size={42} />
          <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-pd-accent-soft">Internal tooling</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Developer / Hardware Lab</h1></div>
          <Link href="/demo" className="pd-focus inline-flex min-h-11 items-center gap-2 rounded-full border border-pd-line bg-pd-surface px-4 text-sm font-semibold text-pd-text"><Icon name="back" size={17} /> Patient app</Link>
        </header>

        <section className="mt-6 rounded-pd-card border border-pd-warn/25 bg-pd-warn/10 p-4 text-sm leading-6 text-pd-text/85">
          Real Arduino controls remain supervised and empty-carousel only. Mock operations and camera observations are separate evidence sources; none establishes pill release, collection, ingestion, or sensor-verified alignment.
        </section>

        <div className="mt-6 space-y-6 text-[#0f172a]">
          <section aria-label="Persistent supervised Arduino controls" className="rounded-pd-card bg-[#eef4f8] p-4 sm:p-5">
            <h2 className="mb-4 text-lg font-semibold">Real Arduino · supervised hardware test</h2>
            <ArduinoStatusPanel />
          </section>
          {visible && (
            <>
              <section className="rounded-pd-card bg-[#eef4f8] p-4 sm:p-5">
                <h2 className="mb-4 text-lg font-semibold">Mock dispenser · simulation</h2>
                {authUiConfigured ? <MockDispensingPanel /> : <LabConfigurationRequired />}
              </section>
              <section className="rounded-pd-card bg-[#eef4f8] p-4 sm:p-5">
                <h2 className="mb-4 text-lg font-semibold">Camera observation · developer panel</h2>
                {authUiConfigured ? <VisionObservationPanel /> : <LabConfigurationRequired />}
              </section>
              <section className="rounded-pd-card bg-[#eef4f8] p-4 sm:p-5">
                <h2 className="mb-4 text-lg font-semibold">Voice demo · synthetic controls</h2>
                {authUiConfigured ? <Suspense fallback={<p className="text-sm text-[#64748b]">Loading voice controls…</p>}><VoiceDeveloperPanel /></Suspense> : <LabConfigurationRequired />}
              </section>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function LabConfigurationRequired() {
  return <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Clerk and Convex public environment configuration is required for protected lab data.</p>;
}
