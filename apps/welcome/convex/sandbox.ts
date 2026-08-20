'use node';

import {
  HarnessAgent,
  getHarnessErrorMessage,
  prepareHarnessSandboxTemplate,
  type HarnessAgentResumeSessionState,
  type HarnessAgentSession,
} from '@ai-sdk/harness/agent';
import type { HarnessV1NetworkSandboxSession } from '@ai-sdk/harness';
import { createCodex } from '@ai-sdk/harness-codex';
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, env } from './_generated/server';

const SANDBOX_NAME = 'disposabl-dev-convex-v2' as const;
const SANDBOX_VERSION = 'repository-root-v2' as const;
const REPOSITORY = 'yast-ai/disposabl.dev-convex' as const;
const REPOSITORY_URL = `https://github.com/${REPOSITORY}.git`;
const REPOSITORY_DIRECTORY = 'disposabl.dev-convex' as const;
const HARNESS_PORT = 4000;
const FIRST_PREVIEW_PORT = 5173;
const BUN_VERSION = '1.3.14' as const;
const DEPENDENCY_BOOTSTRAP_HASH =
  'bun-1.3.14-lock-d82270b3889af261-repository-root-v2' as const;

const codexHarness = createCodex({
  auth: 'ai-gateway',
  model: 'gpt-5.6-luna',
  reasoningEffort: 'low',
  codexConfig: {
    service_tier: 'flex',
  },
});

