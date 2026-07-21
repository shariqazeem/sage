"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowUp, ArrowUpRight } from "lucide-react";
import { SageMark } from "@/components/brand/sage-mark";
import "./agent-chat.css";

/**
 * P27 — the light, full-page Agent chat (`/agent`). Same plumbing as the retired dark dock — the
 * message model, the `/api/agent` call, the typewriter, `linkify`, the `deployPath` "Fund + launch"
 * hand-off, the keyboard handling, reduced-motion — re-skinned into a premium light surface: a
 * terracotta orb, a big "How can we help you?", one rounded input, and suggestion chips. Money is
 * always a hand-off; `/api/agent` binds identity server-side and exposes no money tools on web.
 */
interface Msg {
  id: number;
  role: "user" | "agent";
  text: string;
  ts: number;
  streaming: boolean;
}

const clock = (ts: number): string =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The deploy hand-off: the same-origin `/launch/<id>` path from a reply → a "Fund + launch" action. */
function deployPath(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s]*(\/launch\/[A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

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
      {n < text.length && <span className="ac-caret" aria-hidden />}
    </>
  );
}

interface Chip {
  text: string;
  send?: boolean;
}
const CHIPS: Chip[] = [
  { text: "Test my app — https://…, budget $10" },
  { text: "Plan a testing campaign for my product" },
  { text: "How does Sage verify testers?", send: true },
  { text: "Show me how a payout proof works", send: true },
];

export function AgentChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [reduced, setReduced] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(1);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, busy, scrollToBottom]);

  const markDone = useCallback((id: number) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, streaming: false } : m)));
  }, []);

  const sendText = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setMessages((prev) => [
        ...prev,
        { id: nextId.current++, role: "user", text, ts: Date.now(), streaming: false },
      ]);
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";
      setBusy(true);
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ text }),
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; reply?: string; error?: string }
          | null;
        const reply =
          data?.reply ?? data?.error ?? "Something glitched reaching me — give it another go in a moment.";
        setMessages((prev) => [
          ...prev,
          { id: nextId.current++, role: "agent", text: reply, ts: Date.now(), streaming: !reduced },
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
    },
    [busy, reduced],
  );

  const onChip = (chip: Chip) => {
    if (chip.send) void sendText(chip.text);
    else {
      setInput(chip.text);
      inputRef.current?.focus();
    }
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendText(input);
    }
  };

  const grow = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  };

  const inputBar = (
    <form
      className="ac-input"
      onSubmit={(e) => {
        e.preventDefault();
        void sendText(input);
      }}
    >
      <textarea
        ref={inputRef}
        rows={1}
        value={input}
        placeholder="Ask Sage to inspect a URL, plan missions, or check a payout…"
        onChange={(e) => setInput(e.target.value)}
        onInput={grow}
        onKeyDown={onInputKey}
        aria-label="Message Sage"
      />
      <button className="ac-send" type="submit" disabled={busy || !input.trim()} aria-label="Send">
        <ArrowUp size={18} strokeWidth={2.2} />
      </button>
    </form>
  );

  return (
    <main className="agent-page">
      {messages.length === 0 ? (
        <div className="ac-empty">
          <div className="ac-orb" aria-hidden>
            <span className="ac-orb-ring" />
            <span className="ac-orb-core">
              <SageMark size={30} />
            </span>
          </div>
          <h1 className="ac-title">How can we help you?</h1>
          <p className="ac-sub">
            I inspect your product, design paid testing missions, and answer questions about any
            campaign or payout. Funding always happens in the wizard or Telegram — never here.
          </p>
          {inputBar}
          <div className="ac-chips">
            {CHIPS.map((c) => (
              <button key={c.text} className="ac-chip" type="button" onClick={() => onChip(c)}>
                {c.text}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="ac-active">
          <div className="ac-scroll" ref={scrollRef}>
            {messages.map((m) => (
              <div key={m.id} className={`ac-msg ${m.role}`}>
                <div className="ac-msg-meta">
                  <span className="ac-msg-who">{m.role === "user" ? "You" : "Sage"}</span>
                  <span>{clock(m.ts)}</span>
                </div>
                <div className="ac-msg-body">
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
                {m.role === "agent" && !m.streaming && deployPath(m.text) && (
                  <a className="ac-fund" href={deployPath(m.text)!}>
                    Fund + launch <ArrowUpRight size={15} strokeWidth={2.2} />
                  </a>
                )}
              </div>
            ))}
            {busy && (
              <div className="ac-msg agent">
                <div className="ac-typing" aria-label="Sage is thinking">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>
          {inputBar}
        </div>
      )}
    </main>
  );
}
