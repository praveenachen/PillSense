"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { AuthRequired } from "./auth-required";

export function AgentActivityList() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) {
    return <section className="rounded-2xl border border-slate-200 bg-white p-6">Loading coordinator activity…</section>;
  }
  if (!isAuthenticated) {
    return <AuthRequired message="Coordinator activity is private and requires an authenticated Convex session." />;
  }
  return <AuthenticatedActivity />;
}

function AuthenticatedActivity() {
  const result = useQuery(api.agentRuns.listForCaregiver);
  if (result === undefined) {
    return <section className="rounded-2xl border border-slate-200 bg-white p-6">Listening for coordinator runs…</section>;
  }
  if (result.status !== "ready") {
    return <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">Caregiver access is required to view coordinator activity.</section>;
  }
  if (result.runs.length === 0) {
    return <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">No investigations have been requested for {result.patientName}.</section>;
  }
  return (
    <section className="space-y-4">
      {result.runs.map((run) => (
        <article id={`run-${run.id}`} key={run.id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-sky-700">{run.triggerReason.replaceAll("_", " ")}</p>
              <h2 className="mt-1 text-xl font-semibold">{run.workflowType === "REFILL_INVESTIGATION" ? "Refill" : "Adherence"} investigation · case v{run.caseVersion}</h2>
              <p className="mt-1 text-xs text-slate-500">{run.runId}</p>
            </div>
            <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white">{run.status}</span>
          </div>
          <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
            <p><span className="font-semibold">Requested:</span> {new Date(run.createdAt).toLocaleString()}</p>
            <p><span className="font-semibold">Source:</span> {run.provider === "ANTHROPIC" ? `Live Claude${run.model ? ` · ${run.model}` : ""}` : run.provider === "OPENAI" ? `Historical OpenAI run${run.model ? ` · ${run.model}` : ""}` : run.provider === "DETERMINISTIC_FALLBACK" ? "NON-LLM deterministic fallback" : "Awaiting worker"}</p>
            {run.claimedAt && <p><span className="font-semibold">Started:</span> {new Date(run.claimedAt).toLocaleString()}</p>}
            {run.completedAt && <p><span className="font-semibold">Finished:</span> {new Date(run.completedAt).toLocaleString()}</p>}
          </div>

          {run.actions.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">Persisted tool activity</h3>
              <ul className="mt-2 space-y-2">
                {run.actions.map((action) => (
                  <li key={action.actionId} className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-semibold text-slate-800">{action.toolName.replaceAll("_", " ")} · {action.status}</span>
                      <span>{new Date(action.completedAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-1">{action.summary}</p>
                    {action.evidenceReferences.length > 0 && <p className="mt-1 break-all text-slate-500">Evidence: {action.evidenceReferences.join(", ")}</p>}
                    {action.errorCode && <p className="mt-1 text-rose-700">Error: {action.errorCode}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {run.findings && (
            <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 p-5">
              <h3 className="font-semibold text-sky-950">Structured findings</h3>
              <p className="mt-2 text-sm text-slate-700">{run.findings.overallSummary}</p>
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                {run.findings.items.map((finding, index) => (
                  <li key={`${finding.category}:${index}`}>
                    <span className="font-semibold">{finding.category.replaceAll("_", " ")}</span> · {finding.uncertainty.toLowerCase()} uncertainty — {finding.explanation}
                    <span className="mt-1 block break-all text-xs text-slate-500">Evidence: {finding.evidenceReferences.join(", ") || "none"}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-sky-950"><span className="font-semibold">Caregiver follow-up:</span> {run.findings.proposedFollowUp.actionType.replaceAll("_", " ")} — {run.findings.proposedFollowUp.explanation}</p>
            </div>
          )}
          {run.failureCode && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">The worker failed safely: {run.failureCode}. The deterministic care alert remains operational.</p>}
          <p className="mt-4 text-xs text-slate-500">No raw model reasoning is stored or displayed.</p>
        </article>
      ))}
    </section>
  );
}
