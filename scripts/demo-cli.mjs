import nextEnv from "@next/env";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describeCliFailure, redact as redactText, teamPreflightProblem } from "./demo-cli-support.mjs";
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

async function ask(question) {
  const prompt = createInterface({ input, output });
  const answer = await prompt.question(question);
  prompt.close();
  return answer.trim();
}

if (command === "reset" && !process.argv.includes("--yes")) {
  const answer = await ask("Archive current synthetic demo state and restore the baseline? Type RESET to continue: ");
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
  "final-status": ["demoCli:finalStatus", {}],
};
const interactive = ["release-slot", "prepare-final"];
if (!(command in routes) && !interactive.includes(command)) {
  console.error("Unknown demo command. Use seed, reset, scenario, advance-missed-dose, status, final-status, release-slot, or prepare-final.");
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
// Run the Convex CLI through Node directly. Spawning node_modules\.bin\convex.cmd without a shell fails with
// EINVAL on current Node releases (it never starts, and prints nothing), so the .cmd shim is not used.
const convexEntry = fileURLToPath(new URL("../node_modules/convex/bin/main.js", import.meta.url));

const redact = (text) => redactText(text, tokenIdentifier);

function convexRun(functionName, args) {
  const result = spawnSync(process.execPath, [convexEntry, "run", functionName, JSON.stringify(args), "--identity", identity, "--codegen", "disable", "--typecheck", "disable"], {
    cwd: process.cwd(), encoding: "utf8", stdio: ["inherit", "pipe", "pipe"], shell: false,
  });
  return {
    status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "",
    // A process that could not start has no output, so surface why instead of failing silently.
    spawnError: result.error ? `${result.error.code ?? "ERROR"}: ${result.error.message}` : null,
  };
}

function runAndPrint(functionName, args) {
  const result = convexRun(functionName, args);
  if (result.stdout) process.stdout.write(redact(result.stdout));
  if (result.stderr) process.stderr.write(redact(result.stderr));
  if (result.spawnError) console.error(`Could not run the Convex CLI (${redact(result.spawnError)}).`);
  return result.status;
}

/** `convex run` prints the function's JSON result; take the JSON document even if log lines precede it. */
function runJson(functionName, args) {
  const result = convexRun(functionName, args);
  if (result.status !== 0) throw new Error(describeCliFailure({ functionName, ...result, tokenIdentifier }));
  const start = result.stdout.search(/[{[]/);
  if (start < 0) throw new Error(`${functionName} returned no JSON result`);
  return JSON.parse(result.stdout.slice(start));
}

/** Shows the slot's active assignment, then requires the exact confirmation phrase. Returns true when released. */
async function releaseSlotFlow(slot) {
  const { assignment } = runJson("demoCli:describeSlot", { slot });
  if (!assignment) {
    console.log(`Slot ${slot} has no active assignment. Nothing to release.`);
    return false;
  }
  console.log(`\nSlot ${slot} currently holds:`);
  console.log(JSON.stringify(assignment, null, 2));
  console.log("Releasing deactivates this assignment (and its medication/schedule if unused elsewhere). History is kept; no device command is sent.");
  const phrase = `RELEASE SLOT ${slot}`;
  const answer = await ask(`Type ${phrase} to continue, anything else cancels: `);
  if (answer !== phrase) {
    console.log("Cancelled; no data was changed.");
    return false;
  }
  const code = runAndPrint("demoCli:releaseSlot", { slot, assignmentId: assignment.assignmentId, confirm: phrase });
  if (code !== 0) throw new Error("Release failed");
  return true;
}

if (command === "release-slot") {
  const slot = Number(process.argv[3]);
  if (!Number.isInteger(slot) || slot < 1 || slot > 7) {
    console.error("Usage: npm run demo:release-slot -- <slot 1-7>");
    process.exit(1);
  }
  try {
    await releaseSlotFlow(slot);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  process.exit(0);
}

/**
 * prepare-final reconciles records that already exist, so the configured operator must already own a synthetic
 * patient. Without this check, seed would silently create a brand-new caregiver, patient, and dispenser for an
 * unmatched identifier and leave the real data (and its scanned Tylenol) untouched. Read-only.
 */
function requireExistingSyntheticTeam() {
  if (!tokenIdentifier.includes("|")) {
    console.error("Warning: PILLSENSE_DEMO_OPERATOR_TOKEN_IDENTIFIER has no '|'. A Clerk tokenIdentifier looks like <issuer-url>|<user id>.");
  }
  const problem = teamPreflightProblem(runJson("demoCli:status", {}));
  if (problem) throw new Error(problem);
}

if (command === "prepare-final") {
  try {
    requireExistingSyntheticTeam();
    console.log("Step 1/3: seeding the synthetic baseline (occupied slots are reported, never overwritten).");
    let seeded = runJson("demoCli:seed", {});
    // Only scanned or caregiver-entered occupants need a decision. A synthetic fixture that is merely in the way
    // (for example Advil still in its old slot) moves itself when the baseline is seeded again.
    const slots = new Set([4, 7, ...seeded.slotConflicts.filter((row) => row.scannedOrUserEntered).map((row) => row.slot)]);
    console.log("Step 2/3: reviewing slots that must be empty or reassigned:", [...slots].sort().join(", "));
    for (const slot of [...slots].sort((a, b) => a - b)) await releaseSlotFlow(slot);
    console.log("Step 3/3: re-seeding and verifying the final layout.");
    seeded = runJson("demoCli:seed", {});
    console.log(JSON.stringify(seeded, null, 2));
    process.exit(runAndPrint("demoCli:finalStatus", {}));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const [functionName, args] = routes[command];
process.exit(runAndPrint(functionName, args));
