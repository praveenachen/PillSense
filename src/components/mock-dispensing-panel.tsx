"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { MockDeviceGateway } from "@/lib/dispenser/mock-device-gateway";
import type { MockOutcome } from "@/lib/dispenser/mock-device-gateway";
import { MockDispenserAdapter } from "@/lib/dispenser/mock-dispenser-adapter";

const eligibilityMessage: Record<string, string> = {
  ELIGIBLE: "Ready for one simulated dispense attempt.",
  STALE: "Schedule changed or became inactive; this occurrence is obsolete.",
  UNCERTAIN: "Outcome is uncertain. Automatic retry is blocked pending review.",
  ALREADY_ATTEMPTED: "This occurrence already has a persistent dispense attempt.",
  NOT_DUE: "This scheduled occurrence is not inside its allowed dispensing window.",
  EXPIRED: "The allowed dispensing window has expired.",
  EMPTY: "The assigned compartment has no demo pill remaining.",
  DEVICE_NOT_READY: "Connect the mock device and confirm manual home alignment.",
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The simulated operation failed.";
}

export function MockDispensingPanel() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading || !isAuthenticated) return null;
  return <AuthenticatedMockPanel />;
}

function AuthenticatedMockPanel() {
  const [now, setNow] = useState(() => Date.now());
  const [gateway] = useState(
    () => new MockDeviceGateway(new MockDispenserAdapter()),
  );
  const [outcome, setOutcome] = useState<MockOutcome>("COMPLETED");
  const [progress, setProgress] = useState("Idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const doses = useQuery(api.occurrences.listForPatient, { now });
  const generateUpcoming = useMutation(api.occurrences.generateUpcoming);
  const createDemoDue = useMutation(api.occurrences.createDemoDue);
  const connectMock = useMutation(api.device.connectMock);
  const confirmMockHome = useMutation(api.device.confirmMockHome);
  const authorize = useMutation(api.dispensing.authorize);
  const markDispatched = useMutation(api.dispensing.markDispatched);
  const ingestEvent = useMutation(api.dispensing.ingestMockEvent);
  const reportIngestion = useMutation(api.dispensing.reportIngestion);

  useEffect(() => {
    void Promise.all([gateway.connect(), connectMock({})]).catch((caught) => {
      setError(errorMessage(caught));
    });
    void generateUpcoming({}).catch((caught) => setError(errorMessage(caught)));
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [connectMock, gateway, generateUpcoming]);

  async function calibrate() {
    setBusy(true);
    setError(null);
    try {
      await gateway.confirmHomeAligned();
      await confirmMockHome({});
      setProgress("Manual home alignment confirmed — mock device READY");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function reconnect() {
    setBusy(true);
    setError(null);
    try {
      await gateway.connect();
      await connectMock({});
      setProgress("Mock connected — calibration required");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function dispense(occurrenceId: Parameters<typeof authorize>[0]["occurrenceId"]) {
    setBusy(true);
    setError(null);
    setProgress("Requesting backend authorization…");
    let commandId: string | null = null;
    try {
      const command = await authorize({ occurrenceId });
      commandId = command.commandId;
      await markDispatched({ commandId });
      setProgress("COMMAND_ACCEPTED");
      const result = await gateway.execute(command, outcome, async (event) => {
        setProgress(event.type);
        await ingestEvent(event);
      });
      setProgress(
        result === "COMPLETED"
          ? "MOTOR_COMPLETED — pill release and collection remain unverified"
          : "UNKNOWN — retry blocked; caregiver review required",
      );
    } catch (caught) {
      if (commandId) {
        await ingestEvent({
          eventId: `${commandId}:UNKNOWN`,
          commandId,
          type: "UNKNOWN",
          occurredAt: now,
        }).catch(() => undefined);
      }
      setError(errorMessage(caught));
      setProgress("Operation stopped safely");
    } finally {
      setNow(Date.now());
      setBusy(false);
    }
  }

  if (doses === undefined) {
    return <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">Loading mock device and dose occurrences…</section>;
  }

  const deviceState = doses.device?.state ?? "DISCONNECTED";

  return (
    <section id="mock-dispensing" className="mt-6 scroll-mt-6 rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50/60 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="inline-flex rounded-full bg-violet-700 px-3 py-1 text-xs font-bold tracking-wide text-white">MOCK DEVICE · SIMULATED DISPENSING</p>
          <h2 className="mt-3 text-2xl font-semibold">Demo dispenser</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Motor events are simulated in this browser. Completion does not prove pill release, collection, or ingestion.</p>
        </div>
        <div className="rounded-xl border border-violet-200 bg-white px-4 py-3 text-sm">
          <span className="font-semibold">Device: </span>{deviceState}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={reconnect} disabled={busy} className="rounded-full border border-violet-300 bg-white px-4 py-2 text-sm font-semibold text-violet-800 disabled:opacity-50">Connect / reset mock</button>
        <button type="button" onClick={calibrate} disabled={busy || deviceState === "DISCONNECTED"} className="rounded-full bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Calibrate Home</button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await createDemoDue({});
              setNow(Date.now());
              setProgress("DEMO MODE occurrence created");
            } catch (caught) {
              setError(errorMessage(caught));
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-full border border-teal-300 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-800 disabled:opacity-50"
        >
          Create due dose · DEMO MODE
        </button>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          Simulated result
          <select value={outcome} onChange={(event) => setOutcome(event.target.value as MockOutcome)} className="rounded-lg border border-slate-300 bg-white px-3 py-2">
            <option value="COMPLETED">Motor completed</option>
            <option value="UNKNOWN">Unknown outcome</option>
            <option value="FAULT">Fault</option>
            <option value="DISCONNECTED">Disconnect</option>
          </select>
        </label>
      </div>

      <p aria-live="polite" className="mt-4 rounded-xl bg-white px-4 py-3 text-sm font-medium text-slate-700">Progress: {progress}</p>
      {error && <p role="alert" className="mt-3 rounded-xl bg-rose-100 p-3 text-sm text-rose-900">{error}</p>}

      <div className="mt-6 grid gap-4">
        {doses.occurrences.length === 0 ? (
          <p className="rounded-xl bg-white p-4 text-sm text-slate-600">No generated occurrences yet. Use DEMO MODE to safely create a due synthetic occurrence.</p>
        ) : doses.occurrences.map((dose) => (
          <article key={dose.id} className="rounded-2xl border border-violet-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-violet-700">{dose.mode === "demo" ? "DEMO DUE OCCURRENCE" : "Scheduled occurrence"}</p>
                <h3 className="mt-1 text-lg font-semibold">{dose.medicationName} · Slot {dose.slot}</h3>
                <p className="mt-1 text-sm text-slate-500">{new Date(dose.scheduledFor).toLocaleString()} · Inventory {dose.demoInventory}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{dose.attemptStatus}</span>
            </div>
            <p className="mt-3 text-sm text-slate-600">{eligibilityMessage[dose.eligibility] ?? dose.eligibility}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={busy || dose.eligibility !== "ELIGIBLE"} onClick={() => dispense(dose.id)} className="min-h-11 rounded-full bg-teal-600 px-5 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">Dispense mock pill</button>
              <button type="button" disabled={busy} onClick={() => reportIngestion({ occurrenceId: dose.id, report: "TAKEN" })} className="min-h-11 rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800">Taken</button>
              <button type="button" disabled={busy} onClick={() => reportIngestion({ occurrenceId: dose.id, report: "NOT_TAKEN" })} className="min-h-11 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Not Taken</button>
            </div>
            <p className="mt-3 text-xs text-slate-500">Patient report: {dose.ingestionReport.replaceAll("_", " ")} · Physical release: unverified</p>
          </article>
        ))}
      </div>
    </section>
  );
}
