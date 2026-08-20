import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@workos-inc/authkit-react';
import {
  Authenticated,
  Unauthenticated,
  useAction,
  useMutation,
  useQuery,
} from 'convex/react';
import { api } from '../convex/_generated/api';

export default function App() {
  return (
    <div className="min-h-screen bg-[#f4f1e9] text-[#17211b]">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[#17211b]/15 bg-[#f4f1e9]/90 px-5 backdrop-blur md:px-8">
        <div className="flex items-center gap-3">
          <div className="grid size-8 place-items-center rounded-full bg-[#17211b] text-sm font-semibold text-[#f4f1e9]">
            W
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">Welcome</p>
            <p className="text-[11px] text-[#17211b]/55">Codex workspace</p>
          </div>
        </div>
        <AuthButton />
      </header>

      <Authenticated>
        <Workspace />
      </Authenticated>
      <Unauthenticated>
        <SignedOut />
      </Unauthenticated>
    </div>
  );
}

function AuthButton() {
  const { user, signIn, signOut } = useAuth();

  return (
    <button
      type="button"
      onClick={() => (user ? void signOut() : void signIn())}
      className="rounded-full border border-[#17211b]/20 bg-white px-4 py-2 text-sm font-medium shadow-sm transition hover:border-[#17211b]/45 hover:shadow"
    >
      {user ? 'Sign out' : 'Sign in'}
    </button>
  );
}

function SignedOut() {
  const { signIn } = useAuth();

  return (
    <main className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-3xl place-items-center px-6 py-16 text-center">
      <div>
        <p className="mb-5 text-xs font-semibold uppercase tracking-[0.24em] text-[#d25b35]">
          Persistent development sandbox
        </p>
        <h1 className="text-balance text-5xl font-semibold tracking-[-0.05em] md:text-7xl">
          Build in Codex. Watch both apps change.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-pretty text-base leading-7 text-[#17211b]/65 md:text-lg">
          Sign in to send prompts, follow the response as Convex stores it, and preview every app without leaving the page.
        </p>
        <button
          type="button"
          onClick={() => void signIn()}
          className="mt-9 rounded-full bg-[#17211b] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#17211b]/15 transition hover:-translate-y-0.5"
        >
          Sign in to start
        </button>
      </div>
    </main>
  );
}

function Workspace() {
  const ensureWorkspace = useMutation(api.workspace.ensureCurrent);
  const workspace = useQuery(api.workspace.getCurrent);
  const messages = useQuery(api.workspace.listMessages);
  const sendPrompt = useAction(api.sandbox.sendPrompt);
  const [prompt, setPrompt] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activePort, setActivePort] = useState<number | null>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void ensureWorkspace();
  }, [ensureWorkspace]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!workspace?.previews.length) return;
    if (!workspace.previews.some(({ port }) => port === activePort)) {
      setActivePort(workspace.previews[0].port);
    }
  }, [activePort, workspace?.previews]);

  const running = workspace?.status === 'running' || submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!nextPrompt || running) return;

    setPrompt('');
    setSubmitError(null);
    setSubmitting(true);
    try {
      await sendPrompt({ prompt: nextPrompt });
    } catch (error) {
      setPrompt(nextPrompt);
      setSubmitError(error instanceof Error ? error.message : 'The prompt failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-[calc(100vh-4rem)] grid-cols-1 xl:grid-cols-[minmax(360px,0.78fr)_minmax(0,1.5fr)]">
      <section className="flex min-h-[620px] flex-col border-b border-[#17211b]/15 bg-white xl:h-[calc(100vh-4rem)] xl:border-b-0 xl:border-r">
        <div className="border-b border-[#17211b]/10 px-5 py-5 md:px-7">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#17211b]/45">
                Conversation
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">disposabl-dev-convex</h1>
            </div>
            <Status status={workspace?.status ?? 'idle'} />
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-6 md:px-7">
          {messages === undefined ? (
            <p className="text-sm text-[#17211b]/50">Loading messages...</p>
          ) : messages.length === 0 ? (
            <div className="grid h-full min-h-64 place-items-center rounded-2xl border border-dashed border-[#17211b]/20 bg-[#f8f6f0] p-8 text-center">
              <div>
                <p className="text-lg font-semibold">Ask Codex to change either app.</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#17211b]/55">
                  The reply is saved as it arrives. Preview tabs appear when the sandbox session starts.
                </p>
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <article
                key={message._id}
                className={
                  message.role === 'user'
                    ? 'ml-8 rounded-2xl rounded-br-md bg-[#17211b] px-4 py-3 text-white'
                    : 'mr-4 rounded-2xl rounded-bl-md border border-[#17211b]/10 bg-[#f4f1e9] px-4 py-3'
                }
              >
                <div className="mb-1.5 flex items-center justify-between gap-4 text-[11px] font-semibold uppercase tracking-[0.14em] opacity-55">
                  <span>{message.role === 'user' ? 'You' : 'Codex'}</span>
                  {message.status === 'streaming' && <span className="animate-pulse">Writing</span>}
                  {message.status === 'error' && <span>Error</span>}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6">
                  {message.content || 'Starting the sandbox...'}
                </p>
              </article>
            ))
          )}
          <div ref={messageEndRef} />
        </div>

        <form onSubmit={handleSubmit} className="border-t border-[#17211b]/10 bg-[#faf9f5] p-4 md:p-5">
          <label htmlFor="prompt" className="sr-only">
            Prompt Codex
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Describe what you want Codex to change..."
            rows={4}
            disabled={running}
            className="w-full resize-none rounded-2xl border border-[#17211b]/20 bg-white px-4 py-3 text-sm leading-6 outline-none transition placeholder:text-[#17211b]/35 focus:border-[#d25b35] focus:ring-4 focus:ring-[#d25b35]/10 disabled:cursor-wait disabled:bg-[#f4f1e9]"
          />
          <div className="mt-3 flex items-center justify-between gap-4">
            <p className="text-xs text-[#17211b]/45">Enter to send. Shift + Enter for a new line.</p>
            <button
              type="submit"
              disabled={running || !prompt.trim()}
              className="rounded-full bg-[#d25b35] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#b94728] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {running ? 'Codex is working' : 'Send prompt'}
            </button>
          </div>
          {(submitError || workspace?.error) && (
            <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
              {submitError ?? workspace?.error}
            </p>
          )}
        </form>
      </section>

      <PreviewPanel
        previews={workspace?.previews ?? []}
        activePort={activePort}
        onSelect={setActivePort}
      />
    </main>
  );
}

