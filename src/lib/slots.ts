import { SLOT_IDS } from "./dispenser/types";

export function getAvailableSlots(occupiedSlots: Iterable<number>) {
  const occupied = new Set(occupiedSlots);
  return SLOT_IDS.filter((slot) => !occupied.has(slot));
}
