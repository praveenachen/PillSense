type VoiceReminder = {
  id: string;
  mode: string;
  slot: number;
  medicationName: string;
  scheduledFor: number;
  eligibleFrom: number;
  expiresAt: number;
  attemptStatus: string;
  ingestionReport: string;
  commandId?: string | null;
  eligibility?: string;
};

/** Presentation selection only. Backend authorization remains authoritative. */
export function selectFreshVoiceReminder<T extends VoiceReminder>(rows: readonly T[], now: number, demoOnly: boolean): T | undefined {
  return rows.filter((row) => row.ingestionReport === "UNREPORTED" && row.attemptStatus === "NONE" && !row.commandId && row.eligibility !== "STALE"
    && now >= row.eligibleFrom && now <= row.expiresAt
    && (!demoOnly || (row.mode === "demo" && row.slot === 6 && row.medicationName.trim().toLowerCase() === "iron pills")))
    .sort((a, b) => b.scheduledFor - a.scheduledFor || a.id.localeCompare(b.id))[0];
}
