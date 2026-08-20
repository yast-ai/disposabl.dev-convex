import { v } from 'convex/values';
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';

const workspaceStatus = v.union(
  v.literal('idle'),
  v.literal('running'),
  v.literal('error'),
);

const messageStatus = v.union(
  v.literal('streaming'),
  v.literal('complete'),
  v.literal('error'),
);

const message = v.object({
  _id: v.id('messages'),
  _creationTime: v.number(),
  role: v.union(v.literal('user'), v.literal('assistant')),
  content: v.string(),
  status: messageStatus,
});

async function requireIdentity(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error('You must be signed in.');
  }
  return identity;
}

async function findWorkspace(ctx: MutationCtx, ownerTokenIdentifier: string) {
  return await ctx.db
    .query('workspaces')
    .withIndex('by_owner_token_identifier', (q) =>
      q.eq('ownerTokenIdentifier', ownerTokenIdentifier),
    )
    .unique();
}

export const getCurrent = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id('workspaces'),
      status: workspaceStatus,
      error: v.union(v.string(), v.null()),
      previews: v.array(
        v.object({
          app: v.string(),
          port: v.number(),
          label: v.string(),
          url: v.string(),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const workspace = await ctx.db
      .query('workspaces')
      .withIndex('by_owner_token_identifier', (q) =>
        q.eq('ownerTokenIdentifier', identity.tokenIdentifier),
      )
      .unique();

    if (!workspace) {
      return null;
    }

    const previews = await ctx.db
      .query('sandboxPreviews')
      .withIndex('by_workspace_id_and_port', (q) =>
        q.eq('workspaceId', workspace._id),
      )
      .take(50);

    return {
      _id: workspace._id,
      status: workspace.status,
      error: workspace.error ?? null,
      previews: previews
        .sort((a, b) => a.port - b.port)
        .map(({ app, port, label, url }) => ({ app, port, label, url })),
    };
  },
});

export const listMessages = query({
  args: {},
  returns: v.array(message),
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const workspace = await ctx.db
      .query('workspaces')
      .withIndex('by_owner_token_identifier', (q) =>
        q.eq('ownerTokenIdentifier', identity.tokenIdentifier),
      )
      .unique();

    if (!workspace) {
      return [];
    }

    const messages = await ctx.db
      .query('messages')
      .withIndex('by_workspace_id', (q) => q.eq('workspaceId', workspace._id))
      .order('desc')
      .take(100);

    return messages.reverse().map(({ _id, _creationTime, role, content, status }) => ({
      _id,
      _creationTime,
      role,
      content,
      status,
    }));
  },
});

export const ensureCurrent = mutation({
  args: {},
  returns: v.id('workspaces'),
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const existing = await findWorkspace(ctx, identity.tokenIdentifier);
    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert('workspaces', {
      ownerTokenIdentifier: identity.tokenIdentifier,
      sessionId: crypto.randomUUID(),
      status: 'idle',
    });
  },
});

