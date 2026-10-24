export function convexTokenOptions(sessionClaims: unknown) {
  const audience = sessionClaims && typeof sessionClaims === "object" && "aud" in sessionClaims ? sessionClaims.aud : null;
  return audience === "convex" ? {} : { template: "convex" as const };
}

export async function getConvexToken(
  getToken: (options?: { template?: "convex" }) => Promise<string | null>,
  sessionClaims: unknown,
): Promise<string | null> {
  const options = convexTokenOptions(sessionClaims);
  try {
    const token = await getToken(options);
    if (token) return token;
  } catch {
    // Clerk's built-in Convex integration does not require a JWT template.
  }
  if ("template" in options) {
    try {
      return await getToken();
    } catch {
      return null;
    }
  }
  return null;
}
