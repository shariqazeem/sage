"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSiwe } from "@/lib/auth/use-siwe";
import { chainConfig } from "@/lib/deputy/networks";
import type { CampaignCard } from "@/lib/campaigns/overview";

function short(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
function usd(base: number): string {
  return `$${(base / 1e6).toFixed(2)}`;
}

export function DashboardClient({
  signedIn,
  address,
  campaigns,
  paidAmountBase,
  approvedRecipients,
  totalPaid,
}: {
  signedIn: boolean;
  address: string | null;
  campaigns: CampaignCard[];
  paidAmountBase: number;
  approvedRecipients: number;
  totalPaid: number;
}) {
  const siwe = useSiwe();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    try {
      const ok = await siwe.signIn();
      if (ok) router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="sb-shell">
      <header className="sb-top">
        <Link href="/" className="sb-brand" style={{ textDecoration: "none" }}>
          <span className="sb-mark">S</span> Sage
        </Link>
        <span className="sb-net">Founder dashboard</span>
      </header>

      {!signedIn ? (
        <div className="sage-agent-card" style={{ textAlign: "center", padding: "40px 28px" }}>
          <div className="sage-eyebrow">Your campaigns</div>
          <h1 style={{ fontSize: 26, margin: "10px 0 8px" }}>Connect to see your campaigns</h1>
          <p className="sage-hint" style={{ maxWidth: 440, margin: "0 auto 20px" }}>
            Sign in with the wallet you launched from. You&apos;ll see every campaign you own, what
            the Deputy has paid, and can open each console.
          </p>
          <button
            className="sage-btn sage-btn-primary"
            disabled={busy || siwe.signingIn}
            onClick={connect}
          >
            {busy || siwe.signingIn ? "Connecting…" : "Connect wallet"}
          </button>
        </div>
      ) : (
        <>
          <div className="sage-eyebrow" style={{ marginTop: 6 }}>
            Founder dashboard
          </div>
          <h1 style={{ fontSize: 28, margin: "6px 0 2px" }}>Your campaigns</h1>
          {address && (
            <div className="sage-hint mono" style={{ marginBottom: 18 }}>
              {short(address)}
            </div>
          )}

          <div className="sage-metarow" style={{ marginBottom: 22 }}>
            <span className="sage-metachip">
              <b>{campaigns.length}</b> campaigns
            </span>
            <span className="sage-metachip">
              <b>{usd(paidAmountBase)}</b> released
            </span>
            <span className="sage-metachip">
              <b>{totalPaid}</b> payouts
            </span>
            <span className="sage-metachip">
              <b>{approvedRecipients}</b> testers paid
            </span>
          </div>

          {campaigns.length === 0 ? (
            <div className="sage-agent-card" style={{ textAlign: "center", padding: 36 }}>
              <p className="sage-hint" style={{ marginBottom: 16 }}>
                No campaigns yet — Sage will inspect your product and design paid testing missions.
              </p>
              <Link href="/launch" className="sage-btn sage-btn-primary" style={{ textDecoration: "none" }}>
                Launch your first campaign
              </Link>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {campaigns.map((c) => (
                <Link
                  key={c.id}
                  href={`/campaign/${c.id}`}
                  className="sage-agent-card"
                  style={{ textDecoration: "none", display: "block", color: "inherit" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                    <span style={{ fontWeight: 600, fontSize: 16 }}>{c.title}</span>
                    <span className="sb-net">{chainConfig(c.chainId).chipLabel}</span>
                  </div>
                  <div className="sage-metarow" style={{ marginTop: 12 }}>
                    <span className="sage-metachip">{c.status}</span>
                    <span className="sage-metachip">{usd(c.rewardBase)} / mission</span>
                    <span className="sage-metachip">
                      <b>{c.paid}</b> paid
                    </span>
                    <span className="sage-metachip">
                      <b>{c.pending}</b> pending
                    </span>
                    <span className="sage-metachip">
                      <b>{c.submissions}</b> submissions
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}

          <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/launch" className="sage-btn sage-btn-primary" style={{ textDecoration: "none" }}>
              Launch new campaign
            </Link>
            <button className="sage-btn sage-btn-ghost" onClick={() => void siwe.signOut().then(() => router.refresh())}>
              Sign out
            </button>
          </div>
        </>
      )}
    </main>
  );
}
