import nextEnv from "@next/env";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const command = process.argv[2] ?? "status";
const scenario = process.argv[3];
const deployment = process.env.CONVEX_DEPLOYMENT ?? "";
const tokenIdentifier = process.env.PILLSENSE_DEMO_OPERATOR_TOKEN_IDENTIFIER ?? "";

if (!deployment.startsWith("dev:") && !deployment.startsWith("local:")) {
  console.error("Demo CLI refused: CONVEX_DEPLOYMENT must select a development or local deployment.");
  process.exit(1);
}
if (!tokenIdentifier) {
  console.error("Demo CLI refused: configure PILLSENSE_DEMO_OPERATOR_TOKEN_IDENTIFIER locally and on the Convex development deployment.");
  process.exit(1);
}

if (command === "reset" && !process.argv.includes("--yes")) {
  const prompt = createInterface({ input, output });
  const answer = await prompt.question("Archive current synthetic demo state and restore the baseline? Type RESET to continue: ");
  prompt.close();
  if (answer !== "RESET") {
    console.log("Reset cancelled; no data was changed.");
    process.exit(0);
  }
}

const routes = {
  seed: ["demoCli:seed", {}],
  reset: ["demoCli:reset", {}],
  status: ["demoCli:status", {}],
  scenario: ["demoCli:prepareScenario", { scenario }],
  "advance-missed-dose": ["demoCli:advanceMissedDose", {}],
};
if (!(command in routes)) {
  console.error("Unknown demo command. Use seed, reset, scenario, advance-missed-dose, or status.");
  process.exit(1);
}
if (command === "scenario" && !["onboarding", "successful-dose", "missed-dose", "low-supply"].includes(scenario)) {
  console.error("Scenario must be onboarding, successful-dose, missed-dose, or low-supply.");
  process.exit(1);
}

const identity = JSON.stringify({
  subject: "pillsense-demo-operator",
  issuer: "pillsense-demo-cli",
  tokenIdentifier,
});
const [functionName, args] = routes[command];
const executable = process.platform === "win32" ? "node_modules\\.bin\\convex.cmd" : "node_modules/.bin/convex";
const result = spawnSync(executable, ["run", functionName, JSON.stringify(args), "--identity", identity, "--codegen", "disable", "--typecheck", "disable"], {
  cwd: process.cwd(), encoding: "utf8", stdio: ["inherit", "pipe", "pipe"], shell: false,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
