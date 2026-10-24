import { describe, expect, it } from "vitest";
import { parseMedicationScan, productDetailsForSave, scanFormDefaults, scanName } from "./medication-scan";

describe("medication label extraction", () => {
  it("accepts visible Canadian Advil details without inventing missing fields", () => {
    const scan = parseMedicationScan({ brand: "Advil", activeIngredient: "ibuprofen", strength: "200 mg", dosageForm: "tablet", din: null, ndc: null, quantity: null, otherVisibleDetails: [] });
    expect(scanName(scan)).toBe("Advil 200 mg tablet");
    expect(scanFormDefaults(scan)).toEqual({ name: "Advil 200 mg tablet", scheduled: false });
    expect(productDetailsForSave(scan)).toMatchObject({ brand: "Advil", activeIngredient: "ibuprofen", strength: "200 mg", dosageForm: "tablet", otherVisibleDetails: [] });
    expect(productDetailsForSave(scan).quantity).toBeUndefined();
    expect(scan.din).toBeNull();
    expect(scan.quantity).toBeNull();
  });

  it("discards invalid identifiers and rejects oversized or malformed output", () => {
    expect(parseMedicationScan({ brand: "Advil", din: "1234", ndc: "unknown", otherVisibleDetails: [] })).toMatchObject({ din: null, ndc: null });
    expect(() => parseMedicationScan({ brand: ["Advil"] })).toThrow("INVALID_SCAN_RESPONSE");
    expect(() => parseMedicationScan({ brand: "A".repeat(161) })).toThrow("INVALID_SCAN_RESPONSE");
  });
});
