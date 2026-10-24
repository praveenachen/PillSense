import { ConvexError } from "convex/values";

export const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export function validateSlot(slot: number) {
  if (!Number.isInteger(slot) || slot < 1 || slot > 7) {
    throw new ConvexError("Slot must be an integer from 1 through 7; position 0 is reserved for home");
  }
}

export function validateSchedule(
  localTime: string,
  weekdays: Weekday[],
  timezone: string,
) {
  const match = /^(\d{2}):(\d{2})$/.exec(localTime);
  if (!match) {
    throw new ConvexError("Time must use 24-hour HH:MM format");
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new ConvexError("Time must be a valid local time");
  }

  if (weekdays.length === 0 || new Set(weekdays).size !== weekdays.length) {
    throw new ConvexError("Select at least one weekday without duplicates");
  }

  if (!weekdays.every((day) => WEEKDAYS.includes(day))) {
    throw new ConvexError("Schedule contains an invalid weekday");
  }

  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(0);
  } catch {
    throw new ConvexError("Timezone must be a valid IANA timezone");
  }
}

export function validateMedicationText(name: string, instructions: string) {
  if (!name.trim() || name.trim().length > 120) {
    throw new ConvexError("Medication name must be between 1 and 120 characters");
  }
  if (instructions.trim().length > 500) {
    throw new ConvexError("Instructions must be 500 characters or fewer");
  }
}

export function validateDemoInventory(inventory: number) {
  if (inventory !== 0 && inventory !== 1) {
    throw new ConvexError("Demo inventory must be 0 or 1 inert pill");
  }
}
