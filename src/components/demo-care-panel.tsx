"use client";

import Link from "next/link";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { AuthRequired } from "./auth-required";
import { reasonLabels, type CareCaseItem } from "./caregiver-alerts";
import { CaseInvestigationDetail } from "./case-investigation-detail";
import { DeviceStatusCard, NeedsAttentionCard, RefillStatusCard } from "./care-cards";
import { Icon } from "./mobile-ui";
import { caregiverActivityLabel, caregiverActivityState, caregiverNextAction, dedupeCaregiverActivity, getCareProgress, pickPriorityCase, type CaregiverActivityState } from "@/lib/care-dashboard";

type CareTab = "overview" | "activity";
type SetupMedication = { medicationId: string; name: string; slot: number; localTime: string; demoInventory: number; instructions: string | null };

export function DemoCarePanel({ account }: { account?: ReactNode }) {
  const auth = useConvexAuth();
  const setup = useQuery(api.caregiver.setup, auth.isAuthenticated ? {} : "skip");

  if (auth.isLoading) return <CareShell account={account}><CareState title="Checking access…">Confirming the Clerk and Convex session.</CareState></CareShell>;
  if (!auth.isAuthenticated) return <CareShell account={account}><AuthRequired dark message="Care information is private and requires an authenticated Convex session." /></CareShell>;
  if (setup === undefined) return <CareShell account={account}><CareState title="Loading care workspace…">Checking your server-authorized role and relationships.</CareState></CareShell>;
  if (setup.status === "unauthorized") return <PatientCare account={account} />;
  if (setup.status !== "ready") {
    return <CareShell account={account}><CareState title="Care access restricted">No authorized care relationship is available for this account. The Care tab never grants access by changing a screen or role label.</CareState></CareShell>;
  }
  return <AuthorizedCare account={account} patientName={setup.patient.displayName} medications={setup.medications} />;
}

function CareShell({ account, children }: { account?: ReactNode; children: ReactNode }) {
  return <div className="flex flex-1 flex-col gap-4 text-pd-text"><header className="flex min-h-11 items-center justify-between"><h1 className="text-[1.4rem] font-semibold tracking-tight">Caregiver</h1>{account}</header>{children}</div>;
}

function PatientCare({ account }: { account?: ReactNode }) {
  const dashboard = useQuery(api.patient.dashboard);
  return (
    <CareShell account={account}>
      <div className="pd-card-hero p-5">
        <span className="grid size-10 place-items-center rounded-full bg-pd-accent/15 text-pd-accent-soft"><Icon name="shield" size={20} /></span>
        <h2 className="mt-4 text-lg font-semibold">Caregiver relationships</h2>
        <p className="mt-2 text-sm leading-6 text-pd-muted">Only caregivers linked through an active, server-authorized relationship can view your medication support data.</p>
        <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.025] p-3">
          <p className="text-sm font-medium">{dashboard?.status === "ready" ? dashboard.patientName : "Patient account"}</p>
          <p className="mt-1 text-xs leading-5 text-pd-muted">Caregiver identity details are not exposed by the current patient API. Manage the synthetic demo relationship in the protected caregiver workspace.</p>
        </div>
        <Link href="/caregiver" className="pd-focus pd-press mt-4 flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold">Open care relationship setup</Link>
      </div>
    </CareShell>
  );
}

