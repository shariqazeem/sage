import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShieldCheck, Zap, UserCheck } from "lucide-react";

import { marketplace } from "@/lib/campaigns/marketplace";
import "@/styles/tester-board.css";
import "@/styles/marketplace.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Open missions — get paid to test products | Sage",
  description:
    "Every mission currently open on Sage. Do the work, submit what you saw, get paid in USDC from an on-chain vault with hard spending limits.",
};

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/**
 * /missions — the public marketplace.
 *
 * Sage could only ever be found one campaign at a time, by a link a founder sent you. This is the
 * other side of the market: every mission anyone can be paid for right now, in one place. It is a
 * founder's recruiting channel and a tester's job board at once.
 *
 * The listing shows ONLY work that can actually pay — live campaign, open mission, unfilled slot.
 * An empty marketplace says so plainly rather than dressing up nothing as something.
 */
export default function MissionsPage() {
  const { campaigns, totals } = marketplace();

  return (
    <main className="sb-shell mk-shell">
      <header className="mk-hero sage-stagger">
        <div className="sage-eyebrow">Open missions</div>
        <h1 className="dash-display mk-title">Get paid to test real products.</h1>
        <p className="mk-lede">
          Founders fund a vault up front. You do a short, specific task and describe what you
          actually saw. Sage checks the evidence and pays in USDC — no application, no interview.
        </p>

        {totals.campaigns > 0 && (
          <div className="mk-totals mono">
            <span>
              <strong>{totals.slots}</strong> open {totals.slots === 1 ? "slot" : "slots"}
            </span>
            <span aria-hidden>·</span>
            <span>
              <strong>{totals.missions}</strong> {totals.missions === 1 ? "mission" : "missions"}
            </span>
            <span aria-hidden>·</span>
            <span>
              <strong>{usd(totals.usd)}</strong> available now
            </span>
          </div>
        )}
      </header>

      {campaigns.length === 0 ? (
        <section className="mk-empty">
          <h2 className="dash-h3">No missions are open right now.</h2>
          <p className="sage-hint">
            Every mission here is backed by a funded vault, so the list is empty whenever no
            campaign has an unfilled slot. It fills up again as founders launch.
          </p>
          <Link href="/launch" className="sage-btn sage-btn-primary">
            Launch your own campaign <ArrowRight size={15} />
          </Link>
        </section>
      ) : (
        <section className="mk-grid">
          {campaigns.map((c) => (
            <Link key={c.id} href={c.boardPath} className="sage-agent-card sb-agent-tap mk-card">
              <div className="mk-card-head">
                <h2 className="dash-h3 mk-card-title">{c.title}</h2>
                <div className="mk-reward mono">{usd(c.topRewardUsd)}</div>
              </div>

              <div className="sage-metarow">
                <span className="sage-metachip">
                  <span className="k">Open</span>
                  <span className="v mono">
                    {c.openSlots} {c.openSlots === 1 ? "slot" : "slots"}
                  </span>
                </span>
                <span className="sage-metachip">
                  <span className="k">Missions</span>
                  <span className="v mono">{c.openMissions}</span>
                </span>
                <span className="sage-metachip">
                  <span className="k">Pays in</span>
                  <span className="v mono">{c.tokenSymbol}</span>
                </span>
                {c.isTestnet && (
                  <span className="mk-chip mk-chip-test">Testnet — practice, not real money</span>
                )}
              </div>

              <ul className="mk-missions">
                {c.missions.slice(0, 3).map((m) => (
                  <li key={m.missionKey}>
                    <span className="mk-m-title">{m.title}</span>
                    <span className="mk-m-meta mono">
                      {usd(m.rewardUsd)} · {m.remainingSlots} left
                    </span>
                  </li>
                ))}
                {c.missions.length > 3 && (
                  <li className="sage-hint">+{c.missions.length - 3} more inside</li>
                )}
              </ul>

              <div className="mk-card-foot">
                <span className="mk-badge">
                  {c.autopays ? (
                    <>
                      <Zap size={13} /> Pays automatically once verified
                    </>
                  ) : (
                    <>
                      <UserCheck size={13} /> Founder approves each payout
                    </>
                  )}
                </span>
                <span className="mk-go">
                  Open <ArrowRight size={14} />
                </span>
              </div>
            </Link>
          ))}
        </section>
      )}

      <footer className="mk-foot">
        <p className="sage-hint">
          <ShieldCheck size={13} /> Every payout comes from an on-chain vault the agent cannot
          exceed, and publishes a receipt you can verify yourself.
        </p>
      </footer>
    </main>
  );
}
