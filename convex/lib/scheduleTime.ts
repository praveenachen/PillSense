import type { Weekday } from "./medicationValidation";

const weekdayByShortName: Record<string, Weekday> = {
  Sun: "SUN",
  Mon: "MON",
  Tue: "TUE",
  Wed: "WED",
  Thu: "THU",
  Fri: "FRI",
  Sat: "SAT",
};

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: Weekday;
};

function localParts(epochMs: number, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(epochMs);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    weekday: weekdayByShortName[value("weekday")],
  };
}

function localDateTimeToEpoch(
  date: Pick<LocalParts, "year" | "month" | "day">,
  hour: number,
  minute: number,
  timezone: string,
) {
  const desiredAsUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  let guess = desiredAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = localParts(guess, timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    guess += desiredAsUtc - actualAsUtc;
  }
  const verified = localParts(guess, timezone);
  return verified.year === date.year &&
    verified.month === date.month &&
    verified.day === date.day &&
    verified.hour === hour &&
    verified.minute === minute
    ? guess
    : null;
}

export function occurrenceTimesForWindow(args: {
  now: number;
  windowEnd: number;
  localTime: string;
  weekdays: Weekday[];
  timezone: string;
}) {
  const [hour, minute] = args.localTime.split(":").map(Number);
  const dates = new Map<string, Pick<LocalParts, "year" | "month" | "day" | "weekday">>();
  const daySpan = Math.ceil((args.windowEnd - args.now) / (24 * 60 * 60 * 1000));
  for (let offset = -1; offset <= daySpan + 1; offset += 1) {
    const local = localParts(args.now + offset * 24 * 60 * 60 * 1000, args.timezone);
    dates.set(`${local.year}-${local.month}-${local.day}`, local);
  }

  return [...dates.values()]
    .filter((date) => args.weekdays.includes(date.weekday))
    .map((date) => localDateTimeToEpoch(date, hour, minute, args.timezone))
    .filter((epoch): epoch is number => epoch !== null)
    .filter((epoch) => epoch >= args.now && epoch <= args.windowEnd)
    .sort((a, b) => a - b);
}
