export type VoiceIntent =
  | { type: "SCHEDULED_DOSE_ASSISTANCE" }
  | { type: "REPORT_TAKEN_OR_NOT_TAKEN"; report: "TAKEN" | "NOT_TAKEN" }
  | { type: "REPORT_DEVICE_PROBLEM" }
  | { type: "AMBIGUOUS"; reason: string }
  | { type: "UNSUPPORTED" };

export type MedicationSessionIntent = "YES" | "READY" | "NO" | "REPEAT" | "REQUEST_MORE_INFORMATION" | "REQUEST_SUPPLY_INFORMATION";

function normalized(text: string) {
  return text.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim();
}

export function parseVoiceIntent(text: string): VoiceIntent {
  const value = normalized(text);
  if (!value) return { type: "UNSUPPORTED" };
  const uncertainty = /\b(maybe|might|not sure|i think|probably|possibly)\b/.test(value);
  const notTaken = /\b(i have not|i haven't|i did not|i didn't|not taken|haven't taken|didn't take|have yet to take)\b/.test(value);
  const taken = /\b(i took|i have taken|i've taken|already took|already taken)\b/.test(value);
  const device = /\b(dispenser|device|machine|pill box)\b/.test(value) && /\b(not working|isn't working|is not working|broken|stuck|problem|issue|fault|disconnected)\b/.test(value);
  const assistance = /\b(ready for|help me with|medication is due|medicine is due|ready to take)\b/.test(value) && /\b(medication|medicine|pill|dose)\b/.test(value);
  const matches = Number(taken || notTaken) + Number(device) + Number(assistance);
  if (uncertainty || taken && notTaken || matches > 1) return { type: "AMBIGUOUS", reason: "The statement is uncertain or contains more than one supported action." };
  if (notTaken) return { type: "REPORT_TAKEN_OR_NOT_TAKEN", report: "NOT_TAKEN" };
  if (taken) return { type: "REPORT_TAKEN_OR_NOT_TAKEN", report: "TAKEN" };
  if (device) return { type: "REPORT_DEVICE_PROBLEM" };
  if (assistance) return { type: "SCHEDULED_DOSE_ASSISTANCE" };
  return { type: "UNSUPPORTED" };
}

export function parseConfirmation(text: string): "CONFIRM" | "CANCEL" | null {
  const value = normalized(text);
  if (/^(confirm|yes confirm|yes that is correct|yes correct)$/.test(value)) return "CONFIRM";
  if (/^(cancel|no cancel|never mind|nevermind)$/.test(value)) return "CANCEL";
  return null;
}

export function parseMedicationSessionIntent(text: string): MedicationSessionIntent | null {
  const value = text.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(yes i m ready|yes i am ready|ready|i am ready|i m ready|ready for my medication|i am ready for my medication|i m ready for my medication)$/.test(value)) return "READY";
  if (/^(yes|yes please|sure|continue|okay|ok)$/.test(value)) return "YES";
  if (/^(no|no thanks|not now|stop|decline)$/.test(value)) return "NO";
  if (/^(repeat|say that again|repeat that)$/.test(value)) return "REPEAT";
  if (/^(more information|tell me more|more info|what else|side effects|tell me about side effects|what are the side effects)$/.test(value)) return "REQUEST_MORE_INFORMATION";
  if (/^(when does my prescription (finish|end)|when (does|will) my (medication|medicine|supply|pills|prescription) run out|how (long|many days) (will|does) my (medication|medicine|supply|prescription) last|when will i run out|how many pills (are left|do i have left))$/.test(value)) return "REQUEST_SUPPLY_INFORMATION";
  return null;
}
