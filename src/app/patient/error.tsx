"use client";

export default function PatientError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <h2 className="text-2xl font-semibold">Patient dashboard unavailable</h2>
      <p className="mt-3 text-slate-600">The protected schedule request failed. Check the Clerk-to-Convex status and try again.</p>
      <button type="button" onClick={reset} className="mt-5 rounded-full bg-teal-600 px-4 py-2 text-sm font-semibold text-white">Try again</button>
    </div>
  );
}
