import Link from "next/link";
import type { ReactNode } from "react";
import { AuthControls } from "./auth-controls";
import { AuthStatus } from "./auth-status";

const navigation = [
  { href: "/demo", label: "Demo studio" },
  { href: "/patient", label: "Patient" },
  { href: "/caregiver", label: "Caregiver" },
  { href: "/agent-activity", label: "Agent activity" },
] as const;

export function AppShell({ eyebrow, title, description, children }: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const authUiConfigured = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
      process.env.NEXT_PUBLIC_CONVEX_URL,
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-5 sm:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <Link href="/patient" className="flex items-center gap-3" aria-label="PillSense home">
              <span className="grid size-10 place-items-center rounded-xl bg-teal-600 text-lg font-bold text-white">P</span>
              <span>
                <span className="block text-lg font-semibold tracking-tight">PillSense</span>
                <span className="block text-xs text-slate-500">Medication support prototype</span>
              </span>
            </Link>
            <nav aria-label="Primary navigation" className="flex flex-wrap gap-2 text-sm font-medium">
              {navigation.map((item) => (
                <Link key={item.href} href={item.href} className="rounded-full border border-slate-200 bg-white px-3.5 py-2 text-slate-700 transition hover:border-teal-300 hover:text-teal-700">
                  {item.label}
                </Link>
              ))}
            </nav>
            {authUiConfigured ? (
              <AuthControls />
            ) : (
              <span className="text-sm font-medium text-amber-700">Authentication setup required</span>
            )}
          </div>
          <div className="mt-4">
            {authUiConfigured ? (
              <AuthStatus />
            ) : (
              <p className="text-xs text-slate-500">Clerk or Convex public configuration is missing.</p>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">{eyebrow}</p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">{description}</p>
        <div className="mt-10">{children}</div>
      </main>
    </div>
  );
}

export function ShellCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3 text-sm leading-6 text-slate-600">{children}</div>
    </section>
  );
}