function AuthorizedCare({ account, patientName, medications }: { account?: ReactNode; patientName: string; medications: SetupMedication[] }) {
  const [tab, setTab] = useState<CareTab>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const ensureShowcase = useMutation(api.demo.ensureDashboardShowcase);
  const showcaseRequested = useRef(false);
  const cases = useQuery(api.careCases.listForCaregiver);
  const issues = useQuery(api.deviceIssues.listForCaregiver);
  const activity = useQuery(api.activity.latestForCaregiver);
  const occurrences = useQuery(api.occurrences.listForPatient, { now });
  const refills = useQuery(api.refills.listForCaregiver);

  useEffect(() => {
    if (showcaseRequested.current) return;
    showcaseRequested.current = true;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    void ensureShowcase({ timezone }).catch(() => undefined);
  }, [ensureShowcase]);

  if (cases === undefined || issues === undefined || activity === undefined || occurrences === undefined || refills === undefined) {
    return <CareShell account={account}><CareState title="Loading care overview…">Listening for authorized case, schedule, and supply updates.</CareState></CareShell>;
  }
  if (cases.status !== "ready" || issues.status !== "ready" || activity.status !== "ready" || refills.status !== "ready") {
    return <CareShell account={account}><CareState title="Care access restricted">Convex did not authorize this account to read the selected patient’s care data.</CareState></CareShell>;
  }

  const caseList: CareCaseItem[] = cases.cases;
  const selected = selectedId ? caseList.find((item) => item.id === selectedId) ?? null : null;
  const focus = pickPriorityCase(caseList);
  const unresolved = caseList.filter((item) => item.status !== "RESOLVED");
  const progress = getCareProgress(occurrences.occurrences, now);
  const refill = [...refills.cases].sort((a, b) => (a.forecast.estimatedDaysRemaining ?? 9999) - (b.forecast.estimatedDaysRemaining ?? 9999))[0] ?? null;
  type FeedItem = { key: string; at: number; title: string; medicationName: string; nextAction: string; state: CaregiverActivityState; caseId?: string };
  const rawFeed: FeedItem[] = [
    ...caseList.map((item): FeedItem => ({
      key: `case:${item.id}`,
      at: item.updatedAt,
      title: item.investigationStatus === "COMPLETED" && item.status !== "RESOLVED" ? "Investigation findings ready" : caregiverCaseTitle(item.triggerReason),
      medicationName: item.medicationName,
      nextAction: caregiverNextAction(item),
      state: caregiverActivityState(item),
      caseId: item.id,
    })),
    ...issues.issues.map((item): FeedItem => ({ key: `issue:${item._id}`, at: item.createdAt, title: "Device issue reported", medicationName: "PillSense dispenser", nextAction: "Review device report", state: "NEEDS_ATTENTION" })),
    ...activity.activity.filter((item) => item.requiresReview).map((item): FeedItem => ({ key: `activity:${item.commandId}`, at: item.updatedAt, title: "Hardware outcome needs review", medicationName: item.medicationName, nextAction: "Review device evidence", state: "NEEDS_ATTENTION" })),
  ].sort((a, b) => b.at - a.at);
  const feed = dedupeCaregiverActivity(rawFeed);

  const openCase = (id: string) => { setTab("activity"); setSelectedId(id); };
  const progressLabel = progress.state === "ON_TRACK" ? "On track" : progress.state === "ACTION_NEEDED" ? "Action needed" : progress.state === "AWAITING_REPORTS" ? "Awaiting reports" : "No doses today";

  return (
    <CareShell account={account}>
      <div role="tablist" aria-label="Care sections" className="grid grid-cols-2 rounded-full border border-white/8 bg-white/[0.035] p-1">
        {(["overview", "activity"] as const).map((id) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setSelectedId(null); }} className={`pd-focus min-h-9 rounded-full text-xs font-semibold capitalize transition ${tab === id ? "bg-white/10 text-white shadow-sm" : "text-pd-muted"}`}>{id}</button>)}
      </div>

      {tab === "overview" && <div className="flex flex-1 flex-col gap-3">
        <section className="pd-card-hero flex flex-1 flex-col justify-center gap-4 p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0"><p className="truncate text-xl font-semibold">{patientName}</p><p className={`mt-1.5 text-sm font-medium ${progress.state === "ACTION_NEEDED" ? "text-[#ffb7ad]" : "text-pd-ok"}`}>{progressLabel}</p><p className="mt-3 text-sm text-pd-muted">{progress.taken} of {progress.total} doses explicitly reported taken</p></div>
            <ProgressRing percent={progress.percent} />
          </div>
        </section>

        {focus ? <NeedsAttentionCard item={focus} count={unresolved.length} onOpen={() => openCase(focus.id)} /> : <section className="pd-card p-4"><h2 className="text-lg font-semibold">Needs attention</h2><p className="mt-3 flex items-center gap-2 text-sm font-semibold text-pd-ok"><Icon name="check" size={18} /> Nothing needs attention</p><p className="mt-2 text-xs leading-5 text-pd-muted">Care cases appear only when recorded evidence needs caregiver follow-up.</p></section>}

        <RefillStatusCard medicationName={refill?.medicationName ?? null} daysLeft={refill?.forecast.estimatedDaysRemaining ?? null} />

        <DeviceStatusCard device={occurrences.device} medicationCount={medications.length} />

      </div>}

      {tab === "activity" && (selected ? <CaseInvestigationDetail item={selected} onBack={() => setSelectedId(null)} /> : <div className="space-y-3">
        {feed.length === 0 ? <section className="pd-card p-4 text-sm text-pd-muted">No care activity yet.</section> : <ul className="pd-card divide-y divide-white/8 overflow-hidden">{feed.map((entry) => <li key={entry.key}>{entry.caseId ? <button type="button" onClick={() => setSelectedId(entry.caseId!)} className="pd-focus flex min-h-[5.5rem] w-full items-center gap-3 px-4 py-3 text-left"><ActivityDot state={entry.state} /><ActivityText entry={entry} /><Icon name="chevron" size={15} className="text-pd-muted" /></button> : <Link href="/caregiver" className="pd-focus flex min-h-[5.5rem] items-center gap-3 px-4 py-3"><ActivityDot state={entry.state} /><ActivityText entry={entry} /><Icon name="chevron" size={15} className="text-pd-muted" /></Link>}</li>)}</ul>}
        {medications.length === 0 && <p className="text-center text-xs text-pd-muted">No active medication assignments.</p>}
      </div>)}
    </CareShell>
  );
}

