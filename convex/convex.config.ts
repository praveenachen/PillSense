import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    PILLSENSE_AGENT_SERVICE_SECRET: v.optional(v.string()),
    PILLSENSE_AGENTVERSE_ALLOWED_SENDER: v.optional(v.string()),
  },
});
