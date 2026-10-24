/**
 * Pure presentation helpers for the Today and Schedule screens.
 *
 * Safety rule: a row is only "TAKEN" when a persisted patient report says so.
 * Motor completion, attempt status and schedule time never imply ingestion.
 */

export type ScheduledMedication = {
  id: string;
  name: string;
  instructions: string;
  slot: number;
  localTime: string; // "HH:MM"
  weekdays: readonly string[]; // "MON" .. "SUN"
};

export type DoseOccurrence = {
  id: string;
  mode: string;
  medicationName: string;
  instructions: string;
  slot: number;
  scheduledFor: number;
  eligibleFrom: number;
  expiresAt: number;
  attemptStatus: string;
  ingestionReport: "UNREPORTED" | "TAKEN" | "NOT_TAKEN";
};

export type TimelineState =
  | "TAKEN" // patient reported taken
  | "NEEDS_CONFIRMATION" // scheduled time has passed without a "taken" report; NOT a claim that it was missed
  | "UPCOMING"; // scheduled time is still in the future

export type TimelineRow = {
  key: string;
  at: number;
  timeLabel: string;
  medicationName: string;
  instructions: string;
  slot: number;
  occurrenceId: string | null;
  isDemo: boolean;
  state: TimelineState;
};

const WEEKDAY_KEYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

export function greetingFor(hour: number) {
  if (hour < 5) return "Good evening,";
  if (hour < 12) return "Good morning,";
  if (hour < 17) return "Good afternoon,";
  return "Good evening,";
}

export function firstName(displayName: string | null | undefined) {
  return displayName?.trim().split(/\s+/)[0] ?? "";
}

export function formatClock(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function atLocalTime(dayStart: number, localTime: string) {
  const [hours, minutes] = localTime.split(":").map(Number);
  const date = new Date(dayStart);
  date.setHours(Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return date.getTime();
}

export function buildTodayTimeline(
  medications: readonly ScheduledMedication[],
  occurrences: readonly DoseOccurrence[],
  now: number,
): TimelineRow[] {
  const dayStartDate = new Date(now);
  dayStartDate.setHours(0, 0, 0, 0);
  const dayStart = dayStartDate.getTime();
  const dayEnd = dayStart + 24 * 60 * 60_000;
  const todayKey = WEEKDAY_KEYS[new Date(now).getDay()];
  const todaysOccurrences = occurrences.filter((o) => o.scheduledFor >= dayStart && o.scheduledFor < dayEnd);
  const used = new Set<string>();

  const draft: Array<Omit<TimelineRow, "state"> & { occurrence: DoseOccurrence | null }> = [];

  for (const medication of medications) {
    if (!medication.weekdays.includes(todayKey)) continue;
    const at = atLocalTime(dayStart, medication.localTime);
    const match = todaysOccurrences.find((o) => !used.has(o.id) && o.medicationName === medication.name && Math.abs(o.scheduledFor - at) < 60 * 60_000);
    if (match) used.add(match.id);
    draft.push({
      key: `med:${medication.id}`,
      at: match?.scheduledFor ?? at,
      timeLabel: formatClock(match?.scheduledFor ?? at),
      medicationName: medication.name,
      instructions: medication.instructions,
      slot: medication.slot,
      occurrenceId: match?.id ?? null,
      isDemo: match?.mode === "demo",
      occurrence: match ?? null,
    });
  }
  for (const occurrence of todaysOccurrences) {
    if (used.has(occurrence.id)) continue;
    draft.push({
      key: `occ:${occurrence.id}`,
      at: occurrence.scheduledFor,
      timeLabel: formatClock(occurrence.scheduledFor),
      medicationName: occurrence.medicationName,
      instructions: occurrence.instructions,
      slot: occurrence.slot,
      occurrenceId: occurrence.id,
      isDemo: occurrence.mode === "demo",
      occurrence,
    });
  }

  draft.sort((a, b) => a.at - b.at);
  return draft.map(({ occurrence, ...row }) => {
    let state: TimelineState;
    if (occurrence?.ingestionReport === "TAKEN") state = "TAKEN";
    else if (row.at <= now) state = "NEEDS_CONFIRMATION";
    else state = "UPCOMING";
    return { ...row, state };
  });
}

/** The next scheduled dose still in the future. Unreported past doses are shown in the schedule, never here. */
export function pickNextDose(rows: readonly TimelineRow[]) {
  return rows.find((row) => row.state === "UPCOMING") ?? null;
}

export type DoseDetails = { dosage: string; slotLabel: string; instruction: string | null };

/**
 * Display details for a dose. The data model has no dosage field yet, so dosage is read
 * from the instruction text (e.g. "Take 2 tablets with breakfast") and otherwise falls
 * back to the single dispenser dose. Swap this one function when a real field exists.
 */
export function describeDose(row: Pick<TimelineRow, "instructions" | "slot">): DoseDetails {
  const text = row.instructions.trim();
  const amount = text.match(/\b(\d+(?:\.\d+)?|one|two|three|half)\s+(tablets?|pills?|capsules?|softgels?|drops?|mg|ml)\b/i);
  const dosage = amount ? `${amount[1]} ${amount[2]}`.replace(/^./, (c) => c.toUpperCase()) : "1 dispenser dose";
  return { dosage, slotLabel: `Slot ${row.slot}`, instruction: text || null };
}

export const timelineStateLabel: Record<TimelineState, string> = {
  TAKEN: "Complete",
  NEEDS_CONFIRMATION: "Incomplete",
  UPCOMING: "Upcoming",
};

/**
 * Countdown to a real scheduled dose, e.g. "in 12 min". Returns null once the time has
 * passed or is under a minute away, so no countdown is ever invented.
 */
export function countdownLabel(at: number, now: number) {
  const minutes = Math.ceil((at - now) / 60_000);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `in ${hours} hr` : `in ${hours} hr ${rest} min`;
}

/** One-line "1 tablet · With water" text: the dosage plus the instruction with the amount phrase removed. */
export function compactDoseLine(row: Pick<TimelineRow, "instructions" | "slot">) {
  const { dosage, instruction } = describeDose(row);
  const rest = (instruction ?? "")
    .replace(/\b(\d+(?:\.\d+)?|one|two|three|half)\s+(tablets?|pills?|capsules?|softgels?|drops?|mg|ml)\b/i, "")
    .replace(/^[\s·,;:-]*(take\s+)?/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return rest ? `${dosage} · ${rest.replace(/^./, (c) => c.toUpperCase())}` : dosage;
}
