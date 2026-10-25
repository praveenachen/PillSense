"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { AuthRequired } from "./auth-required";
import { CaregiverMedicationSetup } from "./caregiver-medication-setup";

export function OnboardingGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const auth = useConvexAuth();
  const dashboard = useQuery(api.patient.dashboard, auth.isAuthenticated ? {} : "skip");

  // The Hardware Lab is owned by the root layout and keeps its own authorization; never cover it with onboarding UI.
  if (pathname === "/hardware-lab") return children;
  if (auth.isLoading) return <GateCard title="Checking access…">Confirming your Clerk and Convex session.</GateCard>;
  if (!auth.isAuthenticated) return <GateCard title="Sign in to PillSense"><AuthRequired message="Sign in to view your medication workspace." /></GateCard>;
  if (dashboard === undefined) return <GateCard title="Loading care workspace…">Checking your patient or caregiver record.</GateCard>;
  if (dashboard.status === "needs_onboarding") {
    return <main className="mx-auto w-full max-w-3xl px-5 py-10"><CaregiverMedicationSetup /></main>;
  }
  if (dashboard.status !== "ready") {
    return <GateCard title="Care workspace unavailable">This account does not have an active patient record or caregiver relationship.</GateCard>;
  }
  return children;
}

function GateCard({ title, children }: { title: string; children: ReactNode }) {
  return <main className="mx-auto w-full max-w-3xl px-5 py-10"><section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h1 className="text-xl font-semibold">{title}</h1><div className="mt-3 text-sm leading-6 text-slate-600">{children}</div></section></main>;
}
