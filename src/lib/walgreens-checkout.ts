export const SANDBOX_TEST_RX = "0459772-59382";

export async function prepareWalgreensCheckout<T extends string>(input: {
  caseId: string;
  approve: (caseId: string) => Promise<{ checkoutId: T }>;
  createSession: (checkoutId: T, idempotencyKey: string, rxNumber: string) => Promise<{ status: string; landingUrl: string | null; environment: "MOCK" | "SANDBOX"; errorCode?: string }>;
}) {
  const approval = await input.approve(input.caseId);
  return input.createSession(approval.checkoutId, `caregiver-ui:${approval.checkoutId}`, SANDBOX_TEST_RX);
}
