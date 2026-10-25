import type { Doc } from "../_generated/dataModel";

export type MedicationEducation = {
  code: string;
  sourceTitle: string;
  sourceUrl: string;
  spokenSummary: string;
};

const ibuprofen: MedicationEducation = {
  code: "MEDLINEPLUS_IBUPROFEN",
  sourceTitle: "MedlinePlus Drug Information: Ibuprofen",
  sourceUrl: "https://medlineplus.gov/druginfo/meds/a682159.html",
  spokenSummary: "MedlinePlus lists constipation, gas or bloating, dizziness, nervousness, and ringing in the ears as possible side effects of ibuprofen. This is general education, not personalized medical advice. Follow the package label and ask a pharmacist or clinician about questions or unusual symptoms.",
};

const iron: MedicationEducation = {
  code: "MEDLINEPLUS_IRON",
  sourceTitle: "MedlinePlus Drug Information: Iron Supplements",
  sourceUrl: "https://medlineplus.gov/druginfo/meds/a682778.html",
  spokenSummary: "Iron supplements can cause constipation, stomach pain, diarrhea, or nausea. Contact your clinician if symptoms are severe or do not go away. This is general information from MedlinePlus; a pharmacist can answer questions about your specific product.",
};

/** Only exact, reviewed ingredient/brand matches receive educational copy. */
export function educationForMedication(medication: Doc<"medications">): MedicationEducation | null {
  const ingredient = medication.productDetails?.activeIngredient?.trim().toLocaleLowerCase() ?? "";
  const name = medication.name.trim().toLocaleLowerCase();
  if (ingredient === "ibuprofen" || /\b(?:advil|ibuprofen)\b/.test(name)) return ibuprofen;
  if (["iron", "ferrous sulfate", "ferrous gluconate", "ferrous fumarate"].includes(ingredient) || /^(iron pills|iron supplement|iron supplements|ferrous sulfate|ferrous gluconate|ferrous fumarate)$/.test(name)) return iron;
  return null;
}
