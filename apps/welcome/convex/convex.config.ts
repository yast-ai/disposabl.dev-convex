import { defineApp } from 'convex/server';
import { v } from 'convex/values';

export default defineApp({
  env: {
    VERCEL_TOKEN: v.string(),
    VERCEL_TEAM_ID: v.string(),
    VERCEL_PROJECT_ID: v.string(),
    AI_GATEWAY_API_KEY: v.optional(v.string()),
  },
});
