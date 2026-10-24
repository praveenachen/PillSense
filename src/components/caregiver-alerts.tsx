"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";

const reasonLabels = {
  NO_PATIENT_RESPONSE: "No patient response",
  MOTOR_COMPLETED_INGESTION_UNCONFIRMED: "Motor completed; ingestion unconfirmed",
  MOTOR_OUTCOME_UNKNOWN: "Motor outcome unknown",
  PATIENT_REPORTED_NOT_TAKEN: "Patient reported NOT TAKEN",
  DEVICE_FAULT_OR_DISCONNECTED: "Device fault or disconnection",
} as const;

type CaseCardProps = {
  item: {
    id: Id<"careCases">;
    caseId: string;
    caseVersion: number;
    medicationName: string;
    dueAt: number;
    triggerReason: keyof typeof reasonLabels;
    status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
    recommendation: string;
    evidenceReferences: {
      commandId: string | null;
      demoScenarioRunId: Id<"demoScenarioRuns"> | null;
      deviceEventIds: string[];
      patientReport: "UNREPORTED" | "TAKEN" | "NOT_TAKEN";
    };
    investigationStatus: "NOT_REQUESTED" | "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
    syntheticPatient: boolean;
    agentRun: {
      id: Id<"agentRuns">;
      status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
      provider: "OPENAI" | "ANTHROPIC" | "DETERMINISTIC_FALLBACK" | null;
      model: string | null;
      findings: {
        items: Array<{
          category: string;
          uncertainty: "LOW" | "MEDIUM" | "HIGH";
          explanation: string;
          evidenceReferences: string[];
        }>;
        overallSummary: string;
        proposedFollowUp: { actionType: string; explanation: string };
      } | null;
      failureCode: string | null;
      updatedAt: number;
    } | null;
    resolutionNote: string | null;
    resolutionOutcome: string | null;
    updatedAt: number;
    transitions: Array<{
      type: string;
      toStatus: string;
      note: string | null;
      occurredAt: number;
    }>;
  };
};

export function CaregiverAlerts() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading || !isAuthenticated) return null;
  return <AuthenticatedAlerts />;
}

function AuthenticatedAlerts() {
  const result = useQuery(api.careCases.listForCaregiver);
  if (result === undefined) {
    return <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">Loading care alerts…</section>;
  }
  if (result.status !== "ready") return null;
  return (
    <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/50 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-amber-800">{result.patientName}</p>
          <h2 className="mt-1 text-2xl font-semibold">Caregiver alerts</h2>
        </div>
        <span className="text-xs text-slate-500">Reactive · deterministic · no agent required</span>
      </div>
      {result.cases.length === 0 ? (
        <p className="mt-4 rounded-xl bg-white p-4 text-sm text-slate-600">No unresolved care cases.</p>
      ) : (
        <div className="mt-5 space-y-4">
          {result.cases.map((item) => <CaseCard key={item.id} item={item} />)}
        </div>
      )}
    </section>
  );
}

