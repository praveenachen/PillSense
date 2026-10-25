export function medicationSaveError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/ArgumentValidationError/.test(message) && /Object contains extra field [`']?(?:productDetails|scheduled)/.test(message)) {
    return "The medication service needs an update before it can save scanned labels. Keep this form open and try again after the backend is synced.";
  }
  return message || "Could not save the medication. Please try again.";
}
