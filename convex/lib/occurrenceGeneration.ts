import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { occurrenceTimesForWindow } from "./scheduleTime";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export async function ensureUpcomingOccurrences(
  ctx: MutationCtx,
  patientId: Id<"appUsers">,
  now: number,
) {
  const windowEnd = now + 7 * DAY;
  const schedules = await ctx.db
    .query("medicationSchedules")
    .withIndex("by_patient", (q) => q.eq("patientId", patientId))
    .take(32);
  let created = 0;

  for (const schedule of schedules) {
    if (!schedule.active) continue;
    const medication = await ctx.db.get("medications", schedule.medicationId);
    if (!medication?.active) continue;
    const revision = schedule.revision ?? 1;
    const times = occurrenceTimesForWindow({
      now,
      windowEnd,
      localTime: schedule.localTime,
      weekdays: schedule.weekdays,
      timezone: schedule.timezone,
    });
    for (const scheduledFor of times) {
      const occurrenceKey = `${schedule._id}:${revision}:${scheduledFor}`;
      const existing = await ctx.db
        .query("doseOccurrences")
        .withIndex("by_occurrenceKey", (q) => q.eq("occurrenceKey", occurrenceKey))
        .unique();
      if (existing) continue;
      await ctx.db.insert("doseOccurrences", {
        occurrenceKey,
        patientId,
        medicationId: schedule.medicationId,
        scheduleId: schedule._id,
        scheduleRevision: revision,
        mode: "scheduled",
        scheduledFor,
        eligibleFrom: scheduledFor - 15 * MINUTE,
        expiresAt: scheduledFor + 30 * MINUTE,
        attemptStatus: "NONE",
        ingestionReport: "UNREPORTED",
        createdAt: now,
      });
      created += 1;
    }
  }
  return { created, windowEnd };
}
