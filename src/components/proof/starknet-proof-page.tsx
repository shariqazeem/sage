import Link from "next/link";
import { ArrowLeft, ArrowRight, CircleAlert, ShieldCheck } from "lucide-react";

import type { StarknetProof } from "@/lib/deputy/starknet-proof";
import { short, usd } from "@/lib/format";

/**
 * THE RECEIPT FOR A PAYOUT SETTLED ON STARKNET.
 *
 * Deliberately not the vault receipt with different words. An EVM payout is proved by a
 * CampaignVault event — the contract derived the amount, checked its own caps, and emitted the
 * settlement — so that page reads a contract's state back. A Starknet payout has no vault, and
 * saying it does would claim a guarantee nobody enforced.
 *
 * So this separates the two halves and labels them, because they are trustworthy for different
 * reasons: what the CHAIN says (the transaction, its status, the amount) is checkable by a stranger
 * with no reference to Sage at all; what SAGE says (why it paid) rests on Sage's record. Running
 * them together as one undifferentiated list of facts would borrow the chain's credibility for the
 * half that has not earned it.
 */
export function StarknetProofPage({ proof }: { proof: StarknetProof }) {
  const settled = proof.executionStatus === "SUCCEEDED";
  const reverted = proof.executionStatus === "REVERTED";

  return (
    <main className="skp">
      <div className="skp-wrap">
        <Link href="/explorer" className="skp-back">
          <ArrowLeft size={14} aria-hidden /> All payouts
        </Link>

        <header className="skp-head">
          <span
            className={`skp-chip ${settled ? "is-ok" : reverted ? "is-bad" : "is-unknown"}`}
            role="status"
          >
            {settled ? (
              <>
                <ShieldCheck size={14} aria-hidden /> Paid and confirmed on Starknet
              </>
            ) : reverted ? (
              <>
                <CircleAlert size={14} aria-hidden /> This transaction reverted
              </>
            ) : (
              <>
                <CircleAlert size={14} aria-hidden /> Couldn&rsquo;t reach Starknet to confirm
              </>
            )}
          </span>
          <h1 className="skp-amount">{proof.amountUsd !== null ? usd(proof.amountUsd) : "—"}</h1>
          <p className="skp-sub">
            {proof.campaignTitle ?? "A Sage payout"}
            {proof.recipient ? <> · to {short(proof.recipient)}</> : null}
          </p>
        </header>

        {/* WHAT THE CHAIN SAYS — verifiable by anyone, with no reference to Sage. */}
        <section className="skp-card" aria-label="What the chain says">
          <div className="skp-card-h">
            <span className="skp-card-t">What the chain says</span>
            <span className="skp-card-n">anyone can check this</span>
          </div>
          <dl className="skp-rows">
            <div className="skp-row">
              <dt>Transaction</dt>
              <dd className="skp-mono">{short(proof.txHash)}</dd>
            </div>
            <div className="skp-row">
              <dt>Status</dt>
              <dd>{proof.executionStatus ?? "unknown — the node could not be reached"}</dd>
            </div>
            {proof.blockNumber !== null && (
              <div className="skp-row">
                <dt>Block</dt>
                <dd className="skp-mono">{proof.blockNumber.toLocaleString("en-US")}</dd>
              </div>
            )}
            {proof.recipient && (
              <div className="skp-row">
                <dt>Recipient</dt>
                <dd className="skp-mono">{proof.recipient}</dd>
              </div>
            )}
          </dl>
          <a
            className="skp-link"
            href={proof.explorerUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open it on Voyager <ArrowRight size={14} aria-hidden />
          </a>
        </section>

        {/* WHAT SAGE SAYS — labelled, because it rests on Sage's record and not on the chain. */}
        <section className="skp-card" aria-label="What Sage says">
          <div className="skp-card-h">
            <span className="skp-card-t">Why Sage paid</span>
            <span className="skp-card-n">Sage&rsquo;s own record</span>
          </div>
          {proof.decision ? (
            <dl className="skp-rows">
              <div className="skp-row">
                <dt>Verdict</dt>
                <dd>
                  {proof.decision.recommendation} ·{" "}
                  {Math.round(proof.decision.confidence * 100)}% confidence
                </dd>
              </div>
              {proof.decision.reasonCode && (
                <div className="skp-row">
                  <dt>Reason</dt>
                  <dd>{proof.decision.reasonCode}</dd>
                </div>
              )}
              {proof.decision.summary && (
                <div className="skp-row">
                  <dt>Summary</dt>
                  <dd>{proof.decision.summary}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="skp-empty">
              No judgment record is attached to this payout. The transfer above still happened and
              is independently verifiable — this section simply has nothing to add to it.
            </p>
          )}
        </section>

        <p className="skp-foot">
          Settled on Starknet, where there is no per-campaign vault. The amount, recipient and
          status above come from the chain; the reasoning comes from Sage.
          {proof.campaignId ? (
            <>
              {" "}
              <Link href={`/c/${proof.campaignId}`}>See the campaign</Link>.
            </>
          ) : null}
        </p>
      </div>
    </main>
  );
}
