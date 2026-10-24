"use client";

import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { AuthRequired } from "./auth-required";
import { reasonLabels, type CareCaseItem } from "./caregiver-alerts";
import { CaregiverDeviceIssues } from "./caregiver-device-issues";
import { CaseInvestigationDetail } from "./case-investigation-detail";
import { Avatar, Icon, SectionTitle, StatusPill, type IconName } from "./mobile-ui";

type CareTab = "overview" | "investigations" | "medications";
const tabs: Array<{ id: CareTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "investigations", label: "Investigations" },
  { id: "medications", label: "Medications" },
];

export function DemoCarePanel() {
  const auth = useConvexAuth();
  const setup = useQuery(api.caregiver.setup, auth.isAuthenticated ? {} : "skip");

  if (auth.isLoading) {
    return <CareState title="Checking caregiver access…">Confirming the Clerk and Convex session.</CareState>;
  }
  if (!auth.isAuthenticated) {
    return <AuthRequired message="Caregiver content is private and requires an authenticated Convex session." />;
  }
  if (setup === undefined) {
    return <CareState title="Loading care workspace…">Checking the authenticated caregiver role.</CareState>;
  }
  if (setup.status !== "ready") {
    return (
      <CareState title="Caregiver access required">
        This mobile preview does not grant or infer caregiver access. Use the protected caregiver
        workspace for explicit synthetic onboarding.
      </CareState>
    );
  }
  return <AuthorizedCare patientName={setup.patient.displayName} medications={setup.medications} />;
}

type SetupMedication = { medicationId: string; name: string; slot: number; localTime: string | null; demoInventory: number; instructions: string | null };

