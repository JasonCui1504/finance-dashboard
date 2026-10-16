"use client";

import { useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };

// Mirrors MAX_MESSAGES in lib/finance/assistant.ts: older turns are dropped.
const MAX_MESSAGES = 20;

/**
 * "Ask about your finances": a chat with the local model. Replies are shown
 * as plain text on purpose — never render them as markdown or HTML, which
 * would let a crafted reply load images or links. Nothing is saved; closing
 * the tab forgets the conversation.
 */
export default function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const history = [...messages, { role: "user" as const, content: text }].slice(-MAX_MESSAGES);
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/finance/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let reply = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += decoder.decode(value, { stream: true });
        setMessages([...history, { role: "assistant", content: reply }]);
      }
      if (!reply.trim()) throw new Error("The model returned an empty reply.");
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
      // Drop the empty placeholder reply; keep any partial text.
      setMessages((m) => (m.at(-1)?.content ? m : m.slice(0, -1)));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed right-5 bottom-5 z-40 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-canvas shadow-lg transition-opacity hover:opacity-90"
      >
        Ask about your finances
      </button>
    );
  }

  return (
    <section
      aria-label="Finance assistant"
      className="fixed inset-x-4 bottom-4 z-40 flex max-h-[min(640px,calc(100vh-2rem))] flex-col rounded-xl border border-line bg-surface shadow-2xl sm:left-auto sm:w-[420px]"
    >
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-prose">Ask about your finances</h2>
          <p className="text-xs text-faint">Local Llama model · runs on this Mac · nothing is saved</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {messages.length > 0 && !busy && (
            <button
              onClick={() => {
                setMessages([]);
                setError(null);
              }}
              className="text-xs text-faint transition-colors hover:text-subtle"
            >
              Clear
            </button>
          )}
          <button
            onClick={() => {
              abortRef.current?.abort();
              setOpen(false);
            }}
            aria-label="Close"
            className="text-lg leading-none text-faint transition-colors hover:text-subtle"
          >
            ×
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
        {messages.length === 0 && (
          <div className="flex flex-col gap-2 text-faint">
            <p>Ask about spending, balances, income or trends. Try:</p>
            {[
              "Where did most of my money go last month?",
              "How does this month's spending compare to my average?",
              "Which budgets am I close to going over?",
            ].map((q) => (
              <button
                key={q}
                onClick={() => setInput(q)}
                className="rounded-md border border-line px-3 py-1.5 text-left text-subtle transition-colors hover:border-accent hover:text-prose"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "user"
                  ? "ml-8 self-end rounded-lg bg-accent-dim px-3 py-2 whitespace-pre-wrap text-prose"
                  : "mr-4 whitespace-pre-wrap text-subtle"
              }
            >
              {m.content || (busy && i === messages.length - 1 ? "Thinking…" : "")}
            </div>
          ))}
        </div>
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-end gap-2 border-t border-line p-3"
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          maxLength={4000}
          placeholder="Ask a question…"
          className="flex-1 resize-none rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm text-prose outline-none transition-colors focus:border-accent"
        />
        {busy ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-subtle transition-colors hover:border-accent hover:text-prose"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-canvas transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Send
          </button>
        )}
      </form>
    </section>
  );
}
