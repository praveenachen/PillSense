"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export function PatientSupplyReminder() {
  const auth = useConvexAuth();
  const result = useQuery(api.refills.patientReminder, auth.isAuthenticated ? {} : "skip");
  if (!auth.isAuthenticated || result === undefined || result.reminders.length === 0) return null;
  return <section className="rounded-2xl border border-amber-300 bg-amber-50 p-6"><h2 className="text-lg font-semibold text-amber-950">Supply reminder</h2><p className="mt-2 text-sm text-amber-900">Your caregiver has a refill item to review. Supply is estimated, not sensor-confirmed.</p><ul className="mt-3 space-y-2 text-sm">{result.reminders.map((item) => <li key={item.id} className="rounded-xl bg-white/70 p-3"><strong>{item.medicationName}</strong> · {item.estimatedDaysRemaining === null ? "supply unknown" : `about ${item.estimatedDaysRemaining} days estimated`} · {item.confidence.toLowerCase()} confidence</li>)}</ul></section>;
}
