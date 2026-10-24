"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { prepareWalgreensCheckout, SANDBOX_TEST_RX } from "@/lib/walgreens-checkout";

export function WalgreensRefillControls({ caseId, eligible }: { caseId: Id<"refillCases">; eligible: boolean }) {
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
        ? `${result.environment === "MOCK" ? "Mock" : "Sandbox"} checkout is ready. Open the link below; a return is not proof of fulfillment.`
        : `Checkout status: ${result.status}${result.errorCode ? ` · ${result.errorCode}` : ""}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Walgreens checkout could not be prepared.");
    } finally { setBusy(false); }
  }

  const latest = checkouts?.[0];
  return <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-slate-700">
    <p className="font-semibold text-sky-950">Separate synthetic Walgreens refill</p>
    <p className="mt-1">Uses official sandbox test Rx {SANDBOX_TEST_RX}. This is unrelated to any scanned OTC product.</p>
    {!eligible && <p className="mt-2">Review, request, and complete the low-supply investigation before approval.</p>}
    {eligible && <button type="button" disabled={busy} onClick={() => void start()} className="mt-3 rounded-full bg-sky-700 px-3 py-2 font-semibold text-white disabled:opacity-50">{busy ? "Preparing checkout…" : "Approve and prepare Walgreens checkout"}</button>}
    {message && <p role="status" className="mt-2">{message}</p>}
    {checkouts === undefined && <p className="mt-2">Loading checkout status…</p>}
    {latest && <div className="mt-3 rounded-lg bg-white p-3">
      <p>Latest status: <strong>{latest.status.replaceAll("_", " ")}</strong> · {latest.environment}</p>
      {latest.errorCode && <p>Error: {latest.errorCode}</p>}
      {latest.landingUrl && latest.status === "CHECKOUT_READY" && <a href={latest.landingUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-semibold text-sky-800 underline">Open {latest.environment === "MOCK" ? "mock" : "Walgreens sandbox"} checkout</a>}
      {latest.status === "CHECKOUT_RETURNED_UNVERIFIED" && <p className="mt-2 font-semibold text-amber-800">Checkout returned. Medication fulfillment and receipt remain unverified.</p>}
    </div>}
  </div>;
}
