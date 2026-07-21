"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SageMark } from "@/components/brand/sage-mark";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useSiwe } from "@/lib/auth/use-siwe";
import { chainConfig } from "@/lib/deputy/networks";
import { CountUp } from "@/components/app/count-up";
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
  // Flip on after mount so the metrics count UP from zero (CountUp animates on value change);
  // reduced-motion makes CountUp jump, so this stays honest + calm.
  const [live, setLive] = useState(false);
  useEffect(() => setLive(true), []);

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
        <Link href="/" className="sb-brand sb-dash-cta">
          <SageMark size={20} /> Sage
        </Link>
        {signedIn ? (
          <Link href="/launch" className="sage-btn sage-btn-primary sage-btn-sm sb-dash-cta">
            <Plus size={15} /> Launch campaign
          </Link>
        ) : (
          <span className="sb-net">Founder dashboard</span>
        )}
      </header>

      {!signedIn ? (
        <div className="sage-agent-card sb-dash-gate">
          <div className="sage-eyebrow">Your campaigns</div>
          <h1 className="sb-dash-h1">Connect to see your campaigns</h1>
          <p className="sage-hint sb-dash-gate-p">
            Sign in with the wallet you launched from. You&apos;ll see every campaign you own, what
            Sage has paid, and can open each console.
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
          <div className="sage-eyebrow sb-dash-eyebrow">Founder dashboard</div>
          <h1 className="sb-dash-h1">Your campaigns</h1>
          {address && <div className="sage-hint mono sb-dash-addr">{short(address)}</div>}

          <div className="sb-dash-stats">
            <div className="sb-dash-stat">
              <CountUp className="sb-dash-stat-v" value={live ? campaigns.length : 0} />
              <span className="sb-dash-stat-k">Campaigns</span>
            </div>
            <div className="sb-dash-stat">
              <CountUp className="sb-dash-stat-v" value={live ? paidAmountBase : 0} format={usd} />
              <span className="sb-dash-stat-k">Released</span>
            </div>
            <div className="sb-dash-stat">
              <CountUp className="sb-dash-stat-v" value={live ? totalPaid : 0} />
              <span className="sb-dash-stat-k">Payouts</span>
            </div>
            <div className="sb-dash-stat">
              <CountUp className="sb-dash-stat-v" value={live ? approvedRecipients : 0} />
              <span className="sb-dash-stat-k">Testers paid</span>
            </div>
          </div>

          {campaigns.length === 0 ? (
            <div className="sage-agent-card sb-dash-empty">
              <p className="sage-hint sb-dash-empty-p">
                No campaigns yet — Sage will inspect your product and design paid testing missions.
              </p>
              <Link href="/launch" className="sage-btn sage-btn-primary sb-dash-cta">
                Launch your first campaign
              </Link>
            </div>
          ) : (
            <div className="sb-dash-cards sage-stagger">
              {campaigns.map((c) => (
                <Link
                  key={c.id}
                  href={`/campaign/${c.id}`}
                  className="sage-agent-card sb-agent-tap sb-dash-card"
                >
                  <div className="sb-dash-card-head">
                    <span className="sb-dash-card-title">{c.title}</span>
                    <span className="sb-net">{chainConfig(c.chainId).chipLabel}</span>
                  </div>
                  <div className="sage-metarow sb-dash-card-meta">
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

          <div className="sb-dash-foot">
            <button
              className="sage-foot-muted"
              onClick={() => void siwe.signOut().then(() => router.refresh())}
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </main>
  );
}
