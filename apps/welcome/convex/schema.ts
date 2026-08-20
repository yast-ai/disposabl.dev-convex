import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// The schema is entirely optional.
// You can delete this file (schema.ts) and the
// app will continue to work.
// The schema provides more precise TypeScript types.
export default defineSchema({
  numbers: defineTable({
    value: v.number(),
  }),
  workspaces: defineTable({
    ownerTokenIdentifier: v.string(),
    sessionId: v.string(),
    resumeState: v.optional(v.any()),
    status: v.union(
      v.literal('idle'),
      v.literal('running'),
      v.literal('error'),
    ),
    error: v.optional(v.string()),
  }).index('by_owner_token_identifier', ['ownerTokenIdentifier']),
  messages: defineTable({
    workspaceId: v.id('workspaces'),
    role: v.union(v.literal('user'), v.literal('assistant')),
    content: v.string(),
    status: v.union(
      v.literal('streaming'),
      v.literal('complete'),
      v.literal('error'),
    ),
  }).index('by_workspace_id', ['workspaceId']),
  sandboxPreviews: defineTable({
    workspaceId: v.id('workspaces'),
    app: v.string(),
    port: v.number(),
    label: v.string(),
    url: v.string(),
  })
    .index('by_workspace_id_and_app', ['workspaceId', 'app'])
    .index('by_workspace_id_and_port', ['workspaceId', 'port']),
});
