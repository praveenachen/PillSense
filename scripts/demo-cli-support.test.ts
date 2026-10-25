import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeCliFailure, redact, teamPreflightProblem } from "./demo-cli-support.mjs";

const token = "https://example.clerk.accounts.dev|user_2abcDEF123456789";

describe("demo CLI error reporting", () => {
  it("shows the underlying Convex error but never the operator token or other credentials", () => {
    const message = describeCliFailure({
      functionName: "demoCli:seed", status: 1, tokenIdentifier: token, stdout: "",
      stderr: `✖ Failed to run function "demoCli:seed":\nConvexError: Demo CLI operator is not authorized\n--identity {"tokenIdentifier":"${token}"}\nAuthorization: Bearer abcdefghijklmnop1234567890\neyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3OCJ9.c2lnbmF0dXJl\ndev:happy-animal-123|aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb`,
    });
    expect(message).toContain("demoCli:seed failed (exit 1)");
    expect(message).toContain("Demo CLI operator is not authorized");
    for (const secret of [token, "user_2abcDEF123456789", "abcdefghijklmnop1234567890", "c2lnbmF0dXJl", "aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb"]) {
      expect(message).not.toContain(secret);
    }
  });

  it("explains a CLI process that never started instead of failing silently", () => {
    const message = describeCliFailure({
      functionName: "demoCli:seed", status: 1, stdout: "", stderr: "", spawnError: "EINVAL: spawnSync convex.cmd EINVAL",
    });
    expect(message).toContain("EINVAL");
    expect(describeCliFailure({ functionName: "demoCli:seed", status: 1, stdout: "", stderr: "" })).toContain("produced no output");
  });

  it("redacts a bare token identifier", () => {
    expect(redact(`value ${token} end`, token)).toBe("value [operator-token] end");
    expect(redact("issuer|subject-part", "")).toBe("[operator-token]");
  });

  it("does not spawn the .cmd shim, which fails silently with EINVAL on current Node", () => {
    const source = readFileSync(new URL("./demo-cli.mjs", import.meta.url), "utf8");
    expect(source).not.toMatch(/spawnSync\([^)]*convex\.cmd/);
    expect(source).toContain("process.execPath");
    expect(source).toContain("node_modules/convex/bin/main.js");
    expect(source).toContain("spawnError");
  });
});

describe("prepare-final preflight", () => {
  it("refuses, with nothing written, when no caregiver matches the configured identifier", () => {
    const problem = teamPreflightProblem({ environment: "development", caregiverAvailable: false, patientAvailable: false });
    expect(problem).toContain("No caregiver account");
    expect(problem).toContain("Nothing was changed");
    expect(problem).not.toContain("|");
  });

  it("refuses when the operator has no synthetic patient, and allows a complete team", () => {
    expect(teamPreflightProblem({ caregiverAvailable: true, patientAvailable: false })).toContain("no synthetic demo patient");
    expect(teamPreflightProblem({ caregiverAvailable: true, patientAvailable: true })).toBeNull();
  });
});
