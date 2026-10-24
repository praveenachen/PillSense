"use client";

import { Icon, StatusPill, type PillTone } from "./mobile-ui";
import { reasonLabels, useCaseActions, type CareCaseItem } from "./caregiver-alerts";

const uncertaintyTone: Record<"LOW" | "MEDIUM" | "HIGH", PillTone> = { LOW: "green", MEDIUM: "amber", HIGH: "coral" };

function label(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function CaseInvestigationDetail({ item, onBack }: { item: CareCaseItem; onBack: () => void }) {
  const { note, setNote, outcome, setOutcome, busy, error, submit, investigate } = useCaseActions(item);
  const run = item.agentRun;
  const canInvestigate = item.status === "OPEN" && item.syntheticPatient;
  const investigateDisabled = busy || item.investigationStatus === "PENDING" || item.investigationStatus === "RUNNING" || item.investigationStatus === "COMPLETED";
  const sourceLabel = run?.provider === "ANTHROPIC"
    ? `Live Claude${run.model ? ` · ${run.model}` : ""}`
    : run?.provider === "OPENAI"
      ? `Historical OpenAI run${run.model ? ` · ${run.model}` : ""}`
      : run?.provider === "DETERMINISTIC_FALLBACK"
        ? "Non-LLM deterministic fallback"
        : null;
  const evidenceRows: Array<[string, string]> = [
    ["Patient report", label(item.evidenceReferences.patientReport)],
    ["Command", item.evidenceReferences.commandId ?? "none recorded"],
    ["Device events", item.evidenceReferences.deviceEventIds.join(", ") || "none recorded"],
    ["Demo scenario", item.evidenceReferences.demoScenarioRunId ?? "none"],
  ];

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="ps-focus -ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm font-semibold text-[#0f766e]">
        <Icon name="back" size={18} /> All cases
      </button>

      <section className={`rounded-[1.25rem] border p-4 ${item.status === "OPEN" ? "border-[#f3c9c9] bg-gradient-to-b from-[#fff3f2] to-white" : "ps-card"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-[#a32020]">{reasonLabels[item.triggerReason]}</p>
            <h2 className="ps-display mt-1 text-[1.4rem] font-semibold leading-tight text-[#0f172a]">{item.medicationName}</h2>
            <p className="mt-1 text-sm text-[#475569]">Due {new Date(item.dueAt).toLocaleString()}</p>
          </div>
          <StatusPill tone={item.status === "OPEN" ? "coral" : item.status === "ACKNOWLEDGED" ? "amber" : "green"}>{label(item.status)}</StatusPill>
        </div>
        <p className="mt-3 rounded-2xl bg-white/80 p-3 text-sm leading-6 text-[#1e293b]">{item.recommendation}</p>
        <p className="mt-2 text-xs text-[#64748b]">Case {item.caseId} · v{item.caseVersion}</p>
      </section>

      <section aria-labelledby="evidence-title" className="ps-card p-4">
        <h3 id="evidence-title" className="text-sm font-semibold text-[#0f172a]">Evidence on record</h3>
        <dl className="mt-2 divide-y divide-[#e6eef6] text-sm">
          {evidenceRows.map(([term, value]) => (
            <div key={term} className="flex justify-between gap-4 py-2"><dt className="shrink-0 text-[#64748b]">{term}</dt><dd className="min-w-0 break-all text-right font-medium text-[#0f172a]">{value}</dd></div>
          ))}
        </dl>
        <p className="mt-2 text-xs leading-5 text-[#64748b]">Motor completion never confirms release, collection or ingestion. A device fault is only stated when a recorded event supports it.</p>
      </section>

      <section aria-labelledby="investigation-title" className="ps-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 id="investigation-title" className="text-sm font-semibold text-[#0f172a]">Evidence-first investigation</h3>
          <StatusPill tone="mist">{label(item.investigationStatus)}</StatusPill>
        </div>
        <p className="mt-1 text-xs leading-5 text-[#64748b]">The coordinator can read case evidence only. It cannot dispense or change medication instructions.</p>
        {canInvestigate ? (
          <button type="button" disabled={investigateDisabled} onClick={investigate} className="ps-cta mt-3 min-h-11 w-full rounded-full px-5 text-sm font-semibold">
            {busy && !run?.findings ? "Requesting…" : item.investigationStatus === "FAILED" ? "Retry investigation" : "Investigate with AI"}
          </button>
        ) : (
          <p className="mt-3 rounded-2xl bg-[#f1f7fd] p-3 text-xs leading-5 text-[#475569]">
            {item.syntheticPatient ? "Investigations can be requested while a case is open." : "AI investigations are only available for synthetic demo patients."}
          </p>
        )}
        {sourceLabel && <p className="mt-3 text-xs font-semibold text-[#1e4f8a]">Result source: {sourceLabel}</p>}
        {run?.findings && (
          <div className="mt-3 space-y-3 border-t border-[#e6eef6] pt-3">
            <p className="text-sm font-semibold leading-6 text-[#0f172a]">{run.findings.overallSummary}</p>
            <ul className="space-y-2">
              {run.findings.items.map((finding, index) => (
                <li key={`${finding.category}:${index}`} className="rounded-2xl bg-[#f8fbff] p-3 text-sm">
                  <div className="flex items-center justify-between gap-2"><span className="font-semibold text-[#0f172a]">{label(finding.category)}</span><StatusPill tone={uncertaintyTone[finding.uncertainty]}>{label(finding.uncertainty)} uncertainty</StatusPill></div>
                  <p className="mt-1 leading-6 text-[#334155]">{finding.explanation}</p>
                  {finding.evidenceReferences.length > 0 && <p className="mt-1 break-all text-xs text-[#64748b]">Evidence: {finding.evidenceReferences.join(", ")}</p>}
                </li>
              ))}
            </ul>
            <p className="rounded-2xl bg-[#e3efff]/70 p-3 text-sm leading-6 text-[#0f172a]"><span className="font-semibold">Proposed follow-up:</span> {label(run.findings.proposedFollowUp.actionType)} — {run.findings.proposedFollowUp.explanation}</p>
          </div>
        )}
        {run?.failureCode && <p className="mt-3 rounded-2xl bg-[#fff8e6] p-3 text-xs text-[#8a5a00]">Worker failed safely: {run.failureCode}. The deterministic alert remains active.</p>}
      </section>

      {item.status !== "RESOLVED" && (
        <section aria-labelledby="followup-title" className="ps-card ps-legacy-scope p-4">
          <h3 id="followup-title" className="text-sm font-semibold text-[#0f172a]">Human follow-up</h3>
          <label className="mt-2 block text-sm font-medium text-[#334155]">
            Note
            <input className="input mt-1" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="What was reviewed or confirmed?" />
          </label>
          <label className="mt-3 block text-sm font-medium text-[#334155]">
            Outcome
            <select className="input mt-1" value={outcome} onChange={(event) => setOutcome(event.target.value)}>
              <option value="FOLLOW_UP_REQUIRED">Follow-up required</option>
              <option value="CONTACTED_PATIENT">Contacted patient</option>
              <option value="DEVICE_REVIEW">Device review</option>
              <option value="NO_FURTHER_ACTION">No further action</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={busy || !note.trim() || item.status === "ACKNOWLEDGED"} onClick={() => submit("ACKNOWLEDGE")} className="ps-cta min-h-11 flex-1 rounded-full px-4 text-sm font-semibold">{item.status === "ACKNOWLEDGED" ? "Acknowledged" : "Acknowledge"}</button>
            <button type="button" disabled={busy || !note.trim()} onClick={() => submit("RESOLVE")} className="ps-focus min-h-11 flex-1 rounded-full border border-[#cbd5e1] bg-white px-4 text-sm font-semibold text-[#334155] disabled:opacity-50">Resolve case</button>
          </div>
          {!note.trim() && <p className="mt-2 text-xs text-[#64748b]">Add a note to enable Acknowledge or Resolve.</p>}
        </section>
      )}
      {item.resolutionNote && <p className="ps-card p-4 text-sm text-[#475569]"><span className="font-semibold text-[#0f172a]">Latest note:</span> {item.resolutionNote}{item.resolutionOutcome ? ` (${label(item.resolutionOutcome)})` : ""}</p>}
      {error && <p role="alert" className="rounded-2xl bg-[#fde4e4] p-3 text-sm text-[#8f1d1d]">{error}</p>}

      <details className="ps-card p-4 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-[#0f172a]">Audit trail ({item.transitions.length})</summary>
        <ul className="mt-1 space-y-2 text-xs text-[#475569]">
          {item.transitions.map((transition, index) => (
            <li key={`${transition.occurredAt}:${index}`}>{new Date(transition.occurredAt).toLocaleString()} · {transition.type} → {transition.toStatus}{transition.note ? ` · ${transition.note}` : ""}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
