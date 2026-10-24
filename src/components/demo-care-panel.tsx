"use client";

import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { AuthRequired } from "./auth-required";
import { CaregiverAlerts } from "./caregiver-alerts";
import { CaregiverDeviceIssues } from "./caregiver-device-issues";

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

  return (
    <div className="space-y-5">
      <div className="rounded-[1.4rem] border border-[#bfded4] bg-[#ddf3eb] p-5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#087f78]">Authorized care view</p>
        <h2 className="mt-2 text-xl font-semibold text-[#163a40]">Caregiver follow-up</h2>
        <p className="mt-2 text-sm leading-6 text-[#416167]">
          Live alerts remain server-authorized. Medication setup and technical agent evidence stay
          in their complete protected workspaces.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/caregiver" className="min-h-11 rounded-full bg-[#087f78] px-4 py-3 text-sm font-bold text-white">
            Open caregiver workspace
          </Link>
          <Link href="/agent-activity" className="min-h-11 rounded-full border border-[#8fc9bc] bg-white px-4 py-3 text-sm font-bold text-[#163a40]">
            View agent activity
          </Link>
        </div>
      </div>
      <CaregiverDeviceIssues />
      <CaregiverAlerts />
    </div>
  );
}

function CareState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[1.4rem] border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-[#163a40]">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{children}</p>
      <Link href="/caregiver" className="mt-4 inline-flex min-h-11 items-center rounded-full border border-slate-300 px-4 text-sm font-semibold text-[#163a40]">
        Open protected caregiver route
      </Link>
    </section>
  );
}
