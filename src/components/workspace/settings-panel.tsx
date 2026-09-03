"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Link2, Loader2, LogOut, Wallet } from "lucide-react";
import { short } from "@/lib/format";
import { useFounderSession } from "@/lib/auth/use-founder-session";
import { FounderSignIn } from "@/components/wallet/founder-sign-in";
import { ProPay } from "./pro-pay";
import type { WorkspacePlan } from "@/lib/db/schema";

export interface SettingsView {
  workspace: { id: string; name: string; plan: WorkspacePlan; planUntil: number | null; memberCap: number; proPriceUsd: number };
  account: { address: string; chain: "evm" | "starknet"; linked: { address: string; chain: "evm" | "starknet" }[] };
  payments: { txHash: string; amountUsd: number; paidAt: number; planUntil: number }[];
}

const chainName = (c: "evm" | "starknet") => (c === "evm" ? "Ethereum · GOAT" : "Starknet");

/**
 * Settings: the workspace's name, the plan and how to pay for it, the wallets behind the account
 * (one per rail; the other rail is bound by signing in with it once), and the way out.
 */
export function SettingsPanel({ workspace: ws, account, payments }: SettingsView) {
  const router = useRouter();
  const session = useFounderSession();
  const [name, setName] = useState(ws.name);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [binding, setBinding] = useState(false);
  const [bindMsg, setBindMsg] = useState<string | null>(null);
  const other = account.chain === "evm" ? "starknet" : "evm";
  const hasOther = account.linked.some((l) => l.chain === other);

  const rename = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  };

  const link = async () => {
    const res = await fetch("/api/record/link", { method: "POST" });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    setBindMsg(json.ok ? "Wallets linked — both rails now belong to this account." : json.error ?? "Could not link.");
    if (json.ok) {
      setBinding(false);
      router.refresh();
    }
  };

  return (
    <main className="ws-shell">
      <div className="ws-head">
        <div>
          <Link href="/workspace" className="ws-chip"><ArrowLeft size={11} /> {ws.name}</Link>
          <h1 className="ws-title" style={{ marginTop: 10 }}>Settings</h1>
        </div>
      </div>

      <div className="ws-grid">
        <div>
          <div className="ws-card">
            <div className="ws-card-h"><h2>Workspace</h2></div>
            <label className="sage-label">Name</label>
            <div className="ws-invite" style={{ marginTop: 6 }}>
              <input className="ws-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
              <button className="sage-btn sage-btn-sm" onClick={() => void rename()} disabled={saving || name.trim().length < 2 || name.trim() === ws.name}>{saving ? <Loader2 size={13} className="sage-spin2" /> : saved ? <Check size={13} /> : "Save"}</button>
            </div>
          </div>

          <div className="ws-card">
            <div className="ws-card-h"><h2><Wallet size={14} /> Wallets</h2></div>
            <ul className="ws-list">
              <li className="ws-row">
                <div className="ws-row-main">
                  <p className="ws-row-title mono">{short(account.address)}</p>
                  <p className="ws-row-meta">{chainName(account.chain)} · signed in · funds work and receives nothing</p>
                </div>
                <span className="ws-chip live">active</span>
              </li>
              {account.linked.map((l) => (
                <li key={l.address} className="ws-row">
                  <div className="ws-row-main">
                    <p className="ws-row-title mono">{short(l.address)}</p>
                    <p className="ws-row-meta">{chainName(l.chain)} · linked</p>
                  </div>
                  <span className="ws-chip">linked</span>
                </li>
              ))}
            </ul>
            {!hasOther && (
              <div style={{ marginTop: 12 }}>
                {!binding ? (
                  <button className="sage-btn sage-btn-sm" onClick={() => setBinding(true)}><Link2 size={13} /> Bind a {chainName(other)} wallet</button>
                ) : (
                  <>
                    <p className="ws-empty" style={{ marginBottom: 8 }}>Sign in with the {chainName(other)} wallet once; then link. Both stay signed in, and campaigns on either rail belong to you.</p>
                    <FounderSignIn explainer={<>Pick the <b>{chainName(other)}</b> wallet.</>} onSignedIn={() => void link()} />
                    <div className="st-actions"><button className="st-back" onClick={() => void link()}>Already signed in with both — link now</button><button className="st-back" onClick={() => setBinding(false)}>Cancel</button></div>
                  </>
                )}
                {bindMsg && <p className={bindMsg.startsWith("Wallets linked") ? "ws-ok" : "ws-err"}>{bindMsg}</p>}
              </div>
            )}
            <div style={{ marginTop: 14 }}>
              <button className="st-back" onClick={() => void session.signOut().then(() => router.push("/"))}><LogOut size={12} /> Sign out</button>
            </div>
          </div>
        </div>

        <div>
          <div className="ws-card">
            <div className="ws-card-h"><h2>Plan</h2><span className={`ws-plan${ws.plan === "pro" ? " pro" : ""}`}>{ws.plan === "pro" ? "Pro" : "Free"}</span></div>
            <div className="ws-tiers">
              <div className={`ws-tier${ws.plan === "free" ? " on" : ""}`}>
                <h3>Free</h3><p className="price">$0</p>
                <ul><li>You + 2 members</li><li>Gigs, grants, testing runs</li><li>Public receipts on GOAT</li></ul>
              </div>
              <div className={`ws-tier${ws.plan === "pro" ? " on" : ""}`}>
                <h3>Pro</h3><p className="price">${ws.proPriceUsd}<span style={{ fontSize: 12, fontWeight: 500, color: "var(--sec)" }}>/month</span></p>
                <ul><li>Unlimited members</li><li>Private payouts on Starknet</li><li>Working-capital advances for members</li></ul>
              </div>
            </div>
            {ws.plan === "pro" && ws.planUntil ? <p className="sage-hint" style={{ marginTop: 10 }}>Pro until {new Date(ws.planUntil * 1000).toISOString().slice(0, 10)}. Pay again any time to extend.</p> : null}
            <ProPay workspaceId={ws.id} priceUsd={ws.proPriceUsd} />
            {payments.length > 0 && (
              <ul className="ws-list" style={{ marginTop: 12 }}>
                {payments.map((p) => (
                  <li key={p.txHash} className="ws-row">
                    <div className="ws-row-main"><p className="ws-row-title">${p.amountUsd.toFixed(2)} USDC</p><p className="ws-row-meta">{new Date(p.paidAt * 1000).toISOString().slice(0, 10)} · until {new Date(p.planUntil * 1000).toISOString().slice(0, 10)}</p></div>
                    <a className="ws-chip" href={`https://explorer.goat.network/tx/${p.txHash}`} target="_blank" rel="noopener noreferrer">receipt</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
