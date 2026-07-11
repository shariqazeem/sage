"use client";

import Link from "next/link";
import { ArrowUpRight, Check, X } from "lucide-react";
import type { DecisionBrief } from "@/lib/deputy/brain-core";
import { CHECK_NAMES, CHECK_REASONS } from "@/lib/deputy/reasons";
import { usd } from "@/lib/format";
import { DeputyAssessmentCard } from "@/components/campaigns/deputy-assessment";
import { useInView } from "./use-in-view";

/** The real settled receipt featured as the star, or null → the check rail. */
export interface LandingReceipt {
  brief: DecisionBrief;
  rewardUsd: number;
  txHash: string;
  threshold: number;
}

/**
 * First-touch human labels for the six checks (rail fallback only). The technical
 * CHECK_NAMES render in mono beneath.
 */
const CHECK_HUMAN: Record<number, string> = {
  1: "The wallet is active",
  2: "Only the Deputy can spend",
  3: "Recipient is approved",
  4: "Per-payout spending limit",
  5: "Allowance remaining",
  6: "Daily spending limit",
};

/**
 * ACT 3 — WATCH IT THINK. The Deputy's real reasoning is the star: a stored
 * DecisionBrief from a real settled payout, printed in on scroll (criteria +
 * verbatim quotes + confidence vs the autopay bar), then the settle line to its
 * real /proof/<tx>. Enforcement shrinks to two quiet lines — the reason to trust,
 * kept but no longer leading. Real data only; with no receipt yet it degrades to
 * the on-chain check rail (also real), and upgrades the moment a decision settles.
 */
export function Act3Vault({
  receipt,
  perTxCap,
}: {
  receipt: LandingReceipt | null;
  perTxCap: number | null;
}) {
  return receipt ? <Act3Think receipt={receipt} /> : <Act3Rail perTxCap={perTxCap} />;
}

/* ── the star: the Deputy's real receipt ────────────────────────────────── */
function Act3Think({ receipt }: { receipt: LandingReceipt }) {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.15 });
  const { brief, rewardUsd, txHash, threshold } = receipt;

  return (
    <section className="clx-act clx-act3" aria-label="Watch the Deputy reason">
      <div className="clx-act3-in clx-think-in">
        <div className="clx-act3-head">
          <div className="clx-eyebrow clx-mono">Watch it think</div>
          <h2 className="clx-h2">It reads the work, reasons, and decides.</h2>
          <p className="clx-act3-sub">
            Every submission gets a receipt — the Deputy fetches the evidence,
            quotes it, checks each criterion, and scores its confidence against
            the bar that lets it pay on its own. This is a real one.
          </p>
        </div>

        <div ref={ref} className="clx-think-card">
          <DeputyAssessmentCard
            brief={brief}
            rewardUsd={rewardUsd}
            threshold={threshold}
            materialize={inView}
          />
        </div>

        <div className="clx-think-foot">
          <Link href={`/proof/${txHash}`} className="clx-think-settle">
            <span className="clx-think-amt clx-mono">{usd(rewardUsd)} paid</span>
            <span className="clx-think-proof clx-mono">
              proof <ArrowUpRight size={12} strokeWidth={2.2} />
            </span>
          </Link>
          <p className="clx-think-guard clx-mono">
            Then six on-chain checks it cannot change. It cleared them —{" "}
            {usd(rewardUsd)} moved.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ── fallback: the on-chain check rail (real, honest, no-receipt state) ──── */
function Act3Rail({ perTxCap }: { perTxCap: number | null }) {
  const indices = [1, 2, 3, 4, 5, 6];
  return (
    <section className="clx-act clx-act3" aria-label="How the wallet works">
      <div className="clx-act3-in">
        <div className="clx-act3-head">
          <div className="clx-eyebrow clx-mono">How the wallet works</div>
          <h2 className="clx-h2">
            Six checks. Every payout. Before a dollar can move.
          </h2>
          <p className="clx-act3-sub">
            Every payout runs through an on-chain wallet with hard spending
            limits — we call it the Policy Vault. It checks the same six limits
            the contract enforces, in order. Pass all six and USDC settles; fail
            one — even if the agent is wrong — and the payout is blocked before it
            moves.
          </p>
        </div>

        <ol className="clx-rail">
          {indices.map((i) => (
            <CheckRow key={i} index={i} blocked={i === 4} perTxCap={perTxCap} />
          ))}
        </ol>
      </div>
    </section>
  );
}

function CheckRow({
  index,
  blocked,
  perTxCap,
}: {
  index: number;
  blocked: boolean;
  perTxCap: number | null;
}) {
  const { ref, inView } = useInView<HTMLLIElement>({ threshold: 0.5 });
  const state = inView ? (blocked ? "blocked" : "verified") : "idle";

  return (
    <li ref={ref} className={`clx-check state-${state}`}>
      <span className="clx-check-n clx-mono">
        {String(index).padStart(2, "0")}
      </span>
      <span className="clx-check-body">
        <span className="clx-check-name">{CHECK_HUMAN[index]}</span>
        <span className={`clx-check-detail${blocked ? "" : " clx-mono"}`}>
          {blocked ? CHECK_REASONS[index] : CHECK_NAMES[index]}
        </span>
      </span>
      {blocked && perTxCap != null && (
        <span className="clx-check-chip clx-mono">
          limit {usd(perTxCap)}
        </span>
      )}
      <span className="clx-check-mark" aria-hidden>
        {blocked ? (
          <X size={16} strokeWidth={3} />
        ) : (
          <Check size={16} strokeWidth={3} />
        )}
      </span>
      <span className="clx-check-status clx-mono">
        {blocked ? "Blocked" : "Verified"}
      </span>
    </li>
  );
}
