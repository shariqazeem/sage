"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Check, Copy, KeyRound, Loader2, Plus } from "lucide-react";

/**
 * CONNECT YOUR OWN AI AGENT, in Settings. A key per agent, the permissions ticked for it, the setup
 * line for Claude Code, Cursor or any MCP client, and a revoke that works on the agent's next call.
 * The key is shown once; Sage keeps only its hash.
 */
interface KeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: ("read" | "plan" | "launch")[];
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

const SCOPE_LABEL = { read: "read", plan: "plan work", launch: "launch from account" } as const;

function ago(sec: number | null): string {
  if (!sec) return "never used";
  const d = Math.floor(Date.now() / 1000) - sec;
  if (d < 90) return "used just now";
  if (d < 3600) return `used ${Math.round(d / 60)} min ago`;
  if (d < 86_400) return `used ${Math.round(d / 3600)} h ago`;
  return `used ${Math.round(d / 86_400)} d ago`;
}

function Copyable({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="acct-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* nothing to do */
        }
      }}
    >
      {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> {label}</>}
    </button>
  );
}

export function AgentKeysCard() {
  const [keys, setKeys] = useState<KeyView[] | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [plan, setPlan] = useState(true);
  const [launch, setLaunch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [tab, setTab] = useState<"claude" | "cursor" | "any">("claude");
  const [origin, setOrigin] = useState("https://sagepays.xyz");

  const load = async () => {
    try {
      const r = await fetch("/api/workspaces/agent-keys", { cache: "no-store" });
      const j = (await r.json()) as { ok?: boolean; keys?: KeyView[]; limit?: number };
      if (j.ok) {
        setKeys(j.keys ?? []);
        setLimit(j.limit ?? null);
      } else setKeys([]);
    } catch {
      setKeys([]);
    }
  };
  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
  }, []);

  const live = (keys ?? []).filter((k) => !k.revokedAt);
  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/workspaces/agent-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, scopes: [...(plan ? ["plan"] : []), ...(launch ? ["launch"] : [])] }),
      });
      const j = (await r.json()) as { ok?: boolean; key?: string; error?: string };
      if (!j.ok || !j.key) {
        setErr(j.error ?? "Couldn't create the key.");
        return;
      }
      setFresh(j.key);
      setOpen(false);
      setName("");
      setLaunch(false);
      void load();
    } catch {
      setErr("Couldn't reach Sage.");
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    await fetch(`/api/workspaces/agent-keys?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    void load();
  };

  const url = `${origin}/mcp`;
  const key = fresh ?? "sage_sk_…";
  const snippet =
    tab === "claude"
      ? `claude mcp add --transport http sage ${url} --header "Authorization: Bearer ${key}"`
      : tab === "cursor"
        ? JSON.stringify({ mcpServers: { sage: { url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)
        : `URL      ${url}\nHeader   Authorization: Bearer ${key}\nProtocol MCP over streamable HTTP`;

  return (
    <section className="ws-card" id="agents">
      <div className="ws-card-h">
        <h2><Bot size={15} /> AI agents</h2>
        {limit !== null && <span className="ws-chip">{live.length} of {limit}</span>}
      </div>
      <p className="ws-note ag-lede">Connect Claude, Cursor or your own code. Your agent acts as you, only with what you allow here, and stops the moment you revoke it. It can never lift a limit: your plan, your account&apos;s per-job limit and each job&apos;s vault still decide.</p>

      {fresh && (
        <div className="ag-fresh">
          <p className="ag-fresh-t"><KeyRound size={14} /> Copy this key now. Sage won&apos;t show it again.</p>
          <div className="ag-key-row">
            <code className="ag-key">{fresh}</code>
            <Copyable text={fresh} label="Copy key" />
          </div>
        </div>
      )}

      {keys === null ? (
        <p className="ac-empty"><Loader2 size={13} className="sage-spin2" /> Loading…</p>
      ) : live.length === 0 && !fresh ? (
        <p className="ac-empty">No agents connected yet.</p>
      ) : (
        <ul className="ws-list ag-list">
          {live.map((k) => (
            <li key={k.id} className="ws-row">
              <div className="ws-row-main">
                <p className="ws-row-title"><span className="t">{k.name}</span></p>
                <p className="ws-row-meta"><span className="mono">{k.prefix}…</span> · {k.scopes.map((s) => SCOPE_LABEL[s]).join(", ")} · {ago(k.lastUsedAt)}</p>
              </div>
              <div className="ws-row-side">
                <button type="button" className="ws-chip" onClick={() => void revoke(k.id)}>Revoke</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <div className="ag-form">
          <label className="acct-field">
            <span>Name</span>
            <input className="ws-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Claude on my laptop" maxLength={60} disabled={busy} />
          </label>
          <fieldset className="ag-scopes">
            <legend>It may</legend>
            <label><input type="checkbox" checked disabled /> <span><b>Read</b> your jobs, plans, receipts and account balance</span></label>
            <label><input type="checkbox" checked={plan} onChange={(e) => setPlan(e.target.checked)} disabled={busy} /> <span><b>Plan work</b>: design a test, a gig or a grant. Moves no money.</span></label>
            <label><input type="checkbox" checked={launch} onChange={(e) => setLaunch(e.target.checked)} disabled={busy} /> <span><b>Launch jobs from your account</b>: it spends USDC, up to your per-job limit, like your own Launch button.</span></label>
          </fieldset>
          <div className="ac-withdraw-row">
            <button type="button" className="sage-btn sage-btn-primary sage-btn-sm" onClick={() => void create()} disabled={busy || name.trim().length < 2}>
              {busy ? <><Loader2 size={13} className="sage-spin2" /> Creating…</> : "Create key"}
            </button>
            <button type="button" className="sage-btn sage-btn-sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="sage-btn sage-btn-sm ag-connect" onClick={() => { setOpen(true); setFresh(null); }}><Plus size={13} /> Connect an agent</button>
      )}
      {err && <p className="ws-err">{err}</p>}

      <div className="ag-setup">
        <div className="acct-seg" role="tablist" aria-label="Your agent">
          <button type="button" role="tab" aria-selected={tab === "claude"} className={tab === "claude" ? "on" : ""} onClick={() => setTab("claude")}>Claude Code</button>
          <button type="button" role="tab" aria-selected={tab === "cursor"} className={tab === "cursor" ? "on" : ""} onClick={() => setTab("cursor")}>Cursor</button>
          <button type="button" role="tab" aria-selected={tab === "any"} className={tab === "any" ? "on" : ""} onClick={() => setTab("any")}>Any MCP client</button>
        </div>
        <pre className="ag-snippet">{snippet}</pre>
        <div className="ac-withdraw-row">
          <Copyable text={snippet} label="Copy" />
          <Link className="acct-link" href="/docs/build#agents">What your agent can do</Link>
        </div>
      </div>
    </section>
  );
}
