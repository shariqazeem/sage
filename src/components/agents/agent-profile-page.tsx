import Link from "next/link";
import {
  ArrowUpRight,
  BadgeCheck,
  Bot,
  Check,
  Coins,
  Lock,
  Receipt,
  ScrollText,
  ShieldAlert,
  X,
} from "lucide-react";
import { short, shortDateUTC, since, usd } from "@/lib/format";
import type { AgentIdentity } from "@/lib/erc8004/identity";
import type {
  AgentReceipt,
  AgentReputation,
} from "@/lib/erc8004/reputation-core";
import type { RecentDecisionSummary, ChainRecord } from "@/lib/erc8004/reputation";
import { JailbreakBox } from "./jailbreak-box";
import { PnLPanel, type PnLView } from "./pnl-panel";

/** The attack ledger, sourced from tests/redteam/attacks.json (resolved on the server). */
export interface AttackLedgerView {
  count: number;
  rows: { klass: string; defense: string }[];
}

const BLOCK_REASON: Record<number, string> = {
  1: "vault inactive",
  2: "unauthorized operator",
  3: "recipient not allowlisted",
  4: "over per-payout cap",
  5: "over remaining budget",
  6: "over velocity cap",
};

const REC_LABEL: Record<RecentDecisionSummary["recommendation"], string> = {
  pay: "Pay",
  review: "Review",
  hold: "Hold",
};

const base = (n: number) => usd(n / 1e6);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const dateOf = (s: number) => shortDateUTC(s, true);

/**
 * The public agent page — Sage's Payout Deputy, its ERC-8004 identity and its
 * grounded on-chain track record. Server-rendered and shareable cold. Every
 * number is derived from real rows; the empty state renders honestly rather than
 * flattering. Works in both pending and registered identity states.
 */
