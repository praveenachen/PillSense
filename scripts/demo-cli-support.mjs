/**
 * Removes credentials from Convex CLI output before it is shown: the operator identity, JWTs, bearer values,
 * and deploy keys. The useful part of an error (function name, message, error code) is kept.
 */
export function redact(text, tokenIdentifier = "") {
  let out = String(text ?? "");
  if (tokenIdentifier) out = out.split(tokenIdentifier).join("[operator-token]");
  return out
    .replace(/issuer\|[^\s"',}]+/g, "[operator-token]")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[jwt]")
    .replace(/(Bearer|Convex)\s+[A-Za-z0-9._~+/=-]{16,}/gi, "$1 [redacted]")
    .replace(/(?:prod|dev|preview):[A-Za-z0-9_-]+\|[A-Za-z0-9+/=_-]{16,}/g, "[deploy-key]");
}

/**
 * Builds the message for a failed `convex run`. A process that never started has no output, so say why.
 * @param {{ functionName: string, status: number, stdout?: string, stderr?: string, spawnError?: string | null, tokenIdentifier?: string }} failure
 */
export function describeCliFailure({ functionName, status, stdout, stderr, spawnError, tokenIdentifier = "" }) {
  const detail = redact([spawnError, stderr, stdout].filter(Boolean).join("\n"), tokenIdentifier).trim();
  const body = detail ? `:\n${detail.slice(0, 2000)}` : ": the Convex CLI produced no output";
  return `${functionName} failed (exit ${status})${body}`;
}

/**
 * prepare-final reconciles records that already exist, so the configured operator must already own a synthetic
 * patient. Returns a message when it does not (seed would otherwise create a brand-new caregiver, patient, and
 * dispenser for an unmatched identifier and leave the real data untouched), or null when it is safe to continue.
 */
export function teamPreflightProblem(status) {
  if (status?.caregiverAvailable && status?.patientAvailable) return null;
  return [
    status?.caregiverAvailable
      ? "The configured operator has no synthetic demo patient."
      : "No caregiver account in this Convex deployment matches PILLSENSE_DEMO_OPERATOR_TOKEN_IDENTIFIER.",
    "Nothing was changed. Copy the exact tokenIdentifier of the signed-in caregiver from the Convex dashboard (appUsers table),",
    'then set it in .env.local and with: npx.cmd convex env set PILLSENSE_DEMO_OPERATOR_TOKEN_IDENTIFIER "<value>"',
  ].join("\n");
}
