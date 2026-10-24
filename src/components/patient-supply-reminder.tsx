"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ReminderCard } from "./mobile-ui";

export function PatientSupplyReminder() {
  const auth = useConvexAuth();
  const result = useQuery(api.refills.patientReminder, auth.isAuthenticated ? {} : "skip");
  if (!auth.isAuthenticated || result === undefined || result.reminders.length === 0) return null;
  return (
    <ReminderCard
      title="Refill reminder"
      message="Your caregiver has a refill to review soon."
      items={result.reminders.map((item) => ({
        id: item.id,
        label: item.medicationName,
        detail: item.estimatedDaysRemaining === null ? "Supply unknown" : `~${item.estimatedDaysRemaining} days left`,
      }))}
      footnote="Supply is estimated from your schedule, not measured by the dispenser."
    />
  );
}
