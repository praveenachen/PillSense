import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { convexTokenOptions, getConvexToken } from "./convex-token";

describe("convexTokenOptions", () => {
  it("uses the session token for Clerk's Convex integration", () => {
    expect(convexTokenOptions({ aud: "convex" })).toEqual({});
  });

  it("uses the JWT template for other Clerk sessions", () => {
    expect(convexTokenOptions({ aud: "other" })).toEqual({ template: "convex" });
    expect(convexTokenOptions(null)).toEqual({ template: "convex" });
  });

  it("falls back to the session token when the template is unavailable", async () => {
    const getToken = vi.fn().mockRejectedValueOnce(new Error("template missing")).mockResolvedValueOnce("integration-token");
    await expect(getConvexToken(getToken, {})).resolves.toBe("integration-token");
    expect(getToken).toHaveBeenNthCalledWith(1, { template: "convex" });
    expect(getToken).toHaveBeenNthCalledWith(2);
  });
});
