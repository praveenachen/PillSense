import { AppShell } from "@/components/app-shell";
import { PatientDashboard } from "@/components/patient-dashboard";
import { PatientReminders } from "@/components/patient-reminders";
import { PatientSupplyReminder } from "@/components/patient-supply-reminder";
import { VoiceCompanion } from "@/components/voice-companion";

export default function PatientPage() {
  return (
    <AppShell eyebrow="Patient view" title="Your demo medication schedule, at a glance." description="Review fixed local schedule information assigned by an authorized caregiver. PillSense does not infer prescriptions or provide medical advice.">
      <PatientDashboard />
      <div className="mt-6"><VoiceCompanion /></div>
      <PatientSupplyReminder />
      <PatientReminders />
    </AppShell>
  );
}
