import { describe, expect, it } from "vitest";
import { readMedicationScanResponse } from "./medication-scan-response";

describe("readMedicationScanResponse", () => {
  it("returns extracted label details", async () => {
    const scan = { brand: "Advil", activeIngredient: "ibuprofen", strength: "200 mg", dosageForm: "tablet", din: null, ndc: null, quantity: null, otherVisibleDetails: [] };
    await expect(readMedicationScanResponse(Response.json({ scan }))).resolves.toEqual(scan);
  });

  it("explains empty server errors without exposing a JSON parsing exception", async () => {
    await expect(readMedicationScanResponse(new Response(null, { status: 500 }))).rejects.toThrow("HTTP 500");
  });

  it("explains empty successful responses", async () => {
    await expect(readMedicationScanResponse(new Response(null, { status: 200 }))).rejects.toThrow("empty or invalid response");
  });

  it("maps structured API failures to actionable messages", async () => {
    await expect(readMedicationScanResponse(Response.json({ error: "CLAUDE_NOT_CONFIGURED" }, { status: 503 }))).rejects.toThrow("ANTHROPIC_API_KEY");
    await expect(readMedicationScanResponse(Response.json({ error: "CLAUDE_RATE_LIMITED" }, { status: 429 }))).rejects.toThrow("rate limiting");
  });
});