function Status({ status }: { status: 'idle' | 'running' | 'error' }) {
  const label = status === 'running' ? 'Working' : status === 'error' ? 'Needs attention' : 'Ready';
  const dot = status === 'running' ? 'bg-amber-500' : status === 'error' ? 'bg-red-500' : 'bg-emerald-500';

  return (
    <div className="flex shrink-0 items-center gap-2 rounded-full border border-[#17211b]/10 bg-[#f8f6f0] px-3 py-1.5 text-xs font-medium">
      <span className={`size-2 rounded-full ${dot} ${status === 'running' ? 'animate-pulse' : ''}`} />
      {label}
    </div>
  );
}

function PreviewPanel({
  previews,
  activePort,
  onSelect,
}: {
  previews: Array<{ port: number; label: string; url: string }>;
  activePort: number | null;
  onSelect: (port: number) => void;
}) {
  const active = previews.find(({ port }) => port === activePort) ?? previews[0];

  return (
    <section className="flex min-h-[720px] flex-col bg-[#ebe7dc] xl:h-[calc(100vh-4rem)]">
      <div className="flex min-h-16 items-end justify-between gap-4 border-b border-[#17211b]/15 px-4 pt-4 md:px-6">
        <div className="flex min-w-0 gap-1 overflow-x-auto">
          {previews.length === 0 ? (
            <div className="mb-3 text-sm font-medium text-[#17211b]/45">Preview tabs will appear here</div>
          ) : (
            previews.map((preview) => (
              <button
                key={preview.port}
                type="button"
                onClick={() => onSelect(preview.port)}
                className={`min-w-32 rounded-t-xl border border-b-0 px-4 py-3 text-left text-sm transition ${
                  active?.port === preview.port
                    ? 'border-[#17211b]/20 bg-white font-semibold'
                    : 'border-transparent bg-transparent text-[#17211b]/55 hover:bg-white/45'
                }`}
              >
                <span className="block truncate">{preview.label}</span>
                <span className="mt-0.5 block text-[10px] font-normal text-[#17211b]/40">Port {preview.port}</span>
              </button>
            ))
          )}
        </div>
        {active && (
          <a
            href={active.url}
            target="_blank"
            rel="noreferrer"
            className="mb-3 shrink-0 text-xs font-semibold text-[#17211b]/55 underline decoration-[#17211b]/25 underline-offset-4 hover:text-[#17211b]"
          >
            Open preview
          </a>
        )}
      </div>

      <div className="relative flex-1 p-3 md:p-5">
        {previews.length === 0 ? (
          <div className="grid h-full min-h-[560px] place-items-center overflow-hidden rounded-2xl border border-[#17211b]/15 bg-[#f4f1e9] shadow-sm">
            <div className="max-w-md px-8 text-center">
              <div className="mx-auto grid size-14 place-items-center rounded-2xl border border-[#17211b]/15 bg-white text-xl">↗</div>
              <h2 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">Live previews start with your first prompt.</h2>
              <p className="mt-3 text-sm leading-6 text-[#17211b]/55">
                Welcome and Hello World run on separate ports. Vite refreshes each iframe as Codex edits the files.
              </p>
            </div>
          </div>
        ) : (
          previews.map((preview) => (
            <iframe
              key={preview.port}
              title={`${preview.label} preview`}
              src={preview.url}
              sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
              className={`h-full min-h-[560px] w-full rounded-2xl border border-[#17211b]/15 bg-white shadow-sm ${
                preview.port === active?.port ? 'block' : 'hidden'
              }`}
            />
          ))
        )}
      </div>
    </section>
  );
}
