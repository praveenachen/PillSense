"use client";

import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AuthRequired } from "./auth-required";

export function AgentverseActivity() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return <section className="rounded-2xl border border-slate-200 bg-white p-6">Loading Agentverse transport…</section>;
  if (!isAuthenticated) return <AuthRequired message="Agentverse activity is private and requires an authenticated Convex session." />;
  return <AuthenticatedAgentverseActivity />;
}

function AuthenticatedAgentverseActivity() {
  const activity = useQuery(api.agentverse.listForCaregiver);
  const cases = useQuery(api.careCases.listForCaregiver);
  const preauthorize = useMutation(api.agentverse.preauthorizeDemoCase);
  const revoke = useMutation(api.agentverse.revokeDemoScope);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (activity === undefined || cases === undefined) {
    return <section className="rounded-2xl border border-slate-200 bg-white p-6">Listening for Agentverse requests…</section>;
  }
  if (activity.status !== "ready" || cases.status !== "ready") {
    return <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">Caregiver access is required.</section>;
  }
  const openCases = cases.cases.filter((item) => item.status === "OPEN" && item.syntheticPatient);
  const activeByCase = new Map(
    activity.scopes.filter((scope) => scope.status === "ACTIVE").map((scope) => [scope.careCaseId, scope]),
  );

  async function authorize(careCaseId: Id<"careCases">) {
    setBusy(careCaseId);
    setError(null);
    try {
      await preauthorize({ careCaseId });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to authorize the demo case.");
    } finally {
      setBusy(null);
    }
  }

  async function revokeScope(scopeId: Id<"agentverseScopes">) {
    setBusy(scopeId);
    setError(null);
    try {
      await revoke({ scopeId });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to revoke the demo scope.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-violet-200 bg-violet-50/40 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-violet-700">Real Fetch.ai Agentverse</p>
          <h2 className="mt-1 text-2xl font-semibold">External care requests</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Authorize one synthetic case alias, then observe signed uAgent messages hand off to the existing bounded coordinator. No medication details travel in the A2A messages.</p>
        </div>
        <span className="rounded-full bg-violet-700 px-3 py-1 text-xs font-bold text-white">DEMO SCOPE ONLY</span>
      </div>

      <div className="mt-5 space-y-3">
        {openCases.length === 0 ? (
          <p className="rounded-xl bg-white p-4 text-sm text-slate-600">Create an open synthetic caregiver alert before authorizing Agentverse.</p>
        ) : openCases.map((careCase) => {
          const scope = activeByCase.get(careCase.id);
          return (
            <div key={careCase.id} className="rounded-xl border border-violet-100 bg-white p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{careCase.triggerReason.replaceAll("_", " ")} · case v{careCase.caseVersion}</p>
                  <p className="mt-1 text-xs text-slate-500">Only this already-authorized synthetic case can be resolved from the alias.</p>
                </div>
                {scope ? (
                  <button type="button" disabled={busy === scope.id} onClick={() => revokeScope(scope.id)} className="rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold disabled:opacity-50">Revoke</button>
                ) : (
                  <button type="button" disabled={busy === careCase.id} onClick={() => authorize(careCase.id)} className="rounded-full bg-violet-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">Authorize demo case</button>
                )}
              </div>
              {scope && <p className="mt-3 break-all rounded-lg bg-violet-50 p-3 font-mono text-xs text-violet-950">Alias: {scope.alias}</p>}
            </div>
          );
        })}
      </div>

      {error && <p role="alert" className="mt-4 rounded-xl bg-rose-100 p-3 text-sm text-rose-900">{error}</p>}

      <div className="mt-6">
        <h3 className="font-semibold">Transport audit</h3>
        {activity.requests.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No external Agentverse requests received.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {activity.requests.map((request) => (
              <article key={request.id} className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-900">{request.status.replaceAll("_", " ")}</span>
                  <span>{new Date(request.receivedAt).toLocaleString()}</span>
                </div>
                <p className="mt-2 break-all"><span className="font-semibold">Request:</span> {request.requestId}</p>
                <p className="mt-1 break-all"><span className="font-semibold">Actual source:</span> {request.sourceAgentAddress}</p>
                <p className="mt-1"><span className="font-semibold">Transport:</span> {request.transport === "ASI_ONE_ACP" ? "ASI:One · AgentChatProtocol" : "typed uAgent A2A"}</p>
                <p className="mt-1"><span className="font-semibold">Linked run:</span> {request.agentRunId ?? "not linked"} · {request.runStatus ?? "unknown"}</p>
                <p className="mt-1"><span className="font-semibold">Outcome:</span> {request.outcomeCode ?? "pending"}{request.resultProvider ? ` · ${request.resultProvider}` : ""}</p>
                <p className="mt-1"><span className="font-semibold">Last response submitted:</span> {request.lastResponseSubmittedAt ? `${request.lastResponseStatus} · ${new Date(request.lastResponseSubmittedAt).toLocaleString()}` : "not recorded"}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
