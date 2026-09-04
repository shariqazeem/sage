"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, CreditCard, Link2, Loader2, LogOut, Wallet } from "lucide-react";
import { short } from "@/lib/format";
import { useFounderSession } from "@/lib/auth/use-founder-session";
import { FounderSignIn } from "@/components/wallet/founder-sign-in";
import { TreasuryCard } from "./treasury-card";
import { MandateCard } from "./mandate-card";

export interface SettingsView {
  workspace: { id: string; name: string };
  account: { address: string; chain: "evm" | "starknet"; linked: { address: string; chain: "evm" | "starknet" }[] };
}

const chainName = (c: "evm" | "starknet") => (c === "evm" ? "Ethereum · GOAT" : "Starknet");

/**
 * Settings: the workspace's name, the plan and how it is paid for, the wallets behind the account
 * (one per rail — the other is bound by signing in with it once), and the way out.
 */
export function SettingsPanel({ workspace: ws, account }: SettingsView) {
  const router = useRouter();
  const session = useFounderSession();
  const [name, setName] = useState(ws.name);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [binding, setBinding] = useState(false);
  const [bindMsg, setBindMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);
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
    <main className="ws-shell ws-stagger">
      <header className="ws-head">
        <div>
          <Link href="/workspace" className="ws-back"><ArrowLeft size={12} /> {ws.name}</Link>
          <span className="ws-eyebrow" style={{ marginTop: 10 }}>Account</span>
          <h1 className="ws-title">Settings</h1>
          <p className="ws-sub">The workspace, the wallets behind your account, and the treasury the agent launches from.</p>
        </div>
      </header>

      <div className="ws-grid">
        <div>
          <section className="ws-card">
            <div className="ws-card-h"><h2>Workspace</h2></div>
            <label className="sage-label">Name</label>
            <div className="ws-invite" style={{ marginTop: 6 }}>
              <input className="ws-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
              <button className="sage-btn sage-btn-sm" onClick={() => void rename()} disabled={saving || name.trim().length < 2 || name.trim() === ws.name}>{saving ? <Loader2 size={13} className="sage-spin2" /> : saved ? <><Check size={13} /> Saved</> : "Save"}</button>
            </div>
          </section>

          <section className="ws-card">
            <div className="ws-card-h"><h2><Wallet size={15} /> Wallets</h2></div>
            <ul className="ws-list">
              <li className="ws-row">
                <div className="ws-row-main">
                  <p className="ws-row-title"><span className="mono t">{short(account.address)}</span></p>
                  <p className="ws-row-meta">{chainName(account.chain)} · signed in · funds work, receives nothing</p>
                </div>
                <span className="ws-chip live">active</span>
              </li>
              {account.linked.map((l) => (
                <li key={l.address} className="ws-row">
                  <div className="ws-row-main">
                    <p className="ws-row-title"><span className="mono t">{short(l.address)}</span></p>
                    <p className="ws-row-meta">{chainName(l.chain)} · linked · pays and receives as you</p>
                  </div>
                  <span className="ws-chip">linked</span>
                </li>
              ))}
            </ul>
            {!hasOther && (
              <div style={{ marginTop: 14 }}>
                {!binding ? (
                  <button className="sage-btn sage-btn-sm" onClick={() => setBinding(true)}><Link2 size={13} /> Bind a {chainName(other)} wallet</button>
                ) : (
                  <>
                    <p className="ws-note" style={{ margin: "0 0 10px" }}>Sign in with the {chainName(other)} wallet once, then link. Both stay signed in, and work on either rail belongs to you.</p>
                    <FounderSignIn explainer={<>Pick the <b>{chainName(other)}</b> wallet.</>} onSignedIn={() => void link()} />
                    <div className="st-actions"><button className="st-back" onClick={() => void link()}>Already signed in with both — link now</button><button className="st-back" onClick={() => setBinding(false)}>Cancel</button></div>
                  </>
                )}
                {bindMsg && <p className={bindMsg.startsWith("Wallets linked") ? "ws-ok" : "ws-err"}>{bindMsg}</p>}
              </div>
            )}
            {/*
              ADD A WALLET TO THIS ACCOUNT. An email account holds an embedded wallet; the founder
              also owns a browser wallet. Signing in with it used to REPLACE the account. This
              signs with it and joins it — the session stays, the workspace stays, the record grows.
            */}
            {account.chain === "evm" && (
              <div style={{ marginTop: 14 }}>
                {!adding ? (
                  <button className="sage-btn sage-btn-sm" onClick={() => setAdding(true)}><Wallet size={13} /> Add an Ethereum wallet to this account</button>
                ) : (
                  <>
                    <p className="ws-note" style={{ margin: "0 0 10px" }}>Sign once with the wallet you want to add. You stay signed in as this account; the wallet becomes yours here too.</p>
                    <FounderSignIn intent="bind" explainer={<>Pick the wallet to <b>add</b>.</>} onSignedIn={() => { setAdding(false); setAddMsg("Wallet added — it pays and receives as you now."); router.refresh(); }} />
                    <div className="st-actions"><button className="st-back" onClick={() => setAdding(false)}>Cancel</button></div>
                  </>
                )}
                {addMsg && <p className="ws-ok">{addMsg}</p>}
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              <button className="st-back" onClick={() => void session.signOut().then(() => router.push("/"))}><LogOut size={12} /> Sign out</button>
            </div>
          </section>

          <TreasuryCard />

          <MandateCard />
        </div>

        <div>
          <section className="ws-card">
            <div className="ws-card-h"><h2><CreditCard size={15} /> How Sage earns</h2></div>
            <p className="ws-note" style={{ margin: 0 }}>
              No plans, no seats. Sage earns a small fee on each settlement it makes — recorded beside the payout on the receipt — and a financing margin when a member draws an advance against verified inflow. Everything else, including private payouts on Starknet, is included.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
