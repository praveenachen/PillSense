"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { AuthRequired } from "./auth-required";
import { WalgreensRefillControls } from "./walgreens-refill-controls";

const messageFor = (error: unknown) => error instanceof Error ? error.message : "The refill action could not be recorded.";

export function CaregiverRefills({ showDeveloperControls = false }: { showDeveloperControls?: boolean } = {}) {
  const auth = useConvexAuth();
  if (auth.isLoading) return <Card>Loading refill forecasts…</Card>;
  if (!auth.isAuthenticated) return <AuthRequired message="Refill forecasts are private and require an authenticated Convex session." />;
  return <AuthenticatedRefills showDeveloperControls={showDeveloperControls} />;
}

function AuthenticatedRefills({ showDeveloperControls }: { showDeveloperControls: boolean }) {
  const result = useQuery(api.refills.listForCaregiver);
  const reconcile = useMutation(api.refills.reconcileMine);
  const adjust = useMutation(api.refills.adjustVerifiedSupply);
  const transition = useMutation(api.refills.transition);
  const updateThreshold = useMutation(api.refills.updateThreshold);
  const runDemo = useMutation(api.refills.runLowSupplyDemo);
  const resetDemo = useMutation(api.refills.resetLowSupplyDemo);
  const investigate = useMutation(api.agentRuns.requestRefillInvestigation);
  const preauthorizeRefill = useMutation(api.agentverse.preauthorizeRefillCase);
  const runs = useQuery(api.agentRuns.listForCaregiver);
  const agentverse = useQuery(api.agentverse.listForCaregiver);
  const reconciled = useRef(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (!reconciled.current) { reconciled.current = true; void reconcile({}).catch(() => undefined); } }, [reconcile]);
  if (result === undefined) return <Card>Listening for supply and schedule changes…</Card>;
  if (result.status !== "ready") return <Card>Caregiver access is required.</Card>;
  async function act(key: string, operation: () => Promise<unknown>, success: string) {
    setBusy(key); setMessage(null);
    try { await operation(); setMessage(success); } catch (error) { setMessage(messageFor(error)); } finally { setBusy(null); }
  }
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold text-teal-700">Refill support · caregiver verified</p><h2 className="mt-1 text-2xl font-semibold">Supply forecasts for {result.patientName}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Counts are caregiver-entered, not sensor verified. Forecasts assume each scheduled dose consumes one unit and never change medication or dispensing records.</p></div>
      <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); const days = Number(new FormData(event.currentTarget).get("days")); void act("threshold", () => updateThreshold({ patientId: result.patientId, days }), "Low-supply threshold updated."); }}><label className="text-xs font-semibold text-slate-600">Alert threshold (days)<input name="days" type="number" min="1" max="30" defaultValue={result.lowSupplyThresholdDays} className="input mt-1 w-24" /></label><button disabled={busy === "threshold"} className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white">Save</button></form></div>
    {showDeveloperControls && <div className="mt-5 flex flex-wrap gap-2 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm"><strong className="w-full text-violet-950">Synthetic low-supply demo</strong><span className="w-full text-violet-800">Temporarily sets Slot 6 (or the first medication) to 2 synthetic units. Reset restores prior supply metadata and retains audit history.</span><button onClick={() => void act("demo", () => runDemo({}), "Synthetic low-supply case is ready.")} disabled={busy !== null} className="rounded-full bg-violet-700 px-4 py-2 font-semibold text-white">Run low-supply demo</button><button onClick={() => void act("reset", () => resetDemo({}), "Synthetic refill demo reset; history retained.")} disabled={busy !== null} className="rounded-full border border-violet-300 bg-white px-4 py-2 font-semibold text-violet-800">Reset demo</button></div>}
    {message && <p role="status" className="mt-4 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{message}</p>}
    <div className="mt-5 grid gap-4 lg:grid-cols-2">{result.cases.map((row) => { const refillCase = row.refillCase; const key = String(row.assignmentId); const run = refillCase && runs?.status === "ready" ? runs.runs.find((item) => item.workflowType === "REFILL_INVESTIGATION" && item.careCaseId === refillCase._id) : null; const scope = refillCase && agentverse?.status === "ready" ? agentverse.scopes.find((item) => item.refillCaseId === refillCase._id && item.caseVersion === refillCase.caseVersion && item.status === "ACTIVE") : null; return <article key={key} className={`rounded-2xl border p-5 ${row.forecast.triggerReason ? "border-amber-300 bg-amber-50" : "border-slate-200"}`}>
      <div className="flex justify-between gap-3"><div><h3 className="font-semibold">{row.medicationName}</h3><p className="text-xs text-slate-500">Slot {row.slot} · hardware demo inventory remains {row.demoInventory}</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-bold">{row.forecast.confidence}</span></div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Entered supply</dt><dd className="font-semibold">{row.supplyCount ?? "Unknown"}</dd></div><div><dt className="text-slate-500">Estimated days</dt><dd className="font-semibold">{row.forecast.estimatedDaysRemaining ?? "Unknown"}</dd></div><div><dt className="text-slate-500">Low-supply date</dt><dd className="font-semibold">{row.forecast.expectedLowSupplyAt ? new Date(row.forecast.expectedLowSupplyAt).toLocaleString() : "Not within horizon"}</dd></div><div><dt className="text-slate-500">Case state</dt><dd className="font-semibold">{refillCase?.status ?? "No active alert"}</dd></div></dl>
      {refillCase && <p className="mt-2 text-xs text-slate-600">Investigation: <strong>{refillCase.investigationStatus.replaceAll("_", " ")}</strong> · {refillCase.triggerReason.replaceAll("_", " ")}</p>}
      {run && <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700"><p className="font-semibold">Coordinator run: {run.status.replaceAll("_", " ")}{run.provider ? ` · ${run.provider === "ANTHROPIC" ? "Live Claude" : "Deterministic fallback"}` : ""}</p>{run.findings?.overallSummary && <p className="mt-1">{run.findings.overallSummary}</p>}{run.findings?.proposedFollowUp && <p className="mt-1">Suggested follow-up: {run.findings.proposedFollowUp.explanation}</p>}</div>}
      {row.forecast.uncertaintyReasons.length > 0 && <p className="mt-3 text-xs text-amber-900">Uncertainty: {row.forecast.uncertaintyReasons.join(", ").replaceAll("_", " ")}</p>}
      <div className="mt-4 flex flex-wrap gap-2"><input aria-label={`Verified supply for ${row.medicationName}`} type="number" min="0" max="10000" value={counts[key] ?? String(row.supplyCount ?? "")} onChange={(event) => setCounts((current) => ({ ...current, [key]: event.target.value }))} placeholder="Count" className="input w-28" /><button disabled={busy !== null || (counts[key] ?? String(row.supplyCount ?? "")) === ""} onClick={() => void act(key, () => adjust({ assignmentId: row.assignmentId, count: Number(counts[key] ?? row.supplyCount) }), "Verified supply recorded.")} className="rounded-full bg-teal-700 px-3 py-2 text-xs font-semibold text-white">Save verified supply</button></div>
      {refillCase && ["OPEN", "REVIEWED", "REFILL_REQUESTED"].includes(refillCase.status) && <div className="mt-3 flex flex-wrap gap-2">{refillCase.status === "OPEN" && <button onClick={() => void act(`review:${key}`, () => transition({ refillCaseId: refillCase._id, action: "REVIEW" }), "Case reviewed.")} className="rounded-full border px-3 py-2 text-xs font-semibold">Mark reviewed</button>}{refillCase.status === "REVIEWED" && <button onClick={() => void act(`request:${key}`, () => transition({ refillCaseId: refillCase._id, action: "REQUEST_REFILL" }), "Refill request recorded; no order was placed.")} className="rounded-full border px-3 py-2 text-xs font-semibold">Record refill requested</button>}{refillCase.status === "REFILL_REQUESTED" && <button onClick={() => void act(`receive:${key}`, () => transition({ refillCaseId: refillCase._id, action: "RECEIVE_REFILL", receivedCount: Number(counts[key] ?? row.supplyCount) }), "Refill receipt and verified supply recorded.")} className="rounded-full border px-3 py-2 text-xs font-semibold">Record refill received</button>}<button onClick={() => void act(`ai:${key}`, () => investigate({ refillCaseId: refillCase._id }), "Refill investigation queued.")} className="rounded-full bg-sky-700 px-3 py-2 text-xs font-semibold text-white">Investigate with AI</button></div>}
      {refillCase && ["OPEN", "REVIEWED", "REFILL_REQUESTED"].includes(refillCase.status) && <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs"><p className="font-semibold text-violet-950">Fetch.ai synthetic refill status</p><p className="mt-1 text-violet-800">Authorize an opaque alias for the existing Agentverse request path. The external agent cannot approve checkout.</p><button type="button" disabled={busy !== null} onClick={() => void act(`scope:${key}`, () => preauthorizeRefill({ refillCaseId: refillCase._id }), "Fetch.ai refill case alias authorized.")} className="mt-2 rounded-full border border-violet-400 bg-white px-3 py-2 font-semibold text-violet-900 disabled:opacity-50">Authorize Fetch.ai demo</button>{scope && <p className="mt-2 break-all font-mono text-violet-950">Alias: {scope.alias}</p>}</div>}
      {refillCase && ["OPEN", "REVIEWED", "REFILL_REQUESTED"].includes(refillCase.status) && <WalgreensRefillControls tone="light" caseId={refillCase._id} eligible={refillCase.status === "REFILL_REQUESTED" && refillCase.investigationStatus === "COMPLETED" && refillCase.triggerReason === "LOW_SUPPLY" && refillCase.estimatedSupplyCount !== null} />}
    </article>; })}</div>
  </section>;
}

function Card({ children }: { children: React.ReactNode }) { return <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">{children}</section>; }