export const beginPrompt = internalMutation({
  args: {
    ownerTokenIdentifier: v.string(),
    prompt: v.string(),
    sandboxVersion: v.string(),
  },
  returns: v.object({
    workspaceId: v.id('workspaces'),
    assistantMessageId: v.id('messages'),
    sessionId: v.string(),
    resumeState: v.optional(v.any()),
    previews: v.array(
      v.object({
        app: v.string(),
        port: v.number(),
        label: v.string(),
        url: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    let workspace = await findWorkspace(ctx, args.ownerTokenIdentifier);
    if (!workspace) {
      const workspaceId = await ctx.db.insert('workspaces', {
        ownerTokenIdentifier: args.ownerTokenIdentifier,
        sessionId: crypto.randomUUID(),
        status: 'idle',
      });
      workspace = await ctx.db.get('workspaces', workspaceId);
    }

    if (!workspace) {
      throw new Error('Could not create the workspace.');
    }
    if (workspace.status === 'running') {
      throw new Error('A Codex turn is already running.');
    }

    if (workspace.sandboxVersion !== args.sandboxVersion) {
      const workspaceId = workspace._id;
      const stalePreviews = await ctx.db
        .query('sandboxPreviews')
        .withIndex('by_workspace_id_and_port', (q) =>
          q.eq('workspaceId', workspaceId),
        )
        .take(50);
      for (const preview of stalePreviews) {
        await ctx.db.delete('sandboxPreviews', preview._id);
      }
      await ctx.db.patch('workspaces', workspaceId, {
        sessionId: crypto.randomUUID(),
        sandboxVersion: args.sandboxVersion,
        resumeState: undefined,
      });
      workspace = (await ctx.db.get('workspaces', workspaceId)) ?? workspace;
    }

    await ctx.db.insert('messages', {
      workspaceId: workspace._id,
      role: 'user',
      content: args.prompt,
      status: 'complete',
    });
    const assistantMessageId = await ctx.db.insert('messages', {
      workspaceId: workspace._id,
      role: 'assistant',
      content: '',
      status: 'streaming',
    });
    await ctx.db.patch('workspaces', workspace._id, {
      status: 'running',
      error: undefined,
    });

    const previews = await ctx.db
      .query('sandboxPreviews')
      .withIndex('by_workspace_id_and_port', (q) =>
        q.eq('workspaceId', workspace._id),
      )
      .take(50);

    return {
      workspaceId: workspace._id,
      assistantMessageId,
      sessionId: workspace.sessionId,
      previews: previews.map(({ app, port, label, url }) => ({
        app,
        port,
        label,
        url,
      })),
      ...(workspace.resumeState === undefined
        ? {}
        : { resumeState: workspace.resumeState }),
    };
  },
});

export const appendAssistantText = internalMutation({
  args: {
    messageId: v.id('messages'),
    text: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await ctx.db.get('messages', args.messageId);
    if (!current || current.role !== 'assistant') {
      throw new Error('Assistant message not found.');
    }
    await ctx.db.patch('messages', args.messageId, {
      content: current.content + args.text,
    });
    return null;
  },
});

export const setPreviews = internalMutation({
  args: {
    workspaceId: v.id('workspaces'),
    previews: v.array(
      v.object({
        app: v.string(),
        port: v.number(),
        label: v.string(),
        url: v.string(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await ctx.db
      .query('sandboxPreviews')
      .withIndex('by_workspace_id_and_port', (q) =>
        q.eq('workspaceId', args.workspaceId),
      )
      .take(50);
    const nextApps = new Set(args.previews.map(({ app }) => app));
    for (const preview of current) {
      if (!nextApps.has(preview.app)) {
        await ctx.db.delete('sandboxPreviews', preview._id);
      }
    }

    for (const preview of args.previews) {
      const existing = await ctx.db
        .query('sandboxPreviews')
        .withIndex('by_workspace_id_and_app', (q) =>
          q.eq('workspaceId', args.workspaceId).eq('app', preview.app),
        )
        .unique();
      if (existing) {
        await ctx.db.patch('sandboxPreviews', existing._id, preview);
      } else {
        await ctx.db.insert('sandboxPreviews', {
          workspaceId: args.workspaceId,
          ...preview,
        });
      }
    }
    return null;
  },
});

export const finishPrompt = internalMutation({
  args: {
    workspaceId: v.id('workspaces'),
    messageId: v.id('messages'),
    resumeState: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch('messages', args.messageId, { status: 'complete' });
    await ctx.db.patch('workspaces', args.workspaceId, {
      resumeState: args.resumeState,
      status: 'idle',
      error: undefined,
    });
    return null;
  },
});

export const failPrompt = internalMutation({
  args: {
    workspaceId: v.id('workspaces'),
    messageId: v.id('messages'),
    error: v.string(),
    resumeState: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const messageDoc = await ctx.db.get('messages', args.messageId);
    if (messageDoc) {
      await ctx.db.patch('messages', args.messageId, {
        content: messageDoc.content || args.error,
        status: 'error',
      });
    }
    await ctx.db.patch('workspaces', args.workspaceId, {
      status: 'error',
      error: args.error,
      ...(args.resumeState === undefined
        ? {}
        : { resumeState: args.resumeState }),
    });
    return null;
  },
});
