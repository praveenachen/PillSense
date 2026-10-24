import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildSlotMedicationInput, SlotMedicationForm } from "./slot-medication-form";
import { parseMedicationScan } from "../lib/medication-scan";

describe("mobile slot medication form", () => {
  it("offers an enabled camera path in the slot picker", () => {
    const html = renderToStaticMarkup(<SlotMedicationForm slot={2} onCancel={() => undefined} />);
    expect(html).toContain("Scan with camera");
    expect(html).not.toContain("Soon");
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>[^<]*Scan with camera/);
  });

  it("keeps a scanned Advil bottle unscheduled with no inferred supply or hardware pill", () => {
    const scan = parseMedicationScan({ brand: "Advil", activeIngredient: "ibuprofen", strength: "200 mg", dosageForm: "tablet", din: null, ndc: null, quantity: null, otherVisibleDetails: [] });
    const form = new FormData();
    form.set("name", "Advil 200 mg tablet");
    const value = buildSlotMedicationInput({ slot: 2, form, days: ["MON"], scheduled: false, scan });
    expect(value).toMatchObject({ name: "Advil 200 mg tablet", scheduled: false, instructions: "", localTime: "", weekdays: [], demoInventory: 0, productDetails: { activeIngredient: "ibuprofen", strength: "200 mg" } });
    expect(value.supplyCount).toBeUndefined();
  });

  it("preserves explicit manual scheduling and caregiver-entered count", () => {
    const form = new FormData();
    form.set("name", "Iron Pills"); form.set("dose", "1"); form.set("unit", "tablet");
    form.set("instruction", "With food"); form.set("localTime", "08:00"); form.set("count", "30");
    expect(buildSlotMedicationInput({ slot: 6, form, days: ["MON"], scheduled: true, scan: null })).toMatchObject({ instructions: "1 tablet · With food", localTime: "08:00", weekdays: ["MON"], supplyCount: 30, demoInventory: 1 });
  });
});
