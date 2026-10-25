"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { prepareWalgreensCheckout, SANDBOX_TEST_RX } from "@/lib/walgreens-checkout";

type Tone = "dark" | "light";

const tones: Record<Tone, { card: string; title: string; body: string; button: string; inner: string; link: string; warning: string }> = {
  dark: {
    card: "mt-3 rounded-pd-card border border-pd-line bg-pd-surface p-4 text-sm text-pd-text",
    title: "font-semibold text-pd-text",
    body: "mt-1 text-xs leading-5 text-pd-muted",
    button: "pd-press pd-focus mt-3 min-h-11 rounded-full bg-gradient-to-br from-pd-accent to-pd-accent-2 px-5 text-sm font-semibold text-white shadow-[0_6px_16px_-8px_rgba(84,121,255,0.9)] disabled:opacity-50",
    inner: "mt-3 rounded-pd-chip border border-pd-line bg-black/20 p-3 text-xs text-pd-text/85",
    link: "mt-2 inline-block font-semibold text-pd-accent-soft underline",
    warning: "mt-2 font-semibold text-pd-warn",
  },
  light: {
    card: "mt-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-slate-700",
    title: "font-semibold text-sky-950",
    body: "mt-1",
    button: "mt-3 rounded-full bg-sky-700 px-3 py-2 font-semibold text-white disabled:opacity-50",
    inner: "mt-3 rounded-lg bg-white p-3",
    link: "mt-2 inline-block font-semibold text-sky-800 underline",
    warning: "mt-2 font-semibold text-amber-800",
  },
};

/** Mock and sandbox are different things: neither contacts a live pharmacy, but only sandbox reaches Walgreens' QA service. */
export function environmentBadge(environment: "MOCK" | "SANDBOX") {
  return environment === "MOCK"
    ? { label: "Mock", detail: "Simulated on PillSense only; Walgreens is not contacted." }
    : { label: "Sandbox", detail: "Walgreens QA test service with a test prescription; no real order." };
}

export function WalgreensRefillControls({ caseId, eligible, tone = "dark" }: { caseId: Id<"refillCases">; eligible: boolean; tone?: Tone }) {
  const styles = tones[tone];
  const checkouts = useQuery(api.walgreens.listForCase, { refillCaseId: caseId });
  const approve = useMutation(api.walgreens.approve);
  const createSession = useAction(api.walgreens.createSession);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function start() {
    setBusy(true); setMessage(null);
    try {
      const result = await prepareWalgreensCheckout({
        caseId,
        approve: (refillCaseId) => approve({ refillCaseId: refillCaseId as Id<"refillCases"> }),
        createSession: (checkoutId, idempotencyKey, rxNumber) => createSession({ checkoutId, idempotencyKey, rxNumber }),
      });
      setMessage(result.status === "CHECKOUT_READY"
        ? `${environmentBadge(result.environment).label} checkout is ready. Open the link below; a return is not proof of fulfillment.`
        : `Checkout status: ${result.status}${result.errorCode ? ` · ${result.errorCode}` : ""}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Walgreens checkout could not be prepared.");
    } finally { setBusy(false); }
  }

  const latest = checkouts?.[0];
  const badge = latest ? environmentBadge(latest.environment) : null;
  return <div className={styles.card}>
    <p className={styles.title}>Walgreens refill handoff · demo</p>
    <p className={styles.body}>Uses official sandbox test Rx {SANDBOX_TEST_RX}. It is unrelated to any scanned OTC product, never places a real order, and only a caregiver can start it.</p>
    {!eligible && <p className={styles.body}>Review, request a refill, and complete the low-supply investigation before approval.</p>}
    {eligible && <button type="button" disabled={busy} onClick={() => void start()} className={styles.button}>{busy ? "Preparing checkout…" : "Approve and prepare checkout"}</button>}
    {message && <p role="status" className={styles.body}>{message}</p>}
    {checkouts === undefined && <p className={styles.body}>Loading checkout status…</p>}
    {latest && badge && <div className={styles.inner}>
      <p>Latest status: <strong>{latest.status.replaceAll("_", " ")}</strong> · <strong>{badge.label}</strong></p>
      <p className="mt-0.5">{badge.detail}</p>
      {latest.errorCode && <p>Error: {latest.errorCode}</p>}
      {latest.landingUrl && latest.status === "CHECKOUT_READY" && <a href={latest.landingUrl} target="_blank" rel="noopener noreferrer" className={styles.link}>Open {latest.environment === "MOCK" ? "mock" : "Walgreens sandbox"} checkout</a>}
      {latest.status === "CHECKOUT_RETURNED_UNVERIFIED" && <p className={styles.warning}>Checkout returned. Medication fulfillment and receipt remain unverified.</p>}
    </div>}
  </div>;
}
