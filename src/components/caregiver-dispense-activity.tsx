"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export function CaregiverDispenseActivity() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading || !isAuthenticated) return null;
  return <Activity />;
}

function Activity() {
  const result = useQuery(api.activity.latestForCaregiver);
  if (result === undefined) {
    return <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">Loading dispense activity…</section>;
  }
  if (result.status !== "ready") return null;
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-teal-700">{result.patientName}</p>
          <h2 className="mt-1 text-xl font-semibold">Latest mock dispense activity</h2>
        </div>
        <span className="text-xs text-slate-500">Persisted Convex evidence</span>
      </div>
      {result.activity.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">No dispense attempts yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {result.activity.map((item) => (
            <li key={item.commandId} className={`rounded-xl border p-4 ${item.requiresReview ? "border-amber-300 bg-amber-50" : "border-slate-200"}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-semibold">{item.medicationName} · Slot {item.slot}</p>
                <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-bold text-white">{item.status}</span>
              </div>
              <p className="mt-2 text-sm text-slate-600">Motor: {item.motorCompletion} · Estimated inventory: {item.demoInventory}</p>
              <p className="mt-1 text-xs text-slate-500">Release: {item.pillRelease} · Collection: {item.pillCollection} · Patient report: {item.ingestionReport}</p>
              <p className="mt-1 text-xs text-slate-400">{new Date(item.updatedAt).toLocaleString()}</p>
              {item.requiresReview && <p className="mt-2 text-sm font-semibold text-amber-900">Uncertain outcome — manual reconciliation required. Do not retry automatically.</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
