export type MedicationScan = {
  brand: string | null;
  activeIngredient: string | null;
  strength: string | null;
  dosageForm: string | null;
  din: string | null;
  ndc: string | null;
  quantity: string | null;
  otherVisibleDetails: string[];
};

const fields = ["brand", "activeIngredient", "strength", "dosageForm", "din", "ndc", "quantity"] as const;

export function parseMedicationScan(value: unknown): MedicationScan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_SCAN_RESPONSE");
  const record = value as Record<string, unknown>;
  const result = {} as Pick<MedicationScan, (typeof fields)[number]>;
  for (const field of fields) {
    const raw = record[field];
    if (raw !== null && raw !== undefined && (typeof raw !== "string" || raw.length > 160)) throw new Error("INVALID_SCAN_RESPONSE");
    result[field] = typeof raw === "string" ? raw.trim() || null : null;
  }
  if (result.din) {
    const din = result.din.replace(/^DIN\s*:?\s*/i, "").replace(/\s/g, "");
    result.din = /^\d{8}$/.test(din) ? din : null;
  }
  if (result.ndc && !/^\d{4,5}-\d{3,4}-\d{1,2}$/.test(result.ndc)) result.ndc = null;
  const details = record.otherVisibleDetails;
  if (details !== undefined && (!Array.isArray(details) || details.length > 8 || details.some((item) => typeof item !== "string" || item.length > 160))) throw new Error("INVALID_SCAN_RESPONSE");
  return { ...result, otherVisibleDetails: (details ?? []).map((item: string) => item.trim()).filter(Boolean) };
}

/** Medication name is the active ingredient; the brand is only a fallback when no ingredient was readable. */
export function scanName(scan: MedicationScan): string {
  return scan.activeIngredient?.trim() || scan.brand?.trim() || "";
}

/** Pill count from a label quantity such as "100 tablets" or "2 x 50"; null when no count is readable. */
export function packageCount(quantity: string | null | undefined): number | null {
  if (!quantity) return null;
  const multi = quantity.match(/(\d{1,4})\s*[x×]\s*(\d{1,4})/i);
  const count = multi ? Number(multi[1]) * Number(multi[2]) : Number(quantity.match(/\d{1,5}/)?.[0]);
  return Number.isInteger(count) && count > 0 && count <= 10000 ? count : null;
}

export function scanFormDefaults(scan: MedicationScan) {
  return { name: scanName(scan), scheduled: false as const };
}

export function productDetailsForSave(scan: MedicationScan) {
  return {
    brand: scan.brand || undefined, activeIngredient: scan.activeIngredient || undefined,
    strength: scan.strength || undefined, dosageForm: scan.dosageForm || undefined,
    din: scan.din || undefined, ndc: scan.ndc || undefined,
    quantity: scan.quantity || undefined, otherVisibleDetails: scan.otherVisibleDetails,
  };
}
