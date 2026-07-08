import Link from "next/link";
import {
  Check,
  X,
  Lock,
  ShieldCheck,
  Bot,
  ArrowUpRight,
  BadgeCheck,
} from "lucide-react";
import { usd, short } from "@/lib/format";
import { NetworkChip } from "@/components/app/network-chip";
import type { PayoutProof } from "@/lib/deputy/chain";

const REASONS: Record<number, string> = {
  1: "the vault was paused, expired, or revoked",
  2: "the caller was not the authorized operator",
  3: "the recipient was not on the approved allowlist",
  4: "it exceeded the per-payout cap",
  5: "it would exceed the remaining budget",
  6: "it would exceed the 24h velocity cap",
};

/**
 * The public per-payout proof page. Three layers reveal in sequence — the human
 * fact, the machine proof, the safety context — all derived from ONE real tx so
 * a stranger can verify it on-chain without trusting us. Server-rendered; the
 * reveal is pure CSS.
 */
export function SageProofPage({
  proof,
  reward,
  explorerBase,
}: {
  proof: PayoutProof;
  reward: string;
  explorerBase: string;
}) {
  const settled = proof.settled;
  const tone = settled ? "pos" : "dan";
  const dateStr = proof.timestamp
    ? new Date(proof.timestamp * 1000).toUTCString()
    : "";
  const reason = proof.failedCheckIndex
    ? (REASONS[proof.failedCheckIndex] ?? "a policy check")
    : "";

  const checks = settled
    ? [
        {
          pass: true,
          label: "Under the per-payout cap",
          value: `${usd(proof.amount)} ≤ ${usd(proof.perTxCap)}`,
        },
        {
          pass: true,
          label: "Within the remaining budget",
          value: `${usd(proof.amount)} of ${usd(proof.budget)}`,
        },
        { pass: true, label: "Recipient was on the allowlist", value: "approved" },
        {
          pass: true,
          label: "Released by the authorized Deputy",
          value: "operator",
        },
      ]
    : [
        {
          pass: proof.failedCheckIndex !== 4,
          label: "Under the per-payout cap",
          value: `${usd(proof.amount)} vs ${usd(proof.perTxCap)}`,
        },
        {
          pass: proof.failedCheckIndex !== 1,
          label: "Vault active",
          value: proof.failedCheckIndex === 1 ? "not active" : "active",
        },
        {
          pass: proof.failedCheckIndex !== 3,
          label: "Recipient on the allowlist",
          value: proof.failedCheckIndex === 3 ? "not approved" : "approved",
        },
        {
          pass: proof.failedCheckIndex !== 5,
          label: "Within the remaining budget",
          value: `${usd(proof.remaining)} left`,
        },
      ];

  return (
    <div className="spp">
      <div className="spp-col spp-top spp-reveal">
        <div className="spp-brand">
          <span className="spp-mark">
            <span className="spp-mark-ring" />
          </span>
          <span className="spp-wordmark">Sage</span>
        </div>
        <span
          style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
        >
          <span className="spp-kicker">Public payout proof</span>
          <NetworkChip chainId={proof.chainId} size="xs" />
        </span>
      </div>

      {/* layer 1 · the human fact */}
      <div className="spp-col spp-fact-wrap">
        <div className={`spp-medallion ${tone}`}>
          {settled ? (
            <Check size={40} strokeWidth={2.4} />
          ) : (
            <X size={40} strokeWidth={2.4} />
          )}
        </div>
        <div className="spp-reveal" style={{ animationDelay: "0.16s" }}>
          <span className={`spp-status ${tone}`}>
            <span className="dot" />
            {settled ? "Settled" : "Blocked"}
          </span>
          <div className="spp-amount mono">{usd(proof.amount)}</div>
          <div className="spp-fact">
            {settled ? `${usd(proof.amount)} paid to ` : `${usd(proof.amount)} attempt to `}
            <span className="mono">{short(proof.recipient)}</span>
          </div>
          <div className="spp-reward">for {reward}</div>
          {!settled && (
            <div className="spp-blocked-note">
              <Lock size={15} /> Refused on-chain — {reason}. No funds moved.
            </div>
          )}
        </div>
      </div>

      {/* layer 2 · machine proof */}
      <div className="spp-card big spp-reveal" style={{ animationDelay: "0.26s" }}>
        <div className="spp-card-head">
          <span className="spp-card-title">
            <BadgeCheck size={16} /> Machine proof
          </span>
          <span className="spp-card-note">You don&apos;t have to trust us.</span>
        </div>
        <div className="spp-rows">
          <div className="spp-row">
            <span className="k">Transaction</span>
            <a
              className="v"
              href={proof.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {short(proof.txHash)} <ArrowUpRight size={12} />
            </a>
          </div>
          <div className="spp-row">
            <span className="k">Network</span>
            <span className="v">{proof.network}</span>
          </div>
          <div className="spp-row">
            <span className="k">Block</span>
            <span className="v">{proof.blockNumber.toLocaleString("en-US")}</span>
          </div>
          <div className="spp-row">
            <span className="k">{settled ? "Settled" : "Recorded"}</span>
            <span className="v">{dateStr}</span>
          </div>
          <div className="spp-row">
            <span className="k">Token</span>
            <span className="v">USDC</span>
          </div>
        </div>
        <a
          className="spp-verify"
          href={proof.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <BadgeCheck size={16} /> Verify on-chain
        </a>
        {!settled && (
          <p className="spp-card-note" style={{ marginTop: 12, lineHeight: 1.5 }}>
            On the explorer this transaction reads <b>Success</b> — that is the vault
            refusing <i>gracefully</i>: it emits a{" "}
            <span className="mono">SpendRejected</span> event and moves no funds,
            instead of reverting. The rejection itself is the on-chain proof.
          </p>
        )}
      </div>

      {/* layer 3 · safety context */}
      <div className="spp-card spp-reveal" style={{ animationDelay: "0.34s" }}>
        <div
          className="spp-card-head"
          style={{ borderBottom: "none", paddingBottom: 4 }}
        >
          <span className="spp-card-title">
            <ShieldCheck size={16} /> {settled ? "And it was safe" : "The vault held"}
          </span>
        </div>
        <div className="spp-safety-desc">
          This payout {settled ? "stayed inside" : "was measured against"} the mandate
          its Deputy was given.
        </div>
        <div className="spp-safety-desc spp-why">
          <b>Why on-chain?</b> A database flag that says “budget exceeded” can be
          flipped by whoever runs the database. The vault physically cannot move funds
          off-policy — even if Sage itself is compromised. Enforcement you have to
          trust isn’t enforcement.
        </div>
        <div className="spp-checks">
          {checks.map((c, i) => (
            <div className="spp-check" key={i}>
              <span className={`spp-check-ico ${c.pass ? "pos" : "dan"}`}>
                {c.pass ? (
                  <Check size={14} strokeWidth={2.6} />
                ) : (
                  <X size={14} strokeWidth={2.6} />
                )}
              </span>
              <span className="label">{c.label}</span>
              <span className={`value ${c.pass ? "pos" : "dan"}`}>{c.value}</span>
            </div>
          ))}
        </div>
        <div className="spp-identity">
          <div className="spp-identity-l">
            <span className="spp-identity-ico">
              <Bot size={17} />
            </span>
            <div>
              <div className="spp-identity-name">Released by the Payout Deputy</div>
              <div className="spp-identity-sub">
                Policy Vault {short(proof.vault)} · ERC-8004 identity
              </div>
            </div>
          </div>
          <a
            href={`${explorerBase}/address/${proof.vault}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            vault <ArrowUpRight size={12} />
          </a>
        </div>
      </div>

      {/* share preview */}
      <div className="spp-share spp-reveal" style={{ animationDelay: "0.42s" }}>
        <div className="spp-share-label">Preview when shared</div>
        <div className="spp-share-card">
          <div className="spp-share-dark">
            <div>
              <span
                className="spp-share-pill"
                style={{
                  background: settled
                    ? "rgba(21,128,61,.2)"
                    : "rgba(220,38,38,.2)",
                  color: settled ? "#4ade80" : "#f87171",
                }}
              >
                <span
                  className="dot"
                  style={{ background: settled ? "#4ade80" : "#f87171" }}
                />
                {settled ? "Settled" : "Blocked"}
              </span>
              <div className="spp-share-amt mono">{usd(proof.amount)}</div>
              <div className="spp-share-sub">
                Verified on-chain · {proof.network}
              </div>
            </div>
            <div className="spp-share-badge">
              <div />
            </div>
          </div>
          <div className="spp-share-light">
            <span className="spp-share-url">sage · /proof/{short(proof.txHash)}</span>
            <span className="spp-share-brand">Sage</span>
          </div>
        </div>
      </div>

      {/* footer */}
      <div className="spp-footer spp-reveal" style={{ animationDelay: "0.5s" }}>
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
