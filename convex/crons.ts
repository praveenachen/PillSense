import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "reconcile medication occurrences and reminders",
  { minutes: 5 },
  internal.reminders.reconcileAll,
  {},
);

crons.interval(
  "complete unclaimed synthetic investigations with deterministic fallback",
  { minutes: 1 },
  internal.agentService.completePendingFallbacks,
  {},
);

export default crons;
