import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

const DISPENSER_SLOTS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * Returns the current assignment for each usable slot on one device.
 * Historical inactive rows are intentionally ignored instead of counting
 * toward the seven visible slots.
 */
export async function getActiveDeviceAssignments(
  ctx: QueryCtx,
  patientId: Id<"appUsers">,
  deviceId: Id<"devices">,
): Promise<Doc<"compartmentAssignments">[]> {
  const assignments = await Promise.all(
    DISPENSER_SLOTS.map((slot) =>
      ctx.db
        .query("compartmentAssignments")
        .withIndex("by_device_and_slot", (q) =>
          q.eq("deviceId", deviceId).eq("slot", slot),
        )
        .order("desc")
        .filter((q) => q.eq(q.field("active"), true))
        .first(),
    ),
  );

  return assignments.filter(
    (assignment): assignment is Doc<"compartmentAssignments"> =>
      assignment !== null && assignment.patientId === patientId,
  );
}
