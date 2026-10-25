import type { MedicationScan } from "./medication-scan";

const errorMessages: Record<string, string> = {
  AUTHENTICATION_REQUIRED: "Sign in again before scanning.",
  AUTHENTICATION_UNAVAILABLE: "Could not verify your sign in. Try again in a moment.",
  CAREGIVER_ACCESS_REQUIRED: "Caregiver setup is required before scanning.",
  CAREGIVER_ACCESS_UNAVAILABLE: "Could not verify caregiver access. Try again in a moment.",
  CONVEX_TOKEN_UNAVAILABLE: "Clerk could not issue a Convex token. Check the Clerk Convex integration or JWT template.",
  CONVEX_ACCESS_CHECK_FAILED: "Convex could not verify caregiver access. Check the Convex deployment and Clerk token setup.",
  CLAUDE_NOT_CONFIGURED: "Add ANTHROPIC_API_KEY to .env.local and restart the dev server.",
  CLAUDE_API_ERROR: "Claude could not analyze this image. Check the API key and model in .env.local, then try again.",
  CLAUDE_RATE_LIMITED: "Claude is rate limiting scans. Wait a moment and try again.",
  PAYLOAD_TOO_LARGE: "That photo is too large to scan. Move closer to the label or choose a smaller photo.",
  RATE_LIMITED: "Too many scans in a short time. Wait a minute, then try again.",
  INVALID_IMAGE: "The camera image could not be uploaded. Try capturing again.",
  SCAN_FAILED: "The scan failed. Try again with the label closer and well lit.",
};

export async function readMedicationScanResponse(response: Response): Promise<MedicationScan> {
  const body = await response.text();
  let result: unknown;
  try {
    result = body ? JSON.parse(body) : null;
  } catch {
    result = null;
  }
  const record = result && typeof result === "object" ? result as { scan?: MedicationScan; error?: string } : null;

  if (!response.ok) {
    if (record?.error && errorMessages[record.error]) throw new Error(errorMessages[record.error]);
    if (response.status === 429) throw new Error(errorMessages.RATE_LIMITED);
    if (response.status === 413) throw new Error("Camera image is too large. Move closer to the label and capture again.");
    throw new Error(`Scanner server returned HTTP ${response.status}. Check the terminal running npm run dev, then try again.`);
  }
  if (!record?.scan) throw new Error("Scanner returned an empty or invalid response. Try again; if it repeats, check the terminal running npm run dev.");
  return record.scan;
}