const sandboxProvider = createVercelSandbox({
  token: env.VERCEL_TOKEN,
  teamId: env.VERCEL_TEAM_ID,
  projectId: env.VERCEL_PROJECT_ID,
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

type SandboxConfig = NonNullable<
  ConstructorParameters<typeof HarnessAgent>[0]['sandboxConfig']
>;

const sandboxConfig = {
  workDir: REPOSITORY_DIRECTORY,
  bootstrapHash: DEPENDENCY_BOOTSTRAP_HASH,
  onBootstrap: async ({ session, workDir, abortSignal }) => {
    const result = await session.run({
      command:
        'npm install --global "bun@$BUN_VERSION" && SANDBOX_ROOT=$(dirname "$WORK_DIR") && mkdir -p "$WORK_DIR" && find "$SANDBOX_ROOT" -mindepth 1 -maxdepth 1 ! -name "$(basename "$WORK_DIR")" -exec cp -a {} "$WORK_DIR/" \\; && cd "$WORK_DIR" && test -f package.json && test -f apps/welcome/package.json && test -f apps/hello-world/package.json && bun install --frozen-lockfile',
      env: {
        BUN_VERSION,
        WORK_DIR: workDir,
      },
      abortSignal,
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `Sandbox dependency installation failed: ${result.stderr || result.stdout}`,
      );
    }
  },
} satisfies SandboxConfig;

const agent = new HarnessAgent({
  harness: codexHarness,
  sandbox: sandboxProvider,
  sandboxConfig,
  instructions:
    'Work in this repository. Keep both Vite apps running. Make focused changes, preserve user work, and verify the affected app before finishing.',
});

function asResumeState(value: unknown): HarnessAgentResumeSessionState | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value as HarnessAgentResumeSessionState;
}

type Preview = {
  app: string;
  port: number;
  label: string;
  url: string;
};

function getNetworkSandboxSession(session: HarnessAgentSession) {
  return (
    session as HarnessAgentSession & {
      getSandboxSession(): HarnessV1NetworkSandboxSession;
    }
  ).getSandboxSession();
}

function appLabel(app: string) {
  return app
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

async function discoverApps(sandboxSession: HarnessV1NetworkSandboxSession) {
  const result = await sandboxSession.run({
    command:
      'cd "$WORK_DIR" && find apps -mindepth 2 -maxdepth 2 -name package.json -print | sort',
    env: { WORK_DIR: `${sandboxSession.defaultWorkingDirectory}/${REPOSITORY_DIRECTORY}` },
  });
  if (result.exitCode !== 0) {
    throw new Error(`Could not discover apps: ${result.stderr || result.stdout}`);
  }

  return result.stdout
    .split('\n')
    .map((line) => /^apps\/([^/]+)\/package\.json$/.exec(line.trim())?.[1])
    .filter((app): app is string => Boolean(app));
}

async function syncPreviews({
  sandboxSession,
  apps,
  existing,
}: {
  sandboxSession: HarnessV1NetworkSandboxSession;
  apps: string[];
  existing: Preview[];
}) {
  const existingByApp = new Map(existing.map((preview) => [preview.app, preview]));
  const usedPorts = new Set(existing.map(({ port }) => port));
  let nextPort = FIRST_PREVIEW_PORT;
  const assigned = apps.map((app) => {
    const current = existingByApp.get(app);
    if (current) return { app, port: current.port };
    while (usedPorts.has(nextPort)) nextPort += 1;
    const port = nextPort;
    usedPorts.add(port);
    nextPort += 1;
    return { app, port };
  });

  await sandboxSession.setPorts?.([
    HARNESS_PORT,
    ...assigned.map(({ port }) => port),
  ]);

  for (const { app, port } of assigned) {
    const result = await sandboxSession.run({
      command:
        'if ! curl --silent --fail "http://127.0.0.1:$PORT" >/dev/null; then cd "$WORK_DIR/apps/$APP" && nohup env __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.vercel.run bun run vite --host 0.0.0.0 --port "$PORT" >"/tmp/$APP-vite.log" 2>&1 </dev/null & fi',
      env: {
        APP: app,
        PORT: String(port),
        WORK_DIR: `${sandboxSession.defaultWorkingDirectory}/${REPOSITORY_DIRECTORY}`,
      },
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `Could not start ${app} on port ${port}: ${result.stderr || result.stdout}`,
      );
    }
  }

  return await Promise.all(
    assigned.map(async ({ app, port }) => ({
      app,
      port,
      label: appLabel(app),
      url: (await sandboxSession.getPortEndpoint({ port })).url,
    })),
  );
}

export const createPersistentSandbox = action({
  args: {},
  returns: v.object({
    harness: v.literal('codex'),
    name: v.literal('disposabl-dev-convex-v2'),
    persistent: v.literal(true),
    repository: v.literal('yast-ai/disposabl.dev-convex'),
    workDir: v.literal('disposabl.dev-convex'),
  }),
  handler: async () => {
    await prepareHarnessSandboxTemplate({
      harness: codexHarness,
      sandboxProvider,
      sandboxConfig,
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

export const sendPrompt = action({
  args: { prompt: v.string() },
  returns: v.object({
    workspaceId: v.id('workspaces'),
    messageId: v.id('messages'),
  }),
  handler: async (ctx, args): Promise<{
    workspaceId: Id<'workspaces'>;
    messageId: Id<'messages'>;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('You must be signed in to send a prompt.');
    }
    const prompt = args.prompt.trim();
    if (!prompt) {
      throw new Error('Enter a prompt first.');
    }
    if (prompt.length > 20_000) {
      throw new Error('Prompts must be 20,000 characters or fewer.');
    }
    if (!env.AI_GATEWAY_API_KEY) {
      throw new Error(
        'AI_GATEWAY_API_KEY is missing from the Convex environment.',
      );
    }

    const promptState: {
      workspaceId: Id<'workspaces'>;
      assistantMessageId: Id<'messages'>;
      sessionId: string;
      resumeState?: unknown;
      previews: Preview[];
    } = await ctx.runMutation(internal.workspace.beginPrompt, {
      ownerTokenIdentifier: identity.tokenIdentifier,
      prompt,
      sandboxVersion: SANDBOX_VERSION,
    });

    let session: HarnessAgentSession | undefined;
    let recoveredResumeState: HarnessAgentResumeSessionState | undefined;

    try {
      const resumeFrom = asResumeState(promptState.resumeState);
      session = await agent.createSession(
        resumeFrom
          ? { sessionId: promptState.sessionId, resumeFrom }
          : { sessionId: promptState.sessionId },
      );

      const sandboxSession = getNetworkSandboxSession(session);
      let apps = await discoverApps(sandboxSession);
      let previews = await syncPreviews({
        sandboxSession,
        apps,
        existing: promptState.previews,
      });
      await ctx.runMutation(internal.workspace.setPreviews, {
        workspaceId: promptState.workspaceId,
        previews,
      });

      const result = await agent.stream({ session, prompt });
      let lastAppCheck = Date.now();
      for await (const part of result.stream) {
        if (part.type === 'text-delta' && part.text) {
          await ctx.runMutation(internal.workspace.appendAssistantText, {
            messageId: promptState.assistantMessageId,
            text: part.text,
          });
        }
        if (Date.now() - lastAppCheck >= 1_500) {
          lastAppCheck = Date.now();
          const discovered = await discoverApps(sandboxSession);
          if (discovered.join('\0') !== apps.join('\0')) {
            previews = await syncPreviews({
              sandboxSession,
              apps: discovered,
              existing: previews,
            });
            apps = discovered;
            await ctx.runMutation(internal.workspace.setPreviews, {
              workspaceId: promptState.workspaceId,
              previews,
            });
          }
        }
      }

      const finalApps = await discoverApps(sandboxSession);
      if (finalApps.join('\0') !== apps.join('\0')) {
        previews = await syncPreviews({
          sandboxSession,
          apps: finalApps,
          existing: previews,
        });
        await ctx.runMutation(internal.workspace.setPreviews, {
          workspaceId: promptState.workspaceId,
          previews,
        });
      }

      recoveredResumeState = await session.detach();
      await ctx.runMutation(internal.workspace.finishPrompt, {
        workspaceId: promptState.workspaceId,
        messageId: promptState.assistantMessageId,
        resumeState: recoveredResumeState,
      });

      return {
        workspaceId: promptState.workspaceId,
        messageId: promptState.assistantMessageId,
      };
    } catch (error) {
      if (session) {
        try {
          recoveredResumeState = await session.detach();
        } catch {
          recoveredResumeState = undefined;
        }
      }

      const safeMessage = getHarnessErrorMessage(error);
      await ctx.runMutation(internal.workspace.failPrompt, {
        workspaceId: promptState.workspaceId,
        messageId: promptState.assistantMessageId,
        error: safeMessage,
        ...(recoveredResumeState === undefined
          ? {}
          : { resumeState: recoveredResumeState }),
      });
      throw new Error(safeMessage);
    }
  },
});
