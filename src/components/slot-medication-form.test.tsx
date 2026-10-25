import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildSlotMedicationInput,
  claimMedicationSave,
  SlotMedicationForm,
} from "./slot-medication-form";
import { parseMedicationScan } from "../lib/medication-scan";

describe("mobile slot medication form", () => {
  it("claims one save dispatch and suppresses duplicate clicks", () => {
    const inFlight = { current: false };
    expect(claimMedicationSave(inFlight)).toBe(true);
    expect(claimMedicationSave(inFlight)).toBe(false);
  });

  it("offers an enabled camera path in the slot picker", () => {
    const html = renderToStaticMarkup(<SlotMedicationForm slot={2} onCancel={() => undefined} />);
    expect(html).toContain("Scan with camera");
    expect(html).not.toContain("Soon");
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>[^<]*Scan with camera/);
  });

  it("keeps a scanned Advil bottle unscheduled with no inferred supply or hardware pill", () => {
    const scan = parseMedicationScan({ brand: "Advil", activeIngredient: "ibuprofen", strength: "200 mg", dosageForm: "tablet", din: null, ndc: null, quantity: null, otherVisibleDetails: [] });
    const form = new FormData();
    form.set("name", "ibuprofen");
    const value = buildSlotMedicationInput({ slot: 2, form, days: ["MON"], scheduled: false, scan });
    expect(value).toMatchObject({ name: "ibuprofen", scheduled: false, instructions: "", localTime: "", weekdays: [], demoInventory: 0, productDetails: { activeIngredient: "ibuprofen", strength: "200 mg" } });
    expect(value.supplyCount).toBeUndefined();
  });

  it("assumes the package quantity unless a verified supply is entered", () => {
    const scan = parseMedicationScan({ brand: "Advil", activeIngredient: "ibuprofen", strength: "200 mg", dosageForm: "tablet", din: null, ndc: null, quantity: "100 tablets", otherVisibleDetails: [] });
    const assumed = new FormData(); assumed.set("name", "ibuprofen"); assumed.set("count", "");
    expect(buildSlotMedicationInput({ slot: 2, form: assumed, days: [], scheduled: false, scan }).supplyCount).toBe(100);
    const verified = new FormData(); verified.set("name", "ibuprofen"); verified.set("count", "60");
    expect(buildSlotMedicationInput({ slot: 2, form: verified, days: [], scheduled: false, scan }).supplyCount).toBe(60);
  });

  it("preserves explicit manual scheduling and caregiver-entered count", () => {
    const form = new FormData();
    form.set("name", "Iron Pills"); form.set("dose", "1"); form.set("unit", "tablet");
    form.set("instruction", "With food"); form.set("localTime", "08:00"); form.set("count", "30");
    expect(buildSlotMedicationInput({ slot: 6, form, days: ["MON"], scheduled: true, scan: null })).toMatchObject({ instructions: "1 tablet · With food", localTime: "08:00", weekdays: ["MON"], supplyCount: 30, demoInventory: 1 });
  });
});
