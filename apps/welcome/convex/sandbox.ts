'use node';

import { prepareHarnessSandboxTemplate } from '@ai-sdk/harness/agent';
import { createCodex } from '@ai-sdk/harness-codex';
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel';
import { v } from 'convex/values';
import { action } from './_generated/server';

const SANDBOX_NAME = 'disposabl-dev-convex' as const;
const REPOSITORY = 'yast-ai/disposabl.dev-convex' as const;
const REPOSITORY_URL = `https://github.com/${REPOSITORY}.git`;
const REPOSITORY_DIRECTORY = 'disposabl.dev-convex' as const;
const HARNESS_PORT = 4000;

const codexHarness = createCodex({
  auth: 'ai-gateway',
});

function getVercelCredentials() {
  const env = (
    globalThis as typeof globalThis & {
      process: { env: Record<string, string | undefined> };
    }
  ).process.env;
  const token = env.VERCEL_TOKEN;
  const teamId = env.VERCEL_TEAM_ID;
  const projectId = env.VERCEL_PROJECT_ID;

  if (token && teamId && projectId) {
    return { token, teamId, projectId };
  }

  if (env.VERCEL_OIDC_TOKEN) {
    return {};
  }

  throw new Error(
    'Vercel Sandbox credentials are missing. Set VERCEL_OIDC_TOKEN or VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID in the Convex deployment.',
  );
}

export const createPersistentSandbox = action({
  args: {},
  returns: v.object({
    harness: v.literal('codex'),
    name: v.literal('disposabl-dev-convex'),
    persistent: v.literal(true),
    repository: v.literal('yast-ai/disposabl.dev-convex'),
    workDir: v.literal('disposabl.dev-convex'),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('You must be signed in to create the sandbox.');
    }

    const sandboxProvider = createVercelSandbox({
      ...getVercelCredentials(),
      name: SANDBOX_NAME,
      source: {
        type: 'git',
        url: REPOSITORY_URL,
        revision: 'main',
        depth: 1,
      },
      runtime: 'node24',
      ports: [HARNESS_PORT],
      persistent: true,
      keepLastSnapshots: { count: 1 },
      tags: {
        app: 'welcome',
        harness: 'codex',
      },
    });

    await prepareHarnessSandboxTemplate({
      harness: codexHarness,
      sandboxProvider,
      sandboxConfig: {
        workDir: REPOSITORY_DIRECTORY,
      },
    });

    return {
      harness: 'codex' as const,
      name: SANDBOX_NAME,
      persistent: true as const,
      repository: REPOSITORY,
      workDir: REPOSITORY_DIRECTORY,
    };
  },
});
