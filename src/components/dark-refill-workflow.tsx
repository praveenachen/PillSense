"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { WalgreensRefillControls } from "./walgreens-refill-controls";
import { Icon } from "./mobile-ui";

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : "The refill action could not be recorded.";
}

/** Full caregiver-authorized refill workflow in the premium dark demo surface. */
export function DarkRefillWorkflow() {
  const result = useQuery(api.refills.listForCaregiver);
  const runs = useQuery(api.agentRuns.listForCaregiver);
  const adjust = useMutation(api.refills.adjustVerifiedSupply);
  const transition = useMutation(api.refills.transition);
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!result || result.status !== "ready") return <section className="pd-card p-4 text-sm text-pd-muted">Loading authorized refill forecasts…</section>;
  const row = [...result.cases].sort((a, b) => (a.forecast.estimatedDaysRemaining ?? 9999) - (b.forecast.estimatedDaysRemaining ?? 9999))[0];
  if (!row) return <section className="pd-card p-4"><h2 className="text-lg font-semibold">Refill status</h2><p className="mt-2 text-sm text-pd-muted">No active medication assignments.</p></section>;
  const refillCase = row.refillCase;
  const run = refillCase && runs?.status === "ready"
    ? runs.runs.find((candidate) => candidate.workflowType === "REFILL_INVESTIGATION" && candidate.careCaseId === refillCase._id)
    : null;
  async function act(operation: () => Promise<unknown>, success: string) {
    setBusy(true); setMessage(null);
    try { await operation(); setMessage(success); } catch (error) { setMessage(messageFor(error)); } finally { setBusy(false); }
  }
  const eligible = Boolean(refillCase && refillCase.status === "REFILL_REQUESTED" && refillCase.investigationStatus === "COMPLETED" && refillCase.triggerReason === "LOW_SUPPLY" && refillCase.estimatedSupplyCount !== null);
  return <section className="pd-card overflow-hidden">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="pd-focus flex min-h-[5rem] w-full items-center gap-3 p-4 text-left">
      <span className="grid size-11 place-items-center rounded-full bg-pd-warn/10 text-pd-warn"><Icon name="pill" size={20} /></span>
      <span className="min-w-0 flex-1"><span className="block text-lg font-semibold">Refill status</span><span className="block truncate text-sm font-semibold">{row.medicationName}</span><span className="text-xs text-pd-warn">{row.forecast.estimatedDaysRemaining === null ? "Supply timing uncertain" : `Estimated ${row.forecast.estimatedDaysRemaining} days left`}</span></span>
      <Icon name="chevron" size={17} className={`text-pd-muted transition ${open ? "rotate-90" : ""}`} />
    </button>
    {open && <div className="space-y-3 border-t border-pd-line p-4">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Metric label="Entered supply" value={row.supplyCount === null ? "Unknown" : String(row.supplyCount)} />
        <Metric label="Confidence" value={row.forecast.confidence} />
        <Metric label="Case state" value={refillCase?.status.replaceAll("_", " ") ?? "No active alert"} />
        <Metric label="Investigation" value={refillCase?.investigationStatus.replaceAll("_", " ") ?? "Not required"} />
      </div>
      {row.forecast.uncertaintyReasons.length > 0 && <p className="text-xs leading-5 text-pd-warn">Uncertainty: {row.forecast.uncertaintyReasons.join(", ").replaceAll("_", " ").toLowerCase()}</p>}
      {run && <div className="rounded-pd-chip border border-pd-line bg-black/20 p-3 text-xs leading-5"><p className="font-semibold">Coordinator · {run.status.replaceAll("_", " ")}{run.provider ? ` · ${run.provider === "ANTHROPIC" ? "Live Claude" : "NON_LLM_FALLBACK"}` : ""}</p>{run.findings?.overallSummary && <p className="mt-1 text-pd-muted">{run.findings.overallSummary}</p>}{run.findings?.proposedFollowUp && <p className="mt-1 text-pd-muted">Follow-up: {run.findings.proposedFollowUp.explanation}</p>}</div>}
      <div className="flex gap-2"><input aria-label="Caregiver-verified supply" type="number" min="0" max="10000" value={count} onChange={(event) => setCount(event.target.value)} placeholder={row.supplyCount === null ? "Count" : String(row.supplyCount)} className="pd-focus min-h-11 min-w-0 flex-1 rounded-full border border-pd-line bg-pd-bg px-4 text-sm" /><button type="button" disabled={busy || !count} onClick={() => void act(() => adjust({ assignmentId: row.assignmentId, count: Number(count), note: "Verified in dark caregiver demo workflow" }), "Verified supply saved. This is caregiver-entered, not sensor verified.")} className="pd-focus rounded-full border border-pd-line px-4 text-xs font-semibold disabled:opacity-40">Verify supply</button></div>
      {refillCase && ["OPEN", "REVIEWED", "REFILL_REQUESTED"].includes(refillCase.status) && <div className="grid gap-2">
        {refillCase.status === "OPEN" && <button type="button" disabled={busy} onClick={() => void act(() => transition({ refillCaseId: refillCase._id, action: "REVIEW" }), "Refill case reviewed.")} className="pd-focus min-h-11 rounded-full bg-pd-accent px-4 text-sm font-semibold text-white">Mark reviewed</button>}
        {refillCase.status === "REVIEWED" && <button type="button" disabled={busy} onClick={() => void act(() => transition({ refillCaseId: refillCase._id, action: "REQUEST_REFILL" }), "Refill request recorded. No pharmacy order was placed.")} className="pd-focus min-h-11 rounded-full bg-pd-accent px-4 text-sm font-semibold text-white">Record refill requested</button>}
        {refillCase.status === "REFILL_REQUESTED" && <p className="text-xs leading-5 text-pd-muted">Physical receipt remains unverified until a caregiver separately records the received supply. Checkout return alone never marks inventory refilled.</p>}
      </div>}
      {message && <p role="status" className="rounded-pd-chip border border-pd-line bg-white/[.03] p-3 text-xs leading-5 text-pd-muted">{message}</p>}
      {refillCase && <WalgreensRefillControls caseId={refillCase._id} eligible={eligible} />}
    </div>}
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-pd-chip border border-pd-line bg-black/15 p-3"><p className="text-pd-muted">{label}</p><p className="mt-1 font-semibold capitalize text-pd-text">{value.toLowerCase()}</p></div>;
}
