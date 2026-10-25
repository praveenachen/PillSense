import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to the limit, then reports when to retry", () => {
    const check = createRateLimiter([{ limit: 2, windowMs: 60_000 }]);
    expect(check("a", 0)).toEqual({ allowed: true });
    expect(check("a", 1_000)).toEqual({ allowed: true });
    expect(check("a", 2_000)).toEqual({ allowed: false, retryAfterSeconds: 58 });
    expect(check("a", 60_001)).toEqual({ allowed: true });
  });

  it("tracks users independently and enforces every window", () => {
    const check = createRateLimiter([{ limit: 2, windowMs: 1_000 }, { limit: 3, windowMs: 10_000 }]);
    expect(check("a", 0).allowed).toBe(true);
    expect(check("a", 1_100).allowed).toBe(true);
    expect(check("a", 2_200).allowed).toBe(true);
    expect(check("a", 3_300).allowed).toBe(false);
    expect(check("b", 3_300).allowed).toBe(true);
  });

  it("does not count rejected attempts against the window", () => {
    const check = createRateLimiter([{ limit: 1, windowMs: 1_000 }]);
    expect(check("a", 0).allowed).toBe(true);
    expect(check("a", 500).allowed).toBe(false);
    expect(check("a", 1_001).allowed).toBe(true);
  });
});
