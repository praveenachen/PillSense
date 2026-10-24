import { occurrenceTimesForWindow } from "./scheduleTime";
import type { Weekday } from "./medicationValidation";

const DAY_MS = 24 * 60 * 60 * 1000;
const FORECAST_DAYS = 120;

export type ForecastSchedule = {
  localTime: string;
  weekdays: Weekday[];
  timezone: string;
};

export type SupplyForecast = {
  estimatedSupplyCount: number | null;
  estimatedDaysRemaining: number | null;
  expectedLowSupplyAt: number | null;
  estimatedRunOutAt: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  uncertaintyReasons: string[];
  isActionable: boolean;
  triggerReason: "LOW_SUPPLY" | "UNKNOWN_SUPPLY" | null;
};

export function buildSupplyForecast(args: {
  now: number;
  supplyCount: number | null;
  source: "CAREGIVER_VERIFIED" | "SYNTHETIC_DEMO" | null;
  schedules: ForecastSchedule[];
  thresholdDays?: number;
  hasMissedDoseUncertainty?: boolean;
}): SupplyForecast {
  const thresholdDays = args.thresholdDays ?? 3;
  if (args.supplyCount === null) {
    return unknown(args.supplyCount, "SUPPLY_NOT_RECORDED");
  }
  if (!Number.isSafeInteger(args.supplyCount) || args.supplyCount < 0) {
    return unknown(null, "INVALID_SUPPLY_ESTIMATE");
  }
  if (args.schedules.length === 0) {
    return unknown(args.supplyCount, "NO_ACTIVE_SCHEDULE");
  }

  const windowEnd = args.now + FORECAST_DAYS * DAY_MS;
  const occurrences = args.schedules
    .flatMap((schedule) => occurrenceTimesForWindow({
      now: args.now,
      windowEnd,
      ...schedule,
    }))
    .sort((a, b) => a - b);
  if (occurrences.length === 0) {
    return unknown(args.supplyCount, "NO_UPCOMING_DOSES_IN_FORECAST_WINDOW");
  }

  const reasons: string[] = [];
  let confidence: SupplyForecast["confidence"] =
    args.source === "CAREGIVER_VERIFIED" ? "HIGH" : "MEDIUM";
  if (args.hasMissedDoseUncertainty) {
    reasons.push("MISSED_DOSE_OR_INGESTION_UNCERTAINTY");
    confidence = args.source === "CAREGIVER_VERIFIED" ? "MEDIUM" : "LOW";
  }
  if (args.source === "SYNTHETIC_DEMO") reasons.push("SYNTHETIC_DEMO_ESTIMATE");

  const runOutAt = args.supplyCount === 0
    ? args.now
    : occurrences[args.supplyCount - 1] ?? null;
  if (runOutAt === null) {
    reasons.push("SUPPLY_EXTENDS_BEYOND_FORECAST_WINDOW");
    confidence = "LOW";
  }
  const daysRemaining = runOutAt === null
    ? null
    : Math.max(0, Math.round(((runOutAt - args.now) / DAY_MS) * 10) / 10);

  let lowAt: number | null = null;
  const checkpoints = [args.now, ...occurrences.slice(0, args.supplyCount)];
  for (let consumed = 0; consumed < checkpoints.length; consumed += 1) {
    const checkpoint = checkpoints[consumed];
    const remaining = Math.max(0, args.supplyCount - consumed);
    const demand = occurrences.filter(
      (time) => time > checkpoint && time <= checkpoint + thresholdDays * DAY_MS,
    ).length;
    if (remaining <= demand) {
      lowAt = checkpoint;
      break;
    }
  }

  return {
    estimatedSupplyCount: args.supplyCount,
    estimatedDaysRemaining: daysRemaining,
    expectedLowSupplyAt: lowAt,
    estimatedRunOutAt: runOutAt,
    confidence,
    uncertaintyReasons: reasons,
    isActionable: lowAt !== null && lowAt <= args.now,
    triggerReason: lowAt !== null && lowAt <= args.now ? "LOW_SUPPLY" : null,
  };
}

function unknown(
  count: number | null,
  reason: string,
): SupplyForecast {
  return {
    estimatedSupplyCount: count,
    estimatedDaysRemaining: null,
    expectedLowSupplyAt: null,
    estimatedRunOutAt: null,
    confidence: "UNKNOWN",
    uncertaintyReasons: [reason],
    isActionable: true,
    triggerReason: "UNKNOWN_SUPPLY",
  };
}
