import { describe, expect, it } from "vitest";
import { medicationSaveError } from "./medication-save-error";

describe("medicationSaveError", () => {
  it("explains a stale Convex medication validator without echoing label data", () => {
    const error = new Error("ArgumentValidationError: Object contains extra field `productDetails` that is not in the validator. Object: {name: Advil, din: 01933000}");
    const message = medicationSaveError(error);
    expect(message).toContain("service needs an update");
    expect(message).not.toContain("Advil");
  });

  it("preserves other save errors", () => {
    expect(medicationSaveError(new Error("Slot 2 already has an active medication assignment"))).toContain("Slot 2");
  });
});
