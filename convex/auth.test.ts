/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("auth.confirmation", () => {
  it("rejects a signed-out caller", async () => {
    const t = convexTest(schema, modules);

    await expect(t.query(api.auth.confirmation, {})).rejects.toThrow(
      "Authentication required",
    );
  });

  it("returns only a safe confirmation for an authenticated caller", async () => {
    const t = convexTest(schema, modules).withIdentity({
      tokenIdentifier: "https://test.clerk.invalid|test-user",
    });

    await expect(t.query(api.auth.confirmation, {})).resolves.toEqual({
      authenticated: true,
    });
  });
});
