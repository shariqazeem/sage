"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { Sparkles, X, ArrowUp } from "lucide-react";
import "./agent-dock.css";

/**
 * AgentDock — Agent Mode on the web (P25). ONE shared client component, mounted once in the root
 * layout, so the "Agent" pill + ⌘K command bar appear on every app page. It is the SAME agent as the
 * Telegram bot (POST /api/agent → runConciergeWeb); the browser never supplies a clientRef (the server
 * binds it) and there are NO money tools here — funding is always a hand-off to the wizard or Telegram.
 *
 * The overlay derives the current campaign/inspection/proof id from the URL and sends it as page
 * context so "what's the status here?" just works; the server treats that id/label as untrusted data.
 */

interface Msg {
  id: number;
  role: "user" | "agent";
  text: string;
  ts: number;
  streaming: boolean;
}

interface PageContext {
  kind: "campaign" | "inspection" | "submission" | "proof";
  id: string;
}

/** Derive page context from the pathname — only for routes whose URL segment IS the id the read tools
 *  expect (a campaign id, an inspection id, a proof tx). Slugs and index pages yield nothing. */
function derivePageContext(pathname: string | null): PageContext | undefined {
  if (!pathname) return undefined;
  let m = pathname.match(/^\/campaigns?\/([^/]+)/);
  if (m && m[1] !== "new") return { kind: "campaign", id: decodeURIComponent(m[1]) };
  m = pathname.match(/^\/launch\/([^/]+)/);
  if (m) return { kind: "inspection", id: decodeURIComponent(m[1]) };
  m = pathname.match(/^\/proof\/([^/]+)/);
  if (m) return { kind: "proof", id: decodeURIComponent(m[1]) };
  return undefined;
}

const clock = (ts: number): string =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Turn raw URLs in a reply into safe links (the agent relays our own approvalUrl / proof links). */
function linkify(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(https?:\/\/[^\s]+)/g;
  let last = 0;
  let i = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const url = match[1];
    parts.push(
      <a key={i++} href={url} target="_blank" rel="noreferrer noopener">
        {url}
      </a>,
    );
    last = match.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Reveal `text` progressively (a lightweight client-side stream). Reduced motion → instant. */
function Streamed({
  text,
  reduced,
  onTick,
  onDone,
}: {
  text: string;
  reduced: boolean;
  onTick: () => void;
  onDone: () => void;
}) {
  const [n, setN] = useState(reduced ? text.length : 0);
  useEffect(() => {
    if (reduced) {
      onDone();
      return;
    }
    let shown = 0;
    const id = setInterval(() => {
      shown = Math.min(text.length, shown + 3);
      setN(shown);
      onTick();
      if (shown >= text.length) {
        clearInterval(id);
        onDone();
      }
    }, 16);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, reduced]);
  return (
    <>
      {text.slice(0, n)}
      {n < text.length && <span className="agent-caret" aria-hidden />}
    </>
  );
}

export function AgentDock() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [reduced, setReduced] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(1);

  const pageContext = derivePageContext(pathname);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Honor prefers-reduced-motion for the typewriter (CSS motion already collapses via tokens).
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // ⌘K / Ctrl-K toggles Agent mode; Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus the command bar when opening.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (open) scrollToBottom();
  }, [messages, busy, open, scrollToBottom]);

  const markDone = useCallback((id: number) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, streaming: false } : m)),
    );
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    const userMsg: Msg = {
      id: nextId.current++,
      role: "user",
      text,
      ts: Date.now(),
      streaming: false,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          text,
          pageContext: pageContext ?? undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; reply?: string; error?: string }
        | null;
      const reply =
        data?.reply ??
        data?.error ??
        "Something glitched reaching me — give it another go in a moment.";
      setMessages((prev) => [
        ...prev,
        {
          id: nextId.current++,
          role: "agent",
          text: reply,
          ts: Date.now(),
          streaming: !reduced,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId.current++,
          role: "agent",
          text: "I couldn't reach the server just now — check your connection and try again.",
          ts: Date.now(),
          streaming: false,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }, [input, busy, pageContext, reduced]);

  const onInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const grow = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${Math.min(120, el.scrollHeight)}px`;
  };

  // The marketing landing has its own front door; Agent mode is for the app surfaces.
  if (pathname === "/") return null;

  return (
    <div className="agent-dock" data-open={open}>
      <div
        className="agent-scrim"
        onClick={() => setOpen(false)}
        aria-hidden
      />

      <div
        className="agent-panel"
        role="dialog"
        aria-label="Sage Agent mode"
        aria-hidden={!open}
      >
        <div className="agent-head">
          <span className="agent-brand">Sage</span>
          <span className="agent-mode">Agent</span>
          <button
            className="agent-close"
            onClick={() => setOpen(false)}
            aria-label="Close Agent mode"
            type="button"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className="agent-cap">
          I can inspect a product, plan its missions, and answer questions about a
          campaign, inspection, or payout here. Funding happens in the deploy wizard
          or on Telegram.
        </div>

        <div className="agent-scroll" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="agent-msg agent">
              <div className="agent-msg-meta">
                <span className="agent-msg-who">Sage</span>
              </div>
              <div className="agent-msg-body">
                Point me at a product URL with a budget — e.g. “test
                https://myapp.com, budget $10” — and I’ll inspect it and plan paid
                testing missions.
                {pageContext
                  ? ` You’re viewing a ${pageContext.kind}; ask me “what’s the status here?”`
                  : ""}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`agent-msg ${m.role}`}>
              <div className="agent-msg-meta">
                <span className="agent-msg-who">
                  {m.role === "user" ? "You" : "Sage"}
                </span>
                <span>{clock(m.ts)}</span>
              </div>
              <div className="agent-msg-body">
                {m.role === "agent" && m.streaming ? (
                  <Streamed
                    text={m.text}
                    reduced={reduced}
                    onTick={scrollToBottom}
                    onDone={() => markDone(m.id)}
                  />
                ) : m.role === "agent" ? (
                  linkify(m.text)
                ) : (
                  m.text
                )}
              </div>
            </div>
          ))}

          {busy && (
            <div className="agent-msg agent">
              <div className="agent-typing" aria-label="Sage is thinking">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
        </div>

        <form
          className="agent-input"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            placeholder="Ask Sage to inspect a URL, plan missions, or check status…"
            onChange={(e) => setInput(e.target.value)}
            onInput={grow}
            onKeyDown={onInputKey}
            aria-label="Message Sage"
          />
          <button
            className="agent-send"
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="Send"
          >
            <ArrowUp size={18} strokeWidth={2.2} />
          </button>
        </form>
      </div>

      <button
        className="agent-pill"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open Agent mode"
        aria-expanded={open}
        type="button"
      >
        <Sparkles size={17} strokeWidth={2} />
        Agent
        <kbd>⌘K</kbd>
      </button>
    </div>
  );
}
