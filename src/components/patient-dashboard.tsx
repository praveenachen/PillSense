"use client";

import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { AuthRequired } from "./auth-required";

export function PatientDashboard() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) {
    return <DashboardState title="Loading dashboard…">Confirming authentication and loading schedules.</DashboardState>;
  }
  if (!isAuthenticated) {
    return <AuthRequired message="Patient schedules are private and require Convex to accept your Clerk session." />;
  }
  return <AuthenticatedDashboard />;
}

function AuthenticatedDashboard() {
  const dashboard = useQuery(api.patient.dashboard);
  if (dashboard === undefined) {
    return <DashboardState title="Loading medications…">Listening for schedule updates from Convex.</DashboardState>;
  }
  if (dashboard.status === "needs_onboarding") {
    return (
      <DashboardState title="No demo care team yet">
        Use the <Link href="/caregiver" className="font-semibold text-teal-700 underline">caregiver setup</Link> to explicitly create a synthetic patient relationship.
      </DashboardState>
    );
  }
  if (dashboard.status === "unauthorized") {
    return <DashboardState title="Patient access unavailable">This account does not have an active patient profile or caregiver relationship.</DashboardState>;
  }
  if (dashboard.status === "unavailable") {
    return <DashboardState title="Patient unavailable">The paired synthetic patient record could not be loaded.</DashboardState>;
  }
  if (dashboard.medications.length === 0) {
    return (
      <DashboardState title={`No medications for ${dashboard.patientName}`}>
        An authorized caregiver can add the first synthetic medication from the caregiver setup page.
      </DashboardState>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-teal-700">Schedule for</p>
          <h2 className="mt-1 text-2xl font-semibold">{dashboard.patientName}</h2>
        </div>
        <p className="text-xs text-slate-500">Reactive Convex schedule · demo pills only</p>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {dashboard.medications.map((medication) => (
          <article key={medication.id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Upcoming schedule</p>
                <h3 className="mt-2 text-xl font-semibold">{medication.name}</h3>
              </div>
              <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white">Slot {medication.slot}</span>
            </div>
            <p className="mt-5 text-3xl font-semibold tracking-tight">{medication.localTime}</p>
            <p className="mt-1 text-sm text-slate-500">{medication.timezone}</p>
            <p className="mt-4 text-sm font-medium text-slate-700">{medication.weekdays.join(" · ")}</p>
            {medication.instructions && <p className="mt-4 border-t border-slate-100 pt-4 text-sm leading-6 text-slate-600">{medication.instructions}</p>}
            <p className="mt-4 text-xs text-slate-500">Demo inventory: {medication.demoInventory} inert pill</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function DashboardState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-3 text-sm leading-6 text-slate-600">{children}</div>
    </section>
  );
}
