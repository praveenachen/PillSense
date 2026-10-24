export type CareProgressOccurrence = {
  scheduledFor: number;
  expiresAt: number;
  ingestionReport: string;
};

export type CareProgress = {
  total: number;
  taken: number;
  needsAttention: number;
  awaiting: number;
  percent: number;
  state: "ON_TRACK" | "ACTION_NEEDED" | "AWAITING_REPORTS" | "NO_DOSES";
};

export function getCareProgress(rows: CareProgressOccurrence[], now: number): CareProgress {
  const date = new Date(now);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  const today = rows.filter((row) => row.scheduledFor >= start && row.scheduledFor < end);
  const taken = today.filter((row) => row.ingestionReport === "TAKEN").length;
  const needsAttention = today.filter((row) =>
    row.ingestionReport === "NOT_TAKEN"
    || (row.ingestionReport === "UNREPORTED" && row.expiresAt < now),
  ).length;
  const awaiting = today.length - taken - needsAttention;
  return {
    total: today.length,
    taken,
    needsAttention,
    awaiting,
    percent: today.length === 0 ? 0 : Math.round((taken / today.length) * 100),
    state: today.length === 0
      ? "NO_DOSES"
      : needsAttention > 0
        ? "ACTION_NEEDED"
        : taken === today.length
          ? "ON_TRACK"
          : "AWAITING_REPORTS",
  };
}

export function pickPriorityCase<T extends { status: string; updatedAt: number }>(rows: T[]): T | null {
  return [...rows]
    .filter((row) => row.status === "OPEN" || row.status === "ACKNOWLEDGED")
    .sort((a, b) => {
      const priority = (value: string) => value === "OPEN" ? 0 : 1;
      return priority(a.status) - priority(b.status) || b.updatedAt - a.updatedAt;
    })[0] ?? null;
}

export type CaregiverActivityState = "NEEDS_ATTENTION" | "IN_PROGRESS" | "RESOLVED";

export type CaregiverCaseStateInput = {
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  investigationStatus: "NOT_REQUESTED" | "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
};

export function caregiverActivityState(item: CaregiverCaseStateInput): CaregiverActivityState {
  if (item.status === "RESOLVED") return "RESOLVED";
  if (item.status === "ACKNOWLEDGED" || item.investigationStatus === "PENDING" || item.investigationStatus === "RUNNING") {
    return "IN_PROGRESS";
  }
  return "NEEDS_ATTENTION";
}

export function caregiverActivityLabel(state: CaregiverActivityState) {
  return state === "NEEDS_ATTENTION" ? "Needs attention" : state === "IN_PROGRESS" ? "In progress" : "Resolved";
}

export function caregiverNextAction(item: CaregiverCaseStateInput) {
  const state = caregiverActivityState(item);
  if (state === "RESOLVED") return "Follow-up completed";
  if (item.investigationStatus === "COMPLETED") return "Review findings";
  if (item.investigationStatus === "FAILED") return "Review case manually";
  if (item.investigationStatus === "PENDING" || item.investigationStatus === "RUNNING") return "Investigation underway";
  if (item.status === "ACKNOWLEDGED") return "Caregiver follow-up underway";
  return "Review recommended";
}

export function dedupeCaregiverActivity<T extends { state: CaregiverActivityState; title: string; medicationName: string }>(rows: T[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.state}:${row.title}:${row.medicationName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
