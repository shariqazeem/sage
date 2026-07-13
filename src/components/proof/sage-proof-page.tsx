import Link from "next/link";
import {
  Check,
  X,
  Lock,
  ShieldCheck,
  Bot,
  ArrowUpRight,
  BadgeCheck,
  AlertTriangle,
  FileText,
  Cpu,
} from "lucide-react";
import { money, short } from "@/lib/format";
import { NetworkChip } from "@/components/app/network-chip";
import { x402StatusLabel } from "@/lib/x402/x402-status";
import type { FoundProof } from "@/lib/deputy/proof";

/**
 * The public per-payout proof — a premium, four-section financial receipt built
 * from ONE canonical composer (@/lib/deputy/proof). It tells the whole truth:
 *   1. Human result — what happened, in five seconds.
 *   2. Sage decision receipt — how the AI judged it (when decision-committed).
 *   3. Machine / on-chain proof — the chain event + the commitment verification.
 *   4. Safety context — the mandate the payout stayed inside.
 * Legacy payments and integrity mismatches are shown honestly; a mismatch is
 * NEVER labelled verified. Server-rendered; the reveal is pure CSS.
 */
export function SageProofPage({ proof }: { proof: FoundProof }) {
  const settled = proof.settled;
  const isMismatch = proof.state === "commitment_mismatch";
  const isIncomplete = proof.state === "incomplete_local_record";
  const committed =
    proof.state === "committed_settlement" || proof.state === "committed_rejection";

  const tone = isMismatch ? "dan" : settled ? "pos" : "dan";
  const statusLabel = isMismatch ? "Integrity warning" : settled ? "Settled" : "Blocked";
  const dateStr = proof.chain.timestamp
    ? new Date(proof.chain.timestamp * 1000).toUTCString()
    : "";

  return (
    <div className="spp">
      <div className="spp-col spp-top spp-reveal">
        <div className="spp-brand">
          <span className="spp-mark">
            <span className="spp-mark-ring" />
          </span>
          <span className="spp-wordmark">Sage</span>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <span className="spp-kicker">Public payout proof</span>
          <NetworkChip chainId={proof.chain.chainId} size="xs" />
        </span>
      </div>

      {/* honesty banner for anything that is not a clean, committed payment */}
      {isMismatch && (
        <div className="spp-col spp-banner dan spp-reveal">
          <AlertTriangle size={16} />
          <span>
            <b>Integrity warning.</b> The stored decision does not reproduce this
            payout&apos;s on-chain commitment. The payment is real, but it is{" "}
            <b>not</b> a verified decision-commitment.
          </span>
        </div>
      )}
      {isIncomplete && (
        <div className="spp-col spp-banner warn spp-reveal">
          <AlertTriangle size={16} />
          <span>
            <b>Local record incomplete.</b> The on-chain payment is real, but Sage
            cannot fully reproduce its decision commitment from local data.
          </span>
        </div>
      )}
      {proof.legacy && (
        <div className="spp-col spp-banner warn spp-reveal">
          <FileText size={16} />
          <span>
            <b>Legacy payout</b> — this transaction predates decision commitment
            v1. It is a valid payment proof, not a decision-commitment proof.
          </span>
        </div>
      )}

      {/* SECTION 1 · the human result */}
      <div className="spp-col spp-fact-wrap">
        <div className={`spp-medallion ${tone}`}>
          {isMismatch ? (
            <AlertTriangle size={38} strokeWidth={2.2} />
          ) : settled ? (
            <Check size={40} strokeWidth={2.4} />
          ) : (
            <X size={40} strokeWidth={2.4} />
          )}
        </div>
        <div className="spp-reveal" style={{ animationDelay: "0.16s" }}>
          <span className={`spp-status ${tone}`}>
            <span className="dot" />
            {statusLabel}
          </span>
          <div className="spp-amount mono">{money(proof.human.amountUsd, proof.chain.chainId)}</div>
          <div className="spp-fact">{proof.human.outcome}</div>
          {proof.human.campaignTitle && (
            <div className="spp-reward">for {proof.human.campaignTitle.toLowerCase()}</div>
          )}
          {!settled && !isMismatch && proof.human.failedCheckReason && (
            <div className="spp-blocked-note">
              <Lock size={15} /> Refused on-chain — {proof.human.failedCheckReason}. No
              funds moved.
            </div>
          )}
        </div>
      </div>

      {/* V2 mission — what the founder pre-approved vs what Sage evaluated */}
      {proof.v2 && (
        <div className="spp-card spp-reveal" style={{ animationDelay: "0.2s" }}>
          <div className="spp-card-head">
            <span className="spp-card-title">
              <FileText size={16} /> Mission
            </span>
            {proof.v2.mission?.paidCompletions != null && proof.v2.mission.maxCompletions != null && (
              <span className="spp-rec review">
                {proof.v2.mission.paidCompletions} of {proof.v2.mission.maxCompletions}
              </span>
            )}
          </div>
          {proof.v2.mission && (
            <div className="spp-rows">
              <Row k="Mission">{proof.v2.mission.title ?? "—"}</Row>
              {proof.v2.mission.objective && <Row k="Objective">{proof.v2.mission.objective}</Row>}
              <Row k="Exact reward">{money(proof.human.amountUsd, proof.chain.chainId)}</Row>
            </div>
          )}
          {/* the two digests, labelled for exactly what each is — an app-level record vs an
              on-chain economic commitment. Never implies the contract judged the work. */}
          <div className="spp-commit warn" style={{ marginTop: 4 }}>
            <HashLine
              label="MissionSpec digest · application-level record"
              value={proof.v2.missionSpecDigest.recomputed ?? proof.v2.missionSpecDigest.stored ?? "—"}
            />
            <HashLine
              label="Mission plan digest · on-chain economic commitment"
              value={proof.v2.missionPlanDigest.onchain ?? proof.v2.missionPlanDigest.stored ?? "—"}
            />
          </div>
          <p className="spp-note">
            This tester did not need to be pre-approved. The founder pre-approved the
            mission identifier, exact reward, completion count, total budget, and Sage&rsquo;s
            operator authority. The on-chain vault enforces those mission economics and
            replay protection; it does not judge the quality of the work. The mission
            specification shown here is the immutable application record Sage evaluated —
            the vault does not store its wording.
          </p>
        </div>
      )}

      {/* SECTION 2 · the Sage decision receipt */}
      <div className="spp-card big spp-reveal" style={{ animationDelay: "0.24s" }}>
        <div className="spp-card-head">
          <span className="spp-card-title">
            <Bot size={16} /> Sage decision receipt
          </span>
          {proof.decision && (
            <span className={`spp-rec ${proof.decision.recommendation}`}>
              {proof.decision.recommendation.toUpperCase()}
            </span>
          )}
        </div>

        {proof.decision ? (
          <DecisionReceipt decision={proof.decision} threshold={proof.threshold} />
        ) : (
          <div className="spp-unavail">
            <span className="spp-unavail-ico">
              <FileText size={17} />
            </span>
            <div>
              <div className="spp-unavail-t">No decision receipt</div>
              <div className="spp-unavail-s">{proof.decisionUnavailableReason}</div>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 3 · the machine / on-chain proof */}
      <div className="spp-card spp-reveal" style={{ animationDelay: "0.3s" }}>
        <div className="spp-card-head">
          <span className="spp-card-title">
            <Cpu size={16} /> On-chain proof
          </span>
          <span className="spp-card-note">You don&apos;t have to trust us.</span>
        </div>
        <div className="spp-rows">
          <Row k="Network">
            {proof.chain.network} · {proof.chain.chainId}
          </Row>
          <Row k="Transaction">
            <a className="lnk" href={proof.chain.explorerUrl} target="_blank" rel="noopener noreferrer">
              {short(proof.chain.txHash)} <ArrowUpRight size={12} />
            </a>
          </Row>
          <Row k="Block">{proof.chain.blockNumber.toLocaleString("en-US")}</Row>
          <Row k={settled ? "Settled" : "Recorded"}>{dateStr}</Row>
          <Row k="Event">{proof.chain.eventType}</Row>
          {!settled && proof.human.failedCheckIndex != null && (
            <Row k="Failed check">
              #{proof.human.failedCheckIndex} · {proof.human.failedCheckReason}
            </Row>
          )}
          <Row k="Policy Vault">{short(proof.chain.vault)}</Row>
          <Row k="Operator">{short(proof.chain.operator)}</Row>
          {proof.chain.attemptStatus && (
            <Row k="Attempt">{proof.chain.attemptStatus}</Row>
          )}
        </div>

        {/* commitment verification — the three intent sources */}
        <div className={`spp-commit ${committed ? "ok" : isMismatch ? "bad" : "warn"}`}>
          <div className="spp-commit-head">
            {committed ? (
              <>
                <BadgeCheck size={15} /> Decision committed on-chain
              </>
            ) : isMismatch ? (
              <>
                <AlertTriangle size={15} /> Commitment does not match
              </>
            ) : (
              <>
                <FileText size={15} /> No decision commitment
              </>
            )}
          </div>
          {proof.commitment ? (
            <>
              <HashLine label="On-chain intent" value={proof.commitment.onchainIntent} />
              {proof.commitment.storedIntent && (
                <HashLine
                  label="Stored intent"
                  value={proof.commitment.storedIntent}
                  match={eqHash(proof.commitment.storedIntent, proof.commitment.onchainIntent)}
                />
              )}
              {proof.commitment.recomputedIntent && (
                <HashLine
                  label="Recomputed intent"
                  value={proof.commitment.recomputedIntent}
                  match={eqHash(proof.commitment.recomputedIntent, proof.commitment.onchainIntent)}
                />
              )}
              {proof.commitment.decisionDigest && (
                <HashLine label="Decision digest" value={proof.commitment.decisionDigest} />
              )}
              {proof.commitment.mismatchReason && (
                <div className="spp-commit-reason mono">{proof.commitment.mismatchReason}</div>
              )}
            </>
          ) : (
            <>
              <HashLine label="On-chain intent" value={proof.chain.onchainIntent} />
              <div className="spp-commit-note">
                This payout predates decision commitment v1, so there is no digest to
                recompute. The on-chain payment is still fully verifiable above.
              </div>
            </>
          )}
        </div>

        <a
          className="spp-verify"
          href={proof.chain.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <BadgeCheck size={16} /> Verify on-chain
        </a>
        {!settled && !isMismatch && (
          <p className="spp-card-note" style={{ margin: "0 20px 20px", lineHeight: 1.5 }}>
            On the explorer this transaction reads <b>Success</b> — that is the vault
            refusing <i>gracefully</i>: it emits a <span className="mono">SpendRejected</span>{" "}
            event and moves no funds, instead of reverting. The rejection is the proof.
          </p>
        )}
      </div>

      {/* SECTION 4 · safety context */}
      <div className="spp-card spp-reveal" style={{ animationDelay: "0.36s" }}>
        <div className="spp-card-head" style={{ borderBottom: "none", paddingBottom: 4 }}>
          <span className="spp-card-title">
            <ShieldCheck size={16} /> Safety context
          </span>
          <span
            className={`spp-vaultcap ${proof.safety.replaySupport === "supported" ? "ok" : proof.safety.replaySupport === "legacy" ? "warn" : "mut"}`}
          >
            {proof.safety.replaySupport === "supported"
              ? "Upgraded vault"
              : proof.safety.replaySupport === "legacy"
                ? "Legacy vault"
                : "Vault status unread"}
          </span>
        </div>
        <div className="spp-safety-desc">
          Six spending rules constrain what the Deputy may do. A separate
          consumed-intent guard prevents the same committed payout from settling
          twice.
        </div>
        <div className="spp-rows" style={{ paddingTop: 0 }}>
          <Row k="Payout amount">{money(proof.human.amountUsd, proof.chain.chainId)}</Row>
          <Row k="Per-payout cap">{money(proof.safety.perTxCap, proof.chain.chainId)}</Row>
          <Row k="24h velocity cap">{money(proof.safety.velocityCap, proof.chain.chainId)}</Row>
          <Row k="Policy budget">{money(proof.safety.budget, proof.chain.chainId)}</Row>
          <Row k="Remaining (at read time)">{money(proof.safety.remaining, proof.chain.chainId)}</Row>
        </div>
        <div className="spp-identity">
          <div className="spp-identity-l">
            <span className="spp-identity-ico">
              <Bot size={17} />
            </span>
            <div>
              <div className="spp-identity-name">Released by the Payout Deputy</div>
              <div className="spp-identity-sub">
                Operator {short(proof.chain.operator)} · vault {short(proof.chain.vault)} ·
                owner-controlled
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* share preview — the REAL rendered OG card */}
      <div className="spp-share spp-reveal" style={{ animationDelay: "0.44s" }}>
        <div className="spp-share-label">Preview when shared</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="spp-share-img"
          src={`/proof/${proof.chain.txHash}/opengraph-image`}
          alt="Shareable payout proof card"
          width={1200}
          height={630}
        />
      </div>

      <div className="spp-footer spp-reveal" style={{ animationDelay: "0.52s" }}>
        <div className="spp-footer-in">
          <Lock size={14} />
          <span>
            Secured by a Policy Vault. Powered by <Link href="/">Sage</Link>.
          </span>
        </div>
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="spp-row">
      <span className="k">{k}</span>
      <span className="v">{children}</span>
    </div>
  );
}

function eqHash(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function HashLine({
  label,
  value,
  match,
}: {
  label: string;
  value: string;
  match?: boolean;
}) {
  return (
    <div className="spp-hashline">
      <span className="spp-hashline-k">
        {label}
        {match === true && <Check className="ok" size={12} strokeWidth={3} />}
        {match === false && <X className="bad" size={12} strokeWidth={3} />}
      </span>
      <span className="spp-hashline-v mono">{value}</span>
    </div>
  );
}

function DecisionReceipt({
  decision,
  threshold,
}: {
  decision: NonNullable<FoundProof["decision"]>;
  threshold: number | null;
}) {
  const confPct = Math.round(decision.confidence * 100);
  const barPct = threshold != null ? Math.round(threshold * 100) : null;
  const highFraud = decision.fraudSignals.filter((f) => f.severity === "high");
  return (
    <div className="spp-dr">
      {/* confidence vs the autopilot bar */}
      <div className="spp-dr-conf">
        <div className="spp-dr-conf-top">
          <span className="spp-dr-conf-n mono">{confPct}%</span>
          <span className="spp-dr-conf-l">
            confidence{barPct != null ? ` · autopay bar ${barPct}%` : ""}
          </span>
        </div>
        <div className="spp-confbar" style={{ ["--fill" as string]: `${confPct}%` }}>
          <span className="spp-confbar-fill" />
          {barPct != null && (
            <span className="spp-confbar-notch" style={{ ["--notch" as string]: `${barPct}%` }} />
          )}
        </div>
        <div className="spp-dr-reason mono">reason · {decision.reasonCode}</div>
      </div>

      {/* the summary */}
      {decision.summary && <p className="spp-dr-summary">{decision.summary}</p>}

      {/* criteria */}
      <div className="spp-dr-crits">
        {decision.criteria.map((c, i) => (
          <div className="spp-dr-crit" key={i}>
            <span className={`spp-dr-crit-ico ${c.met ? "pos" : "dan"}`}>
              {c.met ? <Check size={13} strokeWidth={2.8} /> : <X size={13} strokeWidth={2.8} />}
            </span>
            <div className="spp-dr-crit-body">
              <div className="spp-dr-crit-label">{c.criterion}</div>
              {c.quote && <div className="spp-dr-quote mono">“{c.quote}”</div>}
            </div>
          </div>
        ))}
      </div>

      {/* fraud signals */}
      {decision.fraudSignals.length > 0 && (
        <div className="spp-dr-fraud">
          <div className="spp-dr-sub">Fraud screen</div>
          {decision.fraudSignals.map((f, i) => (
            <div className="spp-dr-fraud-row" key={i}>
              <span className={`spp-sev ${f.severity}`}>{f.severity}</span>
              <span className="spp-dr-fraud-txt">
                <b>{f.signal}</b> — {f.reason}
              </span>
            </div>
          ))}
        </div>
      )}
      {highFraud.length === 0 && decision.fraudSignals.length === 0 && (
        <div className="spp-dr-clean mono">no fraud signals raised</div>
      )}

      {/* provenance */}
      <div className="spp-dr-prov mono">
        {decision.engine === "llm" ? decision.model ?? "llm" : "heuristic"}
        {decision.provider ? ` · ${decision.provider}` : ""}
        {decision.latencyMs != null ? ` · ${decision.latencyMs}ms` : ""}
        {decision.costUsd != null ? ` · $${decision.costUsd.toFixed(6)}` : ""}
      </div>
      {decision.contentSha256 && (
        <div className="spp-dr-prov mono">evidence sha256 · {decision.contentSha256}</div>
      )}
      {decision.x402Status !== "not_required" && (
        <div className="spp-dr-prov mono">
          x402 verification · {x402StatusLabel(decision.x402Status)}
          {decision.x402PaymentTx
            ? ` · ${short(decision.x402PaymentTx)}`
            : decision.x402Reason
              ? ` · ${decision.x402Reason}`
              : ""}
        </div>
      )}
    </div>
  );
}
