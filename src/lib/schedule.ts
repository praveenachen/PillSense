export type ScheduleDose = {
  id: string;
  medicationName: string;
  instructions: string;
  slot: number;
  scheduledFor: number;
  expiresAt: number;
  attemptStatus: string;
  ingestionReport: "UNREPORTED" | "TAKEN" | "NOT_TAKEN";
};

export type ScheduleMedication = {
  id: string;
  name: string;
  instructions: string;
  slot: number;
  localTime: string;
  weekdays: readonly string[];
  timezone: string;
};

export type ScheduleReminder = { occurrenceId: string; followUpNeeded: boolean };
export type DoseDisplayState = "TAKEN" | "NOT_TAKEN" | "UNRESOLVED" | "DUE" | "UPCOMING";

export const scheduleDayFormatter = new Intl.DateTimeFormat([], { weekday: "long", month: "short", day: "numeric" });

function startOfLocalDay(value: number) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function addLocalDays(value: number, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

export function localDayKey(value: number) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function dayHeading(ms: number, now: number) {
  const target = startOfLocalDay(ms);
  const today = startOfLocalDay(now);
  if (target === today) return "Today";
  if (target === addLocalDays(today, 1)) return "Tomorrow";
  if (target === addLocalDays(today, -1)) return "Yesterday";
  return scheduleDayFormatter.format(ms);
}

export function doseDisplayState(dose: ScheduleDose, now: number): DoseDisplayState {
  if (dose.ingestionReport === "TAKEN") return "TAKEN";
  if (dose.ingestionReport === "NOT_TAKEN") return "NOT_TAKEN";
  if (dose.expiresAt < now) return "UNRESOLVED";
  if (dose.scheduledFor <= now) return "DUE";
  return "UPCOMING";
}

/** Duplicate suppression is intentionally limited to authoritative occurrence identity. */
export function uniqueOccurrences(doses: readonly ScheduleDose[]) {
  return [...new Map(doses.map((dose) => [dose.id, dose])).values()].sort((a, b) => a.scheduledFor - b.scheduledFor);
}

export function dosesForRange(doses: readonly ScheduleDose[], now: number, range: "today" | "week") {
  const start = startOfLocalDay(now);
  const end = addLocalDays(start, range === "today" ? 1 : 7);
  return uniqueOccurrences(doses).filter((dose) => dose.scheduledFor >= start && dose.scheduledFor < end);
}

/** Seven calendar days starting `offset` weeks from today (0 = this week, 1 = next week, -1 = last week). */
export function weekWindow(now: number, offset: number) {
  const start = addLocalDays(startOfLocalDay(now), offset * 7);
  return { start, end: addLocalDays(start, 7) };
}

export function dosesForWeek(doses: readonly ScheduleDose[], now: number, offset: number) {
  const { start, end } = weekWindow(now, offset);
  return uniqueOccurrences(doses).filter((dose) => dose.scheduledFor >= start && dose.scheduledFor < end);
}

export function reportedTakenProgress(doses: readonly ScheduleDose[]) {
  const taken = doses.filter((dose) => dose.ingestionReport === "TAKEN").length;
  return { taken, total: doses.length, percent: doses.length === 0 ? 0 : Math.round((taken / doses.length) * 100) };
}
