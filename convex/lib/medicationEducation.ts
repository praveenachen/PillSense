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

/** Only exact, reviewed ingredient/brand matches receive educational copy. */
export function educationForMedication(medication: Doc<"medications">): MedicationEducation | null {
  const ingredient = medication.productDetails?.activeIngredient?.trim().toLocaleLowerCase() ?? "";
  const name = medication.name.trim().toLocaleLowerCase();
  if (ingredient === "ibuprofen" || /\b(?:advil|ibuprofen)\b/.test(name)) return ibuprofen;
  return null;
}