function CaseCard({ item }: CaseCardProps) {
  const updateStatus = useMutation(api.careCases.updateStatus);
  const requestInvestigation = useMutation(api.agentRuns.requestInvestigation);
  const [note, setNote] = useState(item.resolutionNote ?? "");
  const [outcome, setOutcome] = useState("FOLLOW_UP_REQUIRED");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: "ACKNOWLEDGE" | "RESOLVE") {
    setBusy(true);
    setError(null);
    try {
      await updateStatus({
        careCaseId: item.id,
        action,
        note,
        outcome: outcome as "FOLLOW_UP_REQUIRED" | "CONTACTED_PATIENT" | "DEVICE_REVIEW" | "NO_FURTHER_ACTION" | "OTHER",
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update the case.");
    } finally {
      setBusy(false);
    }
  }

  async function investigate() {
    setBusy(true);
    setError(null);
    try {
      await requestInvestigation({ careCaseId: item.id });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to request an investigation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`rounded-2xl border bg-white p-5 ${item.status === "OPEN" ? "border-amber-300" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-amber-800">{reasonLabels[item.triggerReason]}</p>
          <h3 className="mt-1 text-lg font-semibold">{item.medicationName}</h3>
          <p className="mt-1 text-sm text-slate-500">Due {new Date(item.dueAt).toLocaleString()}</p>
        </div>
        <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white">{item.status}</span>
      </div>
      <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950">{item.recommendation}</p>
      <div className="mt-4 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
        <p><span className="font-semibold">Case:</span> {item.caseId} · v{item.caseVersion}</p>
        <p><span className="font-semibold">Investigation:</span> {item.investigationStatus.replaceAll("_", " ")}</p>
        <p><span className="font-semibold">Patient report:</span> {item.evidenceReferences.patientReport.replaceAll("_", " ")}</p>
        <p><span className="font-semibold">Command:</span> {item.evidenceReferences.commandId ?? "none"}</p>
        <p><span className="font-semibold">Demo scenario:</span> {item.evidenceReferences.demoScenarioRunId ?? "none"}</p>
        <p className="sm:col-span-2"><span className="font-semibold">Device events:</span> {item.evidenceReferences.deviceEventIds.join(", ") || "none"}</p>
      </div>

      {item.status === "OPEN" && item.syntheticPatient && (
        <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-sky-950">Evidence-first care coordinator</p>
              <p className="mt-1 text-xs text-sky-800">Status: {item.investigationStatus.replaceAll("_", " ")}. The coordinator cannot dispense or change medication instructions.</p>
            </div>
            <button
              type="button"
              disabled={busy || item.investigationStatus === "PENDING" || item.investigationStatus === "RUNNING" || item.investigationStatus === "COMPLETED"}
              onClick={investigate}
              className="rounded-full bg-sky-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {item.investigationStatus === "FAILED" ? "Retry investigation" : "Investigate with AI"}
            </button>
          </div>
          {item.agentRun?.provider && (
            <p className="mt-2 text-xs font-semibold text-sky-900">
              Result source: {item.agentRun.provider === "ANTHROPIC" ? `Live Claude${item.agentRun.model ? ` · ${item.agentRun.model}` : ""}` : item.agentRun.provider === "OPENAI" ? `Historical OpenAI run${item.agentRun.model ? ` · ${item.agentRun.model}` : ""}` : "NON-LLM deterministic fallback"}
            </p>
          )}
          {item.agentRun?.findings && (
            <div className="mt-3 border-t border-sky-200 pt-3 text-sm text-slate-700">
              <p className="font-semibold">{item.agentRun.findings.overallSummary}</p>
              <ul className="mt-2 space-y-1">
                {item.agentRun.findings.items.map((finding, index) => (
                  <li key={`${finding.category}:${index}`}>{finding.category.replaceAll("_", " ")} · {finding.uncertainty.toLowerCase()} uncertainty — {finding.explanation}</li>
                ))}
              </ul>
              <p className="mt-2"><span className="font-semibold">Proposed follow-up:</span> {item.agentRun.findings.proposedFollowUp.actionType.replaceAll("_", " ")} — {item.agentRun.findings.proposedFollowUp.explanation}</p>
            </div>
          )}
          {item.agentRun?.failureCode && <p className="mt-2 text-xs text-rose-800">Worker failed safely: {item.agentRun.failureCode}. The deterministic alert remains active.</p>}
        </div>
      )}

      {item.status !== "RESOLVED" && (
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="text-sm font-medium text-slate-700">
            Human follow-up note
            <input className="input mt-1" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="What was reviewed or confirmed?" />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Outcome
            <select className="input mt-1" value={outcome} onChange={(event) => setOutcome(event.target.value)}>
              <option value="FOLLOW_UP_REQUIRED">Follow-up required</option>
              <option value="CONTACTED_PATIENT">Contacted patient</option>
              <option value="DEVICE_REVIEW">Device review</option>
              <option value="NO_FURTHER_ACTION">No further action</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="button" disabled={busy || !note.trim()} onClick={() => submit("ACKNOWLEDGE")} className="rounded-full bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Acknowledge</button>
            <button type="button" disabled={busy || !note.trim()} onClick={() => submit("RESOLVE")} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Resolve case</button>
          </div>
        </div>
      )}
      {item.resolutionNote && <p className="mt-3 text-sm text-slate-600"><span className="font-semibold">Latest note:</span> {item.resolutionNote} {item.resolutionOutcome ? `(${item.resolutionOutcome.replaceAll("_", " ")})` : ""}</p>}
      {error && <p role="alert" className="mt-3 rounded-xl bg-rose-100 p-3 text-sm text-rose-900">{error}</p>}
      <details className="mt-4 text-xs text-slate-500">
        <summary className="cursor-pointer font-semibold">Audit trail ({item.transitions.length})</summary>
        <ul className="mt-2 space-y-1">
          {item.transitions.map((transition, index) => (
            <li key={`${transition.occurredAt}:${index}`}>{new Date(transition.occurredAt).toLocaleString()} · {transition.type} → {transition.toStatus}{transition.note ? ` · ${transition.note}` : ""}</li>
          ))}
        </ul>
      </details>
    </article>
  );
}