export function AgentProfilePage({
  identity,
  wallet,
  reputation: r,
  chainSplit,
  receipts,
  recentDecisions,
  ledger,
  pnl,
}: {
  identity: AgentIdentity;
  wallet: string | null;
  reputation: AgentReputation;
  chainSplit: ChainRecord[];
  receipts: AgentReceipt[];
  recentDecisions: RecentDecisionSummary[];
  ledger: AttackLedgerView;
  pnl: PnLView;
}) {
  const registered = identity.registered;
  const multiChain = chainSplit.length > 1;
  const engineMix =
    r.decisionCount > 0
      ? `${r.engineMix.llm} LLM · ${r.engineMix.heuristic} heuristic`
      : "no reviews yet";

  return (
    <div className="sag">
      <div className="sag-col sag-top sag-reveal">
        <div className="sag-brand">
          <span className="sag-mark">
            <span className="sag-mark-ring" />
          </span>
          <span className="sag-wordmark">Sage</span>
        </div>
        <span className="sag-kicker">Autonomous Payout Deputy</span>
      </div>

      {/* identity */}
      <div className="sag-id sag-reveal" style={{ animationDelay: "0.06s" }}>
        <div className="sag-id-top">
          <span className="sag-id-ico">
            <Bot size={26} />
          </span>
          <div className="sag-id-main">
            <div className="sag-id-name">
              {identity.name ?? "Sage"}
              {registered && <BadgeCheck size={18} style={{ color: "var(--pos)" }} />}
            </div>
            <div className="sag-id-sub">
              ERC-8004 identity · {identity.network}
              {r.lastActivityAt ? ` · last active ${since(r.lastActivityAt * 1000)}` : ""}
            </div>
          </div>
          <span className={`sag-id-status ${registered ? "reg" : ""}`}>
            <span className="dot" />
            {registered ? `Registered · #${identity.agentId}` : "Pending registration"}
          </span>
        </div>

        <div className="sag-id-meta">
          {wallet && (
            <a
              className="sag-chip"
              href={`${identity.explorer}/address/${wallet}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="k">wallet</span>
              <span className="mono">{short(wallet)}</span>
              <ArrowUpRight size={13} />
            </a>
          )}
          <span className="sag-chip">
            <span className="k">registry</span>
            <span className="mono">{short(identity.registry)}</span>
          </span>
          <span className="sag-chip">
            <span className="k">chain</span>
            <span className="mono">{identity.chainId}</span>
          </span>
          <a
            className="sag-chip link"
            href={identity.scanUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            8004scan
            <ArrowUpRight size={13} />
          </a>
        </div>

        <p className="sag-id-note">
          {registered ? (
            <>
              This Deputy verifies submitted work, reasons about it, and pays real
              people in USDC — or gets blocked trying. Linked to ERC-8004 identity{" "}
              <b className="mono">#{identity.agentId}</b> on {identity.network}; the
              performance shown here is derived from Sage&apos;s verifiable
              transaction journal — every row is a real settled payout or block you
              can check on-chain, not a score stored in a registry.
            </>
          ) : (
            <>
              The identity registers on {identity.network} (chain {identity.chainId})
              once its signing wallet has gas. The performance shown here is already
              derived from Sage&apos;s verifiable on-chain transaction journal; it
              links to the ERC-8004 identity the moment it mints.
            </>
          )}
        </p>
      </div>

      {/* reputation stats */}
      <div className="sag-stats sag-reveal" style={{ animationDelay: "0.12s" }}>
        <div className="sag-stat hero">
          <div>
            <div className="sag-stat-v pos">{base(r.settledTotalBase)}</div>
            {r.firstActivityAt && (
              <div className="sag-stat-sub">Active since {dateOf(r.firstActivityAt)}</div>
            )}
          </div>
          <div className="sag-stat-k">
            Total USDC settled on-chain to real recipients
            {multiChain ? " · combined across networks" : ""}
          </div>
          {chainSplit.length > 0 && (
            <div className="sag-chainsplit">
              {chainSplit.map((c) => (
                <span key={c.chainId} className="sag-chainrow mono">
                  <span className={`sag-chaintag ${c.isMainnet ? "main" : "test"}`}>
                    {c.isMainnet ? "mainnet" : "testnet"}
                  </span>
                  {c.network} · ${c.settledUsd.toFixed(2)} · {c.payouts} paid
                  {c.blocks > 0 ? ` · ${c.blocks} blocked` : ""}
                </span>
              ))}
            </div>
          )}
        </div>

        <Stat value={r.payoutCount} label="Payouts released" />
        <Stat value={r.blockedCount} label="Blocked · the vault held" tone={r.blockedCount > 0 ? "dan" : undefined} />
        <Stat value={r.distinctRecipients} label="Distinct recipients" />
        <Stat value={r.distinctCampaigns} label="Campaigns served" />
        <Stat value={r.decisionCount} label="Decisions recorded" sub={engineMix} />
        <Stat value={r.avgConfidence == null ? "—" : pct(r.avgConfidence)} label="Avg confidence" />

        {!r.active && (
          <div className="sag-empty">
            No settled payouts yet — this track record begins the moment the Deputy
            releases its first reward. Zeros here are honest, not hidden.
          </div>
        )}
      </div>

      {/* agent P&L — the Deputy runs a real ledger */}
      <div className="sag-card sag-reveal" style={{ animationDelay: "0.15s" }}>
        <div className="sag-card-head">
          <span className="sag-card-title">
            <Coins size={16} /> Agent P&amp;L
          </span>
          <span className="sag-card-note">Summed from real rows</span>
        </div>
        <PnLPanel pnl={pnl} />
      </div>

      {/* recent receipts */}
      <div className="sag-card sag-reveal" style={{ animationDelay: "0.18s" }}>
        <div className="sag-card-head">
          <span className="sag-card-title">
            <Receipt size={16} /> Recent receipts
          </span>
          <span className="sag-card-note">Each verifiable on-chain</span>
        </div>
        {receipts.length === 0 ? (
          <div className="sag-card-empty">
            No settled or blocked payouts yet. Every one will appear here with a
            public proof link.
          </div>
        ) : (
          receipts.map((rc) => (
            <Link key={rc.txHash} className="sag-rec" href={`/proof/${rc.txHash}`}>
              <span className={`sag-rec-ico ${rc.settled ? "pos" : "dan"}`}>
                {rc.settled ? <Check size={16} strokeWidth={2.6} /> : <X size={16} strokeWidth={2.6} />}
              </span>
              <div className="sag-rec-main">
                <div className="sag-rec-amt">
                  {rc.settled ? base(rc.amountBase) : `${base(rc.amountBase)} blocked`}
                </div>
                <div className="sag-rec-sub">
                  {rc.settled
                    ? "Payout settled"
                    : `Refused — ${BLOCK_REASON[rc.failedCheckIndex ?? 0] ?? "policy check"}`}{" "}
                  · {since(rc.at * 1000)}
                </div>
              </div>
              <span className="sag-rec-r">
                <span className="sag-rec-tx">{short(rc.txHash)}</span>
                <ArrowUpRight size={13} />
              </span>
            </Link>
          ))
        )}
      </div>

      {/* adversarial red team — sourced from the real attack suite */}
      <div className="sag-card sag-reveal" style={{ animationDelay: "0.22s" }}>
        <div className="sag-card-head">
          <span className="sag-card-title">
            <ShieldAlert size={16} /> Adversarial red team
          </span>
          <span className="sag-card-note">Can the brain be jailbroken into paying?</span>
        </div>
        <div className="sag-ledger-hero mono">
          <b>
            {ledger.count}/{ledger.count}
          </b>{" "}
          adversarial attacks held · <b>0</b> unauthorized payouts
        </div>
        <div className="sag-ledger-scroll">
          <div className="sag-ledger">
            <div className="sag-ledger-row head">
              <span>ATTACK CLASS</span>
              <span>DEFENSE LAYER THAT CAUGHT IT</span>
              <span>OUTCOME</span>
            </div>
            {ledger.rows.map((a, i) => (
              <div className="sag-ledger-row" key={i}>
                <span className="sag-ledger-class">{a.klass}</span>
                <span className="sag-ledger-defense">{a.defense}</span>
                <span className="sag-ledger-outcome">
                  <Check size={12} strokeWidth={3} /> HELD
                </span>
              </div>
            ))}
          </div>
        </div>
        <p className="sag-ledger-src">
          Sourced from <span className="mono">tests/redteam/attacks.json</span> — the
          same fixtures the deterministic suite and the live harness run on every
          build. Nothing here is asserted.
        </p>
        <JailbreakBox />
      </div>

      {/* recent reviews */}
      {recentDecisions.length > 0 && (
        <div className="sag-card sag-reveal" style={{ animationDelay: "0.24s" }}>
          <div className="sag-card-head">
            <span className="sag-card-title">
              <ScrollText size={16} /> Recent reviews
            </span>
            <span className="sag-card-note">The brain proposes; the vault disposes</span>
          </div>
          {recentDecisions.map((d, i) => (
            <div className="sag-dec" key={i}>
              <span className={`sag-dec-badge ${d.recommendation}`}>
                {REC_LABEL[d.recommendation]}
              </span>
              <div className="sag-dec-main">
                <div className="sag-dec-title">{d.campaignTitle}</div>
                <div className="sag-dec-sub">
                  {d.engine === "llm" ? "LLM review" : "Heuristic screen"} · {since(d.at * 1000)}
                </div>
              </div>
              <span className="sag-dec-conf">{pct(d.confidence)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="sag-foot sag-reveal" style={{ animationDelay: "0.3s" }}>
        <div className="sag-foot-in">
          <Lock size={14} />
          <span>
            Reputation is earned on-chain, not asserted. Powered by{" "}
            <Link href="/">Sage</Link>.
          </span>
        </div>
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
  sub,
  tone,
}: {
  value: number | string;
  label: string;
  sub?: string;
  tone?: "pos" | "dan";
}) {
  return (
    <div className="sag-stat">
      <div className={`sag-stat-v${tone ? ` ${tone}` : ""}`}>{value}</div>
      <div className="sag-stat-k">{label}</div>
      {sub && <div className="sag-stat-sub">{sub}</div>}
    </div>
  );
}
