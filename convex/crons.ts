import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "reconcile medication occurrences and reminders",
  { minutes: 5 },
  internal.reminders.reconcileAll,
  {},
);

export default crons;
