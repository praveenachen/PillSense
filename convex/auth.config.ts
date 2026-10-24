import type { AuthConfig } from "convex/server";

// Set this to the issuer shown by Clerk's Convex integration/JWT template.
// Leaving it unset does not grant access; Convex auth will not validate tokens.
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
