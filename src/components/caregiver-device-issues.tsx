"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export function CaregiverDeviceIssues() {
  const auth = useConvexAuth();
  const result = useQuery(api.deviceIssues.listForCaregiver, auth.isAuthenticated ? {} : "skip");
  if (!auth.isAuthenticated || result === undefined || result.status !== "ready" || result.issues.length === 0) return null;
  return <section className="rounded-[1.25rem] border border-[#f3c9c9] bg-[#fff6f5] p-4">
    <p className="text-xs font-bold uppercase tracking-wide text-[#a32020]">Patient-reported device issues</p>
    <h2 className="ps-display mt-1 text-xl font-semibold text-[#0f172a]">Device review needed</h2>
    <p className="mt-2 text-sm text-slate-600">These reports preserve the observed device state. They do not fabricate a motor failure, retry dispensing, or start an AI investigation automatically.</p>
    <div className="mt-4 space-y-3">{result.issues.map((issue) => <article key={issue._id} className="rounded-xl border border-rose-200 bg-white p-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{issue.reportedProblem.replaceAll("_", " ")}</strong><span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white">{issue.status}</span></div><p className="mt-2 text-slate-700">“{issue.transcript}”</p><p className="mt-2 text-xs text-slate-500">Observed state: {issue.observedState} · Connected: {issue.observedConnected === null ? "unknown" : String(issue.observedConnected)} · {new Date(issue.createdAt).toLocaleString()}</p></article>)}</div>
  </section>;
}