function ProgressRing({ percent }: { percent: number }) {
  const angle = Math.max(0, Math.min(100, percent)) * 3.6;
  return <div aria-label={`${percent}% reported taken`} className="grid size-24 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(var(--color-pd-ok) ${angle}deg, rgba(255,255,255,.08) 0)` }}><div className="grid size-[4.75rem] place-items-center rounded-full bg-pd-surface text-lg font-bold">{percent}%</div></div>;
}
function ActivityDot({ state }: { state: CaregiverActivityState }) { return <span className={`size-2.5 shrink-0 rounded-full ${state === "NEEDS_ATTENTION" ? "bg-[#ff806e] shadow-[0_0_10px_rgba(255,128,110,.65)]" : state === "IN_PROGRESS" ? "bg-pd-accent shadow-[0_0_10px_rgba(119,116,255,.55)]" : "bg-pd-ok"}`} />; }
function ActivityText({ entry }: { entry: { at: number; title: string; medicationName: string; nextAction: string; state: CaregiverActivityState } }) { return <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{entry.title}</span><span className="mt-0.5 block truncate text-xs text-pd-muted">{entry.medicationName} · {entry.nextAction}</span><span className="mt-1 flex items-center gap-2 text-[0.65rem]"><span className={entry.state === "NEEDS_ATTENTION" ? "text-[#ffb7ad]" : entry.state === "IN_PROGRESS" ? "text-pd-accent-soft" : "text-pd-ok"}>{caregiverActivityLabel(entry.state)}</span><span className="text-pd-muted/70">· {formatDate(entry.at)}</span></span></span>; }
function caregiverCaseTitle(reason: keyof typeof reasonLabels) { return reason === "NO_PATIENT_RESPONSE" ? "No response after scheduled dose" : reason === "PATIENT_REPORTED_NOT_TAKEN" ? "Patient reported dose not taken" : reason === "MOTOR_COMPLETED_INGESTION_UNCONFIRMED" ? "Dose confirmation needed" : reason === "MOTOR_OUTCOME_UNKNOWN" ? "Dispense outcome unclear" : "Device issue reported"; }
function formatDate(value: number) { return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }

function CareState({ title, children }: { title: string; children: ReactNode }) {
  return <section className="pd-card p-5"><h2 className="text-lg font-semibold">{title}</h2><div className="mt-2 text-sm leading-6 text-pd-muted">{children}</div><Link href="/caregiver" className="pd-focus mt-4 inline-flex min-h-10 items-center rounded-full border border-white/10 px-4 text-xs font-semibold">Open protected caregiver route</Link></section>;
}