function AuthorizedCare({ patientName, medications }: { patientName: string; medications: SetupMedication[] }) {
  const [tab, setTab] = useState<CareTab>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const cases = useQuery(api.careCases.listForCaregiver);
  const issues = useQuery(api.deviceIssues.listForCaregiver);
  const activity = useQuery(api.activity.latestForCaregiver);

  if (cases === undefined) return <CareState title="Loading care cases…">Reading server-authorized alerts.</CareState>;
  const caseList: CareCaseItem[] = cases.status === "ready" ? cases.cases : [];
  const selected = selectedId ? caseList.find((item) => item.id === selectedId) ?? null : null;
  const open = caseList.filter((item) => item.status === "OPEN");
  const acknowledged = caseList.filter((item) => item.status === "ACKNOWLEDGED");
  const focus = open[0] ?? acknowledged[0] ?? null;
  const issueList = issues?.status === "ready" ? issues.issues : [];
  const dispenseList = activity?.status === "ready" ? activity.activity : [];

  type FeedItem = { key: string; at: number; icon: IconName; tone: "coral" | "teal" | "mist"; title: string; detail: string; caseId?: string };
  const feed: FeedItem[] = [
    ...caseList.map((item): FeedItem => ({ key: `case:${item.id}`, at: item.updatedAt, icon: "alert", tone: item.status === "OPEN" ? "coral" : "teal", title: reasonLabels[item.triggerReason], detail: `${item.medicationName} · ${item.status.toLowerCase()}`, caseId: item.id })),
    ...issueList.map((issue): FeedItem => ({ key: `issue:${issue._id}`, at: issue.createdAt, icon: "chat", tone: "mist", title: "Patient reported a device issue", detail: `“${issue.transcript}”` })),
    ...dispenseList.map((item): FeedItem => ({ key: `dispense:${item.commandId}`, at: item.updatedAt, icon: "pill", tone: item.requiresReview ? "coral" : "teal", title: `${item.medicationName} · simulated dispense`, detail: `Motor: ${String(item.motorCompletion).toLowerCase()} · ingestion not verified` })),
  ].sort((a, b) => b.at - a.at).slice(0, 5);

  function openCase(id: string) { setTab("investigations"); setSelectedId(id); }

  return (
    <div className="space-y-3">
      <section className="ps-card flex items-center gap-3 px-3 py-2.5">
        <Avatar name={patientName} size={42} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.95rem] font-semibold text-[#0f172a]">{patientName}</p>
          <p className="text-xs text-[#64748b]">{cases.status === "ready" && caseList.length > 0 ? "Authorized care relationship" : "Authorized care relationship · no unresolved cases"}</p>
        </div>
      </section>

      <div role="tablist" aria-label="Care sections" className="grid grid-cols-3 border-b border-[#dbe7f3]/80">
        {tabs.map((item) => (
          <button key={item.id} type="button" role="tab" id={`care-tab-${item.id}`} aria-selected={tab === item.id} aria-controls="care-tabpanel" onClick={() => { setTab(item.id); setSelectedId(null); }} className={`ps-focus min-h-11 border-b-2 text-[0.8rem] ${tab === item.id ? "border-[#0f766e] font-semibold text-[#0f172a]" : "border-transparent font-medium text-[#64748b]"}`}>
            {item.label}
          </button>
        ))}
      </div>

      <div id="care-tabpanel" role="tabpanel" aria-labelledby={`care-tab-${tab}`} className="space-y-3">
        {tab === "overview" && (
          <>
            {focus ? (
              <section aria-labelledby="attention-title" className={`rounded-2xl border p-3.5 ${focus.status === "OPEN" ? "border-[#f6d3d3] bg-gradient-to-b from-[#fff4f3] to-white" : "ps-card"}`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 id="attention-title" className="flex items-center gap-2 text-sm font-semibold text-[#a32020]"><span aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-[#ef4444] text-white"><Icon name="alert" size={15} strokeWidth={2.2} /></span>{focus.status === "OPEN" ? "Needs attention" : "Acknowledged"}</h3>
                  <StatusPill tone={focus.status === "OPEN" ? "coral" : "amber"}>{focus.status === "OPEN" ? "Unresolved" : "In follow-up"}</StatusPill>
                </div>
                <p className="ps-display mt-2.5 text-[1.05rem] font-bold leading-tight text-[#0f172a]">{reasonLabels[focus.triggerReason]}</p>
                <p className="mt-0.5 text-sm text-[#475569]">{focus.medicationName} · due {new Date(focus.dueAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                <p className="mt-1.5 text-[0.82rem] leading-5 text-[#334155]">{focus.recommendation}</p>
                <button type="button" onClick={() => openCase(focus.id)} className="ps-cta-danger ps-focus mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-full px-5 text-[0.95rem] font-semibold">
                  View investigation <Icon name="arrow" size={18} />
                </button>
              </section>
            ) : (
              <section className="ps-card p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-[#0f766e]"><Icon name="shield" size={18} /> No unresolved care cases</p>
                <p className="mt-1 text-sm leading-6 text-[#475569]">New cases appear here when a dose has no patient response, a motor outcome is unknown, or a device issue is reported.</p>
              </section>
            )}

            <section aria-label="Case summary" className="ps-card grid grid-cols-3 divide-x divide-[#e6eef6] py-2.5 text-center">
              <Stat value={open.length} label="Unresolved cases" tone={open.length > 0 ? "text-[#c92a2a]" : "text-[#0f766e]"} />
              <Stat value={acknowledged.length} label="In follow-up" tone="text-[#8a5a00]" />
              <Stat value={issueList.length} label="Device reports" tone="text-[#1e4f8a]" />
            </section>

            <section aria-labelledby="care-activity-title" className="space-y-1.5">
              <SectionTitle><span id="care-activity-title">Recent activity</span></SectionTitle>
              {feed.length === 0 ? (
                <p className="ps-card p-4 text-sm text-[#475569]">No recent care activity.</p>
              ) : (
                <ul className="ps-card divide-y divide-[#e6eef6]">
                  {feed.map((entry) => {
                    const body = (
                      <>
                        <span aria-hidden="true" className={`grid size-8 shrink-0 place-items-center rounded-full ${entry.tone === "coral" ? "bg-[#fde4e4] text-[#b42323]" : entry.tone === "teal" ? "bg-[#d9f5ef] text-[#0f766e]" : "bg-[#e3efff] text-[#1e4f8a]"}`}><Icon name={entry.icon} size={17} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[0.7rem] text-[#64748b]">{new Date(entry.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                          <span className="block truncate text-sm font-semibold text-[#0f172a]">{entry.title}</span>
                          <span className="block truncate text-xs text-[#64748b]">{entry.detail}</span>
                        </span>
                        {entry.caseId && <Icon name="chevron" size={16} className="shrink-0 text-[#94a3b8]" />}
                      </>
                    );
                    return (
                      <li key={entry.key}>
                        {entry.caseId
                          ? <button type="button" onClick={() => openCase(entry.caseId!)} className="ps-focus flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left">{body}</button>
                          : <div className="flex min-h-14 items-center gap-3 px-3 py-2">{body}</div>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}

        {tab === "investigations" && (selected
          ? <CaseInvestigationDetail key={selected.id} item={selected} onBack={() => setSelectedId(null)} />
          : (
            <>
              {caseList.length === 0 ? (
                <p className="ps-card p-4 text-sm leading-6 text-[#475569]">No care cases to investigate.</p>
              ) : (
                <ul className="ps-card divide-y divide-[#e6eef6]">
                  {caseList.map((item) => (
                    <li key={item.id}>
                      <button type="button" onClick={() => setSelectedId(item.id)} className="ps-focus flex min-h-16 w-full items-center gap-3 p-3 text-left">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-[#0f172a]">{reasonLabels[item.triggerReason]}</span>
                          <span className="block truncate text-xs text-[#64748b]">{item.medicationName} · investigation {item.investigationStatus.replaceAll("_", " ").toLowerCase()}</span>
                        </span>
                        <StatusPill tone={item.status === "OPEN" ? "coral" : item.status === "ACKNOWLEDGED" ? "amber" : "green"}>{item.status.charAt(0) + item.status.slice(1).toLowerCase()}</StatusPill>
                        <Icon name="chevron" size={16} className="shrink-0 text-[#94a3b8]" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <CaregiverDeviceIssues />
              <Link href="/agent-activity" className="ps-card ps-focus flex min-h-12 items-center justify-between px-4 text-sm font-semibold text-[#0f766e]">Open full agent activity <Icon name="chevron" size={16} /></Link>
            </>
          ))}

        {tab === "medications" && (
          <>
            {medications.length === 0 ? (
              <p className="ps-card p-4 text-sm leading-6 text-[#475569]">No medications are assigned yet.</p>
            ) : (
              <ul className="ps-card divide-y divide-[#e6eef6]">
                {medications.map((m) => (
                  <li key={m.medicationId} className="flex items-center gap-3 p-3">
                    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-[#d9f5ef] text-sm font-bold text-[#0f766e]">{m.slot}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[#0f172a]">{m.name}</span><span className="block text-xs text-[#64748b]">{m.localTime ?? "Unscheduled"} · demo inventory {m.demoInventory} inert {m.demoInventory === 1 ? "pill" : "pills"}</span></span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/caregiver" className="ps-cta flex min-h-12 items-center justify-center rounded-full px-5 text-sm font-semibold">Manage medication setup</Link>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="px-1">
      <p className={`ps-display text-[1.45rem] font-bold leading-none ${tone}`}>{value}</p>
      <p className="mt-1 text-xs leading-4 text-[#64748b]">{label}</p>
    </div>
  );
}

function CareState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ps-card p-5">
      <h2 className="ps-display text-xl font-semibold text-[#0f172a]">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[#475569]">{children}</p>
      <Link href="/caregiver" className="ps-focus mt-4 inline-flex min-h-11 items-center rounded-full border border-[#cbd5e1] px-4 text-sm font-semibold text-[#0f172a]">
        Open protected caregiver route
      </Link>
    </section>
  );
}
