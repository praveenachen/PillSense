import { AppShell } from "@/components/app-shell";
import { CaregiverMedicationSetup } from "@/components/caregiver-medication-setup";
import { CaregiverDispenseActivity } from "@/components/caregiver-dispense-activity";
import { CaregiverAlerts } from "@/components/caregiver-alerts";
import { CaregiverRefills } from "@/components/caregiver-refills";
import { CaregiverDeviceIssues } from "@/components/caregiver-device-issues";

export default function CaregiverPage() {
  return (
    <AppShell eyebrow="Caregiver setup" title="Build a clear demo medication plan." description="Create an explicit synthetic care relationship, assign one inert demo pill to Slots 1–7, and define fixed local schedules. This prototype does not provide medical advice.">
      <CaregiverMedicationSetup />
      <CaregiverRefills />
      <CaregiverDeviceIssues />
      <CaregiverAlerts />
      <CaregiverDispenseActivity />
    </AppShell>
  );
}
