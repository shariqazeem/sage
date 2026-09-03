"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, Link2, Loader2, Lock, Users, X } from "lucide-react";
import { short, since } from "@/lib/format";
import type { WorkspacePlan, WorkspaceRole } from "@/lib/db/schema";

export interface PeopleView {
  workspace: { id: string; name: string; plan: WorkspacePlan; memberCap: number };
  members: { key: string; address: string | null; role: WorkspaceRole; displayName: string | null; joinedAt: number; viaTelegram: boolean }[];
  memberCount: number;
  me: string;
}

const initials = (m: PeopleView["members"][number]) => (m.displayName?.trim()[0] ?? (m.viaTelegram ? "T" : (m.address ?? m.key).replace(/^0x0*/, "")[0] ?? "?")).toUpperCase();

/** The people of a workspace: who is in, how to bring the next one in, and the plan's cap in plain sight. */
export function PeoplePanel({ workspace: ws, members, memberCount, me }: PeopleView) {
  const router = useRouter();
  const [invite, setInvite] = useState<{ url: string; telegram: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const full = memberCount >= ws.memberCap;

  const mintInvite = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/workspaces/invites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: ws.id }) });
      const json = (await res.json()) as { error?: string; url?: string; telegram?: string };
      if (!res.ok || !json.url || !json.telegram) {
        setErr(json.error ?? "Could not create an invite.");
        return;
      }
      setInvite({ url: json.url, telegram: json.telegram });
    } catch {
      setErr("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      /* the text is visible to select */
    }
  };

  const remove = async (memberKey: string) => {
    if (!confirm("Remove this member from the workspace?")) return;
    const res = await fetch("/api/workspaces/members", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: ws.id, memberKey }) });
    if (res.ok) router.refresh();
  };

  return (
    <main className="ws-shell">
      <div className="ws-head">
        <div>
          <Link href="/workspace" className="ws-chip"><ArrowLeft size={11} /> {ws.name}</Link>
          <h1 className="ws-title" style={{ marginTop: 10 }}>People</h1>
          <p className="ws-sub">{memberCount} of {Number.isFinite(ws.memberCap) ? ws.memberCap : "unlimited"} on the {ws.plan === "pro" ? "Pro" : "Free"} plan. Members see the work you post and get paid to the wallet they joined with.</p>
        </div>
        <div className="ws-row-side">
          {invite ? null : (
            <button className="sage-btn sage-btn-primary sage-btn-sm" onClick={() => void mintInvite()} disabled={busy}>
              {busy ? <><Loader2 size={14} className="sage-spin2" /> Creating…</> : full ? <><Lock size={14} /> Invite (needs Pro)</> : <><Link2 size={14} /> Invite people</>}
            </button>
          )}
        </div>
      </div>

      {invite && (
        <div className="ws-card">
          <div className="ws-card-h"><h2>Share an invite</h2><button className="ws-chip" onClick={() => setInvite(null)} aria-label="Close"><X size={11} /></button></div>
          <p className="ws-empty">Two links, same door. The first joins with a wallet they already have. The second opens Telegram, where Sage gives them a wallet — no app, no seed phrase.</p>
          <div className="ws-invite"><code>{invite.url}</code><button className="sage-btn sage-btn-sm" onClick={() => void copy(invite.url, "web")}>{copied === "web" ? "Copied" : <><Copy size={13} /> Copy</>}</button></div>
          <div className="ws-invite"><code>{invite.telegram}</code><button className="sage-btn sage-btn-sm" onClick={() => void copy(invite.telegram, "tg")}>{copied === "tg" ? "Copied" : <><Copy size={13} /> Copy</>}</button></div>
        </div>
      )}
      {err && <p className="ws-err">{err} {full && <Link href="/workspace/settings">Upgrade in Settings.</Link>}</p>}

      <div className="ws-card">
        <div className="ws-card-h"><h2><Users size={14} /> Members</h2></div>
        <ul className="ws-list">
          {members.map((m) => (
            <li key={m.key} className="ws-row">
              <div className="ws-member">
                <span className="ws-avatar">{initials(m)}</span>
                <div className="ws-row-main">
                  <p className="ws-row-title">{m.displayName ?? (m.address ? short(m.address) : m.key)}</p>
                  <p className="ws-row-meta">{m.role}{m.viaTelegram ? " · joined from Telegram" : ""} · {since(m.joinedAt)}</p>
                </div>
              </div>
              {m.role !== "owner" && m.key !== me && (
                <button className="ws-chip" onClick={() => void remove(m.key)} aria-label="Remove member"><X size={11} /></button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
