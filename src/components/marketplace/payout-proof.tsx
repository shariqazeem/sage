import Link from "next/link";
import { Coins, PenLine, Pointer, ShieldCheck } from "lucide-react";
import type { MarketplacePayout, MarketplaceView } from "@/lib/campaigns/marketplace";
import { WaitStrip } from "./wait-strip";

/**
 * WHO ACTUALLY GOT PAID — the sidebar a stranger reads before deciding this is real.
 *
 * A board like this lives or dies on one question: does anyone actually get money out. Boards answer
 * it with a "total earned" figure, which is a number you type. Ours is better than that and it costs
 * nothing to be honest about it: every line here is a settled submission, and every amount links to
 * the transaction that moved it. Nothing on this panel exists without a hash.
 *
 * So when it is empty it says so plainly rather than rendering a zero as if it were a milestone.
 */

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

const shortWallet = (w: string) => (w.length > 12 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w);

function ago(unix: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * The three steps as three MARKS on a rail. They were three sentences in a box, which is the shape
 * every board uses and the shape a reader skips; the work of saying "there are three of them and
 * they are short" belongs to the layout, not to the words.
 */
const FLOW = [
  { Icon: Pointer, label: "Pick a mission" },
  { Icon: PenLine, label: "Say what you saw" },
  { Icon: Coins, label: "Agent pays in USDC" },
];

export function PayoutProof({
  payouts,
  paidToDate,
  availableUsd,
  openSlots,
  speed,
}: {
  payouts: MarketplacePayout[];
  paidToDate: { usd: number; count: number };
  availableUsd: number;
  openSlots: number;
  speed: MarketplaceView["speed"];
}) {
  // NEVER LEAD WITH A ZERO. "$0.00 paid to testers so far" is the precise opposite of the thing a
  // stranger came here to find out, and it is not even the most useful truth available: before the
  // first payout settles, what is true and encouraging is the money sitting funded in vaults right
  // now. Once one settles, the settled figure is stronger and takes the top slot.
  const proven = paidToDate.count > 0;
  return (
    <aside className="mk-side">
      <section className="mk-side-card">
        {proven ? (
          <>
            <div className="mk-side-stat">
              <span className="mk-side-stat-v mono">{usd(paidToDate.usd)}</span>
              <span className="mk-side-stat-k">
                paid to testers so far
                {/* The explorer's total is LARGER because it counts every mainnet settlement,
                    including Sage's own proving runs. This figure counts only money that reached
                    someone else, which is the number a person deciding whether to work here needs.
                    Two honest measures with the same label would read as one number contradicting
                    itself, so the difference is stated rather than left to be discovered. */}
                <em className="mk-side-note">excludes Sage&rsquo;s own test payouts</em>
              </span>
            </div>
            <div className="mk-side-stat">
              <span className="mk-side-stat-v mono">{usd(availableUsd)}</span>
              <span className="mk-side-stat-k">still available across {openSlots} open slots</span>
            </div>
          </>
        ) : (
          <>
            <div className="mk-side-stat">
              <span className="mk-side-stat-v mono">{usd(availableUsd)}</span>
              <span className="mk-side-stat-k">funded and waiting to be earned</span>
            </div>
            <div className="mk-side-stat">
              <span className="mk-side-stat-v mono">{openSlots}</span>
              <span className="mk-side-stat-k">
                {openSlots === 1 ? "slot open right now" : "slots open right now"}
              </span>
            </div>
          </>
        )}
      </section>

      {/* The measured wait, only when it IS measured — never a placeholder axis with no dots on it. */}
      {speed.medianSeconds !== null && (
        <WaitStrip medianSeconds={speed.medianSeconds} measured={speed.measured} dots={speed.dots} />
      )}

      <section className="mk-side-card">
        <h2 className="mk-side-h">How it works</h2>
        <div className="mk-flow">
          {FLOW.map(({ Icon, label }) => (
            <span key={label} className="mk-flow-step">
              <span className="mk-flow-i">
                <Icon size={15} strokeWidth={1.7} />
              </span>
              <span className="mk-flow-l">{label}</span>
            </span>
          ))}
        </div>
      </section>

      <section className="mk-side-card">
        <h2 className="mk-side-h">Recent payouts</h2>
        {payouts.length === 0 ? (
          <p className="sage-hint mk-side-empty">
            No payouts yet. When one settles it appears here with the transaction, not as a number we
            wrote down.
          </p>
        ) : (
          <ul className="mk-payouts">
            {payouts.map((p) => (
              <li key={p.txHash}>
                <Link href={`/proof/${p.txHash}`} className="mk-payout">
                  <span className="mk-payout-who mono">{shortWallet(p.wallet)}</span>
                  <span className="mk-payout-what">
                    {p.productHost ?? "a Sage campaign"} <span className="mk-dot">·</span> {ago(p.at)} ago
                  </span>
                  <span className="mk-payout-amt mono">{usd(p.usd)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mk-side-foot">
          <ShieldCheck size={12} /> Each one links to its on-chain receipt.
        </p>
      </section>
    </aside>
  );
}
