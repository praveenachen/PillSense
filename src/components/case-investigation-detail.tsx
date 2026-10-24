"use client";

import { Icon } from "./mobile-ui";
import { reasonLabels, useCaseActions, type CareCaseItem } from "./caregiver-alerts";

function label(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (character) => character.toUpperCase());
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warn" | "ok" }) {
  const style = tone === "warn" ? "bg-[#ff806e]/15 text-[#ffb7ad]" : tone === "ok" ? "bg-pd-ok/15 text-pd-ok" : "bg-white/7 text-pd-muted";
  return <span className={`rounded-full px-2.5 py-1 text-[0.65rem] font-semibold ${style}`}>{children}</span>;
}

export function CaseInvestigationDetail({ item, onBack }: { item: CareCaseItem; onBack: () => void }) {
  const { note, setNote, outcome, setOutcome, busy, error, submit, investigate } = useCaseActions(item);
  const run = item.agentRun;
  const canInvestigate = item.status === "OPEN" && item.syntheticPatient;
  const investigateDisabled = busy || ["PENDING", "RUNNING", "COMPLETED"].includes(item.investigationStatus);
  const sourceLabel = run?.provider === "ANTHROPIC"
    ? `Live Claude${run.model ? ` · ${run.model}` : ""}`
    : run?.provider === "OPENAI"
      ? `Historical OpenAI run${run.model ? ` · ${run.model}` : ""}`
      : run?.provider === "DETERMINISTIC_FALLBACK"
        ? "Non-LLM deterministic fallback"
        : null;

  return (
    <div className="space-y-3 text-pd-text">
      <button type="button" onClick={onBack} className="pd-focus -ml-2 inline-flex min-h-10 items-center gap-1 rounded-full px-2 text-xs font-semibold text-pd-accent-soft"><Icon name="back" size={17} /> All activity</button>

      <section className={`rounded-[1.25rem] border p-4 ${item.status === "OPEN" ? "border-[#ff806e]/25 bg-[linear-gradient(145deg,rgba(255,112,93,.12),rgba(16,21,34,.94))]" : "pd-card"}`}>
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[0.66rem] font-bold uppercase tracking-[0.13em] text-[#ff9d8f]">{reasonLabels[item.triggerReason]}</p><h2 className="mt-2 truncate text-xl font-semibold">{item.medicationName}</h2><p className="mt-1 text-xs text-pd-muted">Due {new Date(item.dueAt).toLocaleString()}</p></div><Badge tone={item.status === "OPEN" ? "warn" : item.status === "RESOLVED" ? "ok" : "neutral"}>{label(item.status)}</Badge></div>
        <p className="mt-4 rounded-2xl bg-white/[0.035] p-3 text-sm leading-6 text-white/80">{item.recommendation}</p>
      </section>

      <section aria-labelledby="investigation-title" className="pd-card p-4">
        <div className="flex items-center justify-between gap-3"><h3 id="investigation-title" className="text-sm font-semibold">Investigation</h3><Badge>{label(item.investigationStatus)}</Badge></div>
        <p className="mt-2 text-xs leading-5 text-pd-muted">The coordinator reads case-scoped evidence only. It cannot dispense or change medication instructions.</p>
        {canInvestigate ? <button type="button" disabled={investigateDisabled} onClick={investigate} className="pd-focus pd-press mt-3 min-h-11 w-full rounded-full bg-pd-accent px-5 text-sm font-semibold disabled:opacity-50">{busy && !run?.findings ? "Requesting…" : item.investigationStatus === "FAILED" ? "Retry investigation" : "Investigate with AI"}</button> : <p className="mt-3 rounded-2xl bg-white/[0.035] p-3 text-xs leading-5 text-pd-muted">{item.syntheticPatient ? "Investigations can be requested while a case is open." : "AI investigations are limited to synthetic demo patients."}</p>}
        {sourceLabel && <p className="mt-3 text-xs font-semibold text-pd-accent-soft">Result source: {sourceLabel}</p>}
        {run?.findings && <div className="mt-3 space-y-3 border-t border-white/8 pt-3">
          <p className="text-sm font-semibold leading-6">{run.findings.overallSummary}</p>
          <ul className="space-y-2">{run.findings.items.map((finding, index) => <li key={`${finding.category}:${index}`} className="rounded-2xl bg-white/[0.035] p-3 text-sm"><div className="flex items-center justify-between gap-2"><span className="font-semibold">{label(finding.category)}</span><Badge tone={finding.uncertainty === "HIGH" ? "warn" : finding.uncertainty === "LOW" ? "ok" : "neutral"}>{label(finding.uncertainty)} uncertainty</Badge></div><p className="mt-2 leading-6 text-white/75">{finding.explanation}</p></li>)}</ul>
          <p className="rounded-2xl bg-pd-accent/10 p-3 text-sm leading-6"><span className="font-semibold">Proposed follow-up:</span> {label(run.findings.proposedFollowUp.actionType)} — {run.findings.proposedFollowUp.explanation}</p>
        </div>}
        {run?.failureCode && <p className="mt-3 rounded-2xl bg-[#ffb547]/10 p-3 text-xs text-[#ffd28b]">The worker failed safely. The deterministic alert remains active.</p>}
      </section>

      {item.status !== "RESOLVED" && <section aria-labelledby="followup-title" className="pd-card p-4">
        <h3 id="followup-title" className="text-sm font-semibold">Caregiver follow-up</h3>
        <label className="mt-3 block text-xs font-medium text-pd-muted">Note<input className="mt-1.5 min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.045] px-3 text-sm text-white outline-none placeholder:text-pd-muted/60 focus:border-pd-accent" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="What was reviewed or confirmed?" /></label>
        <label className="mt-3 block text-xs font-medium text-pd-muted">Outcome<select className="mt-1.5 min-h-11 w-full rounded-xl border border-white/10 bg-[#171d2c] px-3 text-sm text-white outline-none focus:border-pd-accent" value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="FOLLOW_UP_REQUIRED">Follow-up required</option><option value="CONTACTED_PATIENT">Contacted patient</option><option value="DEVICE_REVIEW">Device review</option><option value="NO_FURTHER_ACTION">No further action</option><option value="OTHER">Other</option></select></label>
        <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={busy || !note.trim() || item.status === "ACKNOWLEDGED"} onClick={() => submit("ACKNOWLEDGE")} className="pd-focus min-h-11 rounded-full bg-pd-accent px-3 text-xs font-semibold disabled:opacity-45">{item.status === "ACKNOWLEDGED" ? "Acknowledged" : "Acknowledge"}</button><button type="button" disabled={busy || !note.trim()} onClick={() => submit("RESOLVE")} className="pd-focus min-h-11 rounded-full border border-white/10 px-3 text-xs font-semibold disabled:opacity-45">Resolve case</button></div>
        {!note.trim() && <p className="mt-2 text-[0.68rem] text-pd-muted">Add a note to enable a follow-up action.</p>}
      </section>}

      {item.resolutionNote && <p className="pd-card p-4 text-sm leading-6 text-white/75"><span className="font-semibold text-white">Latest note:</span> {item.resolutionNote}{item.resolutionOutcome ? ` (${label(item.resolutionOutcome)})` : ""}</p>}
      {error && <p role="alert" className="rounded-2xl bg-[#ff806e]/15 p-3 text-sm text-[#ffb7ad]">{error}</p>}

      <details className="pd-card p-4 text-sm">
        <summary className="pd-focus flex min-h-10 cursor-pointer items-center font-semibold">Technical evidence and audit</summary>
        <p className="mt-2 text-xs leading-5 text-pd-muted">Motor completion does not confirm release, collection, or ingestion. These references are shown only for technical review.</p>
        <dl className="mt-3 space-y-2 text-xs text-pd-muted"><div><dt>Patient report</dt><dd className="break-all text-white/75">{label(item.evidenceReferences.patientReport)}</dd></div><div><dt>Command reference</dt><dd className="break-all text-white/75">{item.evidenceReferences.commandId ?? "None recorded"}</dd></div><div><dt>Device event references</dt><dd className="break-all text-white/75">{item.evidenceReferences.deviceEventIds.join(", ") || "None recorded"}</dd></div></dl>
        <ul className="mt-4 space-y-2 border-t border-white/8 pt-3 text-xs text-pd-muted">{item.transitions.map((transition, index) => <li key={`${transition.occurredAt}:${index}`}>{new Date(transition.occurredAt).toLocaleString()} · {label(transition.type)} → {label(transition.toStatus)}{transition.note ? ` · ${transition.note}` : ""}</li>)}</ul>
      </details>
    </div>
  );
}
