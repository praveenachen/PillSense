"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { io } from "next/cache";
import { use, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";

/** Internal synthetic voice-fixture and reminder playback controls, kept out of the patient screen. */
export function VoiceDeveloperPanel() {
  use(io());
  const auth = useConvexAuth();
  const [now, setNow] = useState(() => Date.now());
  const doses = useQuery(api.occurrences.listForPatient, auth.isAuthenticated ? { now } : "skip");
  const createDemoDue = useMutation(api.occurrences.createDemoDue);
  const [busy, setBusy] = useState<"create" | "play" | null>(null);
  const [message, setMessage] = useState("No voice demo action in this lab session yet.");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  useEffect(() => () => {
    audioRef.current?.pause();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  if (!auth.isAuthenticated) return <p className="text-sm text-[#64748b]">Sign in to use protected synthetic voice controls.</p>;

  async function createDue() {
    setBusy("create");
    try {
      await createDemoDue({});
      setNow(Date.now());
      setMessage("Synthetic due occurrence created. No hardware command was issued.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "The synthetic occurrence could not be created.");
    } finally {
      setBusy(null);
    }
  }

  async function playReminder() {
    const due = doses?.occurrences.find((dose) => dose.ingestionReport === "UNREPORTED" && now >= dose.eligibleFrom && now <= dose.expiresAt);
    const text = due
      ? `PillSense reminder. ${due.medicationName} is due for the supervised demonstration in Slot ${due.slot}.`
      : "No medication is currently due.";
    setBusy("play");
    try {
      const response = await fetch("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      if (!response.ok) throw new Error("Reminder speech is unavailable. No hardware command was issued.");
      const blob = await response.blob();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      await audio.play();
      setMessage(text);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Reminder playback failed.");
    } finally {
      setBusy(null);
    }
  }

  function stopPlayback() {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    setMessage("Reminder playback stopped.");
  }

  return (
    <div>
      <p className="text-sm leading-6 text-[#475569]">Creates a synthetic due record or plays its Cartesia reminder. These controls never dispatch the motor.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void createDue()} disabled={busy !== null} className="ps-cta min-h-11 rounded-full px-4 text-sm font-semibold disabled:opacity-50">{busy === "create" ? "Creating…" : "Create synthetic due dose"}</button>
        <button type="button" onClick={() => void playReminder()} disabled={busy !== null || doses === undefined} className="ps-focus min-h-11 rounded-full border border-[#b7cde6] bg-white px-4 text-sm font-semibold text-[#334155] disabled:opacity-50">{busy === "play" ? "Loading…" : "Play scheduled reminder"}</button>
        <button type="button" onClick={stopPlayback} className="ps-focus min-h-11 rounded-full border border-[#b7cde6] bg-white px-4 text-sm font-semibold text-[#334155]">Stop playback</button>
      </div>
      <p aria-live="polite" className="mt-3 rounded-xl bg-white px-3 py-2 text-xs leading-5 text-[#475569]">{message}</p>
    </div>
  );
}
