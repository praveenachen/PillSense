type ReminderPromptSession = {
  patientFirstName: string;
  isSynthetic?: boolean;
  medicationName: string;
  state: string;
};

/** Opening a persisted reminder resumes its question without advancing its state. */
export function reminderPrompt(session: ReminderPromptSession) {
  if (session.state === "AWAITING_EDUCATION_CHOICE") return `Would you like to hear about possible side effects of ${session.medicationName}?`;
  if (session.state === "AWAITING_CONTINUE" || session.state === "READY_FOR_SUPERVISED_ROUTINE") return "Are you ready to continue with your scheduled routine?";
  if (["PREPARING_DISPENSER", "MOVEMENT_IN_PROGRESS"].includes(session.state)) return "Your dispenser routine has already started. I’m checking its existing status.";
  if (["AWAITING_PATIENT_REPORT", "CAMERA_OBSERVATION_PENDING", "COMPLETED"].includes(session.state)) return "The motor sequence has finished. You can report how your medication routine went.";
  if (session.state === "DECLINED") return "Your reminder is paused.";
  if (session.state !== "AWAITING_READINESS") return "Your previous hardware result needs review before continuing.";
  const name = session.isSynthetic ? "Praveena" : session.patientFirstName;
  return `Hello ${name}! It's time for your ${session.medicationName}. Are you ready for your medication?`;
}
