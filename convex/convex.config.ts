import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    PILLSENSE_AGENT_SERVICE_SECRET: v.optional(v.string()),
    PILLSENSE_AGENTVERSE_ALLOWED_SENDER: v.optional(v.string()),
    WALGREENS_REFILL_API_KEY: v.optional(v.string()),
    WALGREENS_REFILL_AFF_ID: v.optional(v.string()),
    WALGREENS_MODE: v.optional(v.string()),
    WALGREENS_CALLBACK_URL: v.optional(v.string()),
    PILLSENSE_DEMO_ENVIRONMENT: v.optional(v.string()),
    PILLSENSE_DEMO_OPERATOR_TOKEN_IDENTIFIER: v.optional(v.string()),
  },
});
