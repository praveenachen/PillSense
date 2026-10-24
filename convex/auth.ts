import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireIdentity } from "./lib/requireIdentity";

/** Safe end-to-end confirmation that Convex accepted the current Clerk token. */
export const confirmation = query({
  args: {},
  returns: v.object({ authenticated: v.literal(true) }),
  handler: async (ctx) => {
    await requireIdentity(ctx);
    return { authenticated: true as const };
  },
});
