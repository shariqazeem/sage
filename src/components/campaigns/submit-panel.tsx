"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { short } from "@/lib/format";
import { useSiwe } from "@/lib/auth/use-siwe";
import { useStarknetSiwe } from "@/lib/auth/use-starknet-siwe";
import { WalletConnect } from "@/components/wallet/wallet-connect";
import type { SettlementRail } from "@/lib/db/schema";
import { workerShouldPoll } from "@/lib/campaigns/live-poll";
import type { DecisionBrief } from "@/lib/deputy/brain-core";
import { DeputyAssessmentCard } from "./deputy-assessment";

interface MySubmission {
  id: string;
  status: string;
  payoutTx: string | null;
  evidenceUrl: string | null;
  /** the worker's OWN decision brief (own-scope) — null until the Deputy decides. */
  brief: DecisionBrief | null;
  autopay: { state: "settled" | "held"; reason: string | null } | null;
  rejectReason: string | null;
  retry: { attempt: number; maxAttempts: number; attemptsLeft: number; retryable: boolean; coaching: string } | null;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/**
 * The three-beat live status, bound to the worker's real /me state — verifying →
 * verified → paid, with honest held/rejected/blocked branches. No invented
 * progress: every beat maps to a concrete server state.
 */
function workerBeat(m: MySubmission): { icon: ReactNode; text: string; color: string } {
  if (m.status === "paid")
    return {
      icon: <CheckCircle2 size={15} color="var(--pos)" />,
      text: "Paid · reward released to your wallet",
      color: "var(--pos)",
    };
  if (m.status === "rejected")
    return {
      icon: <XCircle size={15} color="var(--dan)" />,
      text: m.retry?.retryable ? "Not accepted — here's why, and you can resubmit" : "Not accepted this time",
      color: "var(--dan)",
    };
  if (m.status === "blocked")
    return {
      icon: <XCircle size={15} color="var(--dan)" />,
      text: "The wallet blocked this payout — no funds moved",
      color: "var(--dan)",
    };
  if (m.status === "approved")
    return {
      icon: <ShieldCheck size={15} color="var(--accent)" />,
      text: "Verified · approved — Sage pays after a short window it uses to check for copies and wallet clusters",
      color: "var(--accent)",
    };
  const highFraud = m.brief?.fraudSignals?.some((f) => f.severity === "high");
  const held = m.autopay?.state === "held" || (!!m.brief && m.brief.recommendation !== "pay");
  if (held) {
    if (m.brief?.recommendation === "pay" && m.autopay?.state === "held")
      return {
        icon: <Clock size={15} color="var(--warn)" />,
        text: "Verified, but held for the founder — see why below",
        color: "var(--warn)",
      };
    const unmet = (m.brief?.criteria ?? []).filter((c) => c.met === false).length;
    const total = (m.brief?.criteria ?? []).length;
    const why = highFraud
      ? "a fraud signal was flagged"
      : unmet > 0
        ? `Sage couldn't confirm ${unmet} of ${total} ${total === 1 ? "requirement" : "requirements"}`
        : m.brief?.recommendation === "hold"
          ? "criteria not fully met"
          : "needs a human look";
    return {
      icon: <Clock size={15} color="var(--warn)" />,
      text: m.retry?.retryable ? `Held — ${why} · you can revise` : `Held for human review — ${why}`,
      color: "var(--warn)",
    };
  }
  if (m.brief)
    return {
      icon: <ShieldCheck size={15} color="var(--accent)" />,
      text: `Verified · ${Math.round(clamp01(m.brief.confidence) * 100)}% confidence`,
      color: "var(--accent)",
    };
  return {
    icon: <Loader2 size={15} className="sage-spin2" color="var(--accent)" />,
    text: "Sage is verifying your evidence…",
    color: "var(--sec)",
  };
}

/**
 * The participant's side of a campaign: connect + sign in, submit an entry, and
 * then WATCH the Deputy verify and pay it live (polling /me — no reload). A paid
 * entry links to its on-chain proof, and the worker sees their own decision
 * receipt — the same verifiable reasoning the poster sees, which teaches the next
 * submitter what good evidence looks like.
 */
export function SubmitPanel({
  campaignId,
  live,
  rewardUsd = null,
  threshold = 0.85,
  rail = "evm",
}: {
  campaignId: string;
  live: boolean;
  rewardUsd?: number | null;
  threshold?: number;
  rail?: SettlementRail;
}) {
  /**
   * THE SIGN-IN HAS TO MATCH THE RAIL THE CAMPAIGN PAYS ON.
   *
   * Not a cosmetic choice: the address that signs in is the address that gets paid, and a
   * Starknet campaign cannot pay an EVM address. Before this, a tester on a private-capable
   * campaign signed in with an EVM wallet, submitted, and was refused by the API with "use a
   * Starknet wallet" — on a page that offered no way to do that. A dead end at the last step,
   * after the work was already done.
   *
   * Both hooks run because hooks must; only the rail's own result is read.
   */
  const evm = useSiwe();
  const starknet = useStarknetSiwe();
  const onStarknet = rail === "starknet";
  const siwe = onStarknet
    ? {
        authed: starknet.authed,
        address: starknet.address,
        signingIn: starknet.signingIn,
        signIn: () => Promise.resolve(false), // Starknet picks a wallet first — see the gate below.
      }
    : evm;
  const [evidence, setEvidence] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<MySubmission | null>(null);
  // a held/refused entry re-opens the form in place: the route revises the existing row (attempt+1).
  const [revising, setRevising] = useState(false);
  // fire the receipt "materialize" once, the moment the brief first lands.
  const [materialized, setMaterialized] = useState(false);
  const hadBrief = useRef(false);

  const loadMine = useCallback(async () => {
    if (!siwe.authed) {
      setMine(null);
      return;
    }
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/me`, { cache: "no-store" });
      const json = (await res.json()) as { submission: MySubmission | null };
      const next = json.submission;
      if (next?.brief && !hadBrief.current) setMaterialized(true);
      hadBrief.current = !!next?.brief;
      setMine(next);
    } catch {
      /* keep the last snapshot; the next poll retries */
    }
  }, [campaignId, siwe.authed]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  // Poll /me while the entry isn't terminal, so the worker watches it get read,
  // judged, and paid in real time. Paused when the tab is hidden; stops on a
  // terminal state; interval cleared on unmount.
  const pollActive = !!mine && workerShouldPoll(mine.status);
  useEffect(() => {
    if (!pollActive) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void loadMine();
    };
    const start = () => {
      if (!timer) timer = setInterval(tick, 2500);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVis = () => {
      if (document.hidden) stop();
      else {
        tick();
        start();
      }
    };
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pollActive, loadMine]);

  const submit = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evidence: evidence.trim(), note: note.trim() }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Could not submit.");
        return;
      }
      setRevising(false);
      await loadMine();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }, [campaignId, evidence, note, loadMine]);

  /* ── not signed in ──────────────────────────────────────────────────── */
  if (onStarknet && !starknet.authed) {
    // Still reading the cookie — a connect prompt here would ask a signed-in tester to sign again
    // for a session they already hold.
    if (starknet.loading) {
      return (
        <div className="sage-gate">
          <p>
            <Loader2 size={15} className="sage-spin2" /> Checking your wallet…
          </p>
        </div>
      );
    }
    return (
      <div className="sage-gate">
        <WalletConnect
          options={starknet.wallets.map((w) => ({
            id: w.id,
            name: w.name,
            icon: w.icon,
            onSelect: () => void starknet.signIn(w),
          }))}
          explainer={
            <>
              This campaign pays on Starknet, so sign in with a Starknet wallet — <b>that is the
              address you&rsquo;ll be paid at.</b>
            </>
          }
          busy={starknet.signingIn}
          busyLabel="Waiting for your wallet…"
          error={starknet.error}
          emptyMessage="No Starknet wallet found in this browser."
          installHints={[
            { name: "Ready", url: "https://www.ready.co" },
            { name: "Braavos", url: "https://braavos.app" },
          ]}
        />
      </div>
    );
  }

  if (!siwe.authed) {
    // The SAME component as the Starknet gate above. The browser injects one EVM provider and
    // picks for us, so there is exactly one option — but it is presented in the same language,
    // so which chain a campaign settles on is not something a person feels in the layout.
    return (
      <div className="sage-gate">
        <WalletConnect
          options={[
            {
              id: "injected",
              name: siwe.address ? short(siwe.address) : "your wallet",
              onSelect: () => void siwe.signIn(),
            },
          ]}
          explainer={
            <>
              Connect your wallet and sign a message to submit — <b>that is the address
              you&rsquo;ll be paid at.</b>
            </>
          }
          busy={siwe.signingIn}
          busyLabel="Waiting for your wallet…"
          emptyMessage="No wallet found in this browser."
          installHints={[{ name: "MetaMask", url: "https://metamask.io/download" }]}
        />
      </div>
    );
  }

  if (!siwe.authed) {
    return (
      <div className="sage-gate">
        <p>
          Connect your wallet and sign a message to submit. Signing proves you
          control the wallet — it authorizes no transaction and moves no funds.
        </p>
        <button
          className="sage-btn sage-btn-primary"
          onClick={() => void siwe.signIn()}
          disabled={siwe.signingIn}
        >
          {siwe.signingIn ? (
            <>
              <Loader2 size={15} className="sage-spin2" /> Signing…
            </>
          ) : siwe.address ? (
            <>
              <ShieldCheck size={15} /> Sign in as {short(siwe.address)}
            </>
          ) : (
            "Connect wallet to submit"
          )}
        </button>
      </div>
    );
  }

  /* ── already submitted → watch the Deputy work, live ────────────────── */
  if (mine && !revising) {
    const beat = workerBeat(mine);
    return (
      <div className="sage-subs">
        <div className="sage-sub">
          <div className="sage-sub-main">
            <div className="sage-sub-wallet">Your entry</div>
            {/* the three-beat mono status line, bound to real /me state */}
            <div
              className="mono"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontSize: 13,
                color: beat.color,
              }}
            >
              {beat.icon}
              {beat.text}
            </div>
            {mine.status === "paid" && mine.payoutTx && (
              <a className="sage-sub-link" href={`/proof/${mine.payoutTx}`}>
                <ExternalLink size={13} /> View payout proof
              </a>
            )}
            {/* the worker's OWN decision receipt — same reasoning the poster sees */}
            {mine.brief && (
              <DeputyAssessmentCard
                brief={mine.brief}
                rewardUsd={rewardUsd}
                threshold={threshold}
                materialize={materialized}
              />
            )}
            {/* Why it was held or refused, in words the worker can act on — and the way back to the form.
                Before this the panel said "Not accepted this time" and offered nothing else. */}
            {mine.retry && (
              <div className="v2-retry" style={{ marginTop: 12 }}>
                <div className="v2-retry-body">
                  <p className="v2-retry-coach">{mine.retry.coaching}</p>
                  {mine.retry.retryable && (
                    <button
                      className="sage-btn sage-btn-primary sage-btn-sm"
                      onClick={() => {
                        setError(null);
                        setEvidence(mine.evidenceUrl ?? "");
                        setRevising(true);
                      }}
                    >
                      Revise &amp; resubmit
                      <span className="v2-retry-count mono">{mine.retry.attemptsLeft} left</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="sage-sub-side">
            <StatusBadge status={mine.status} />
          </div>
        </div>
      </div>
    );
  }

  /* ── submission form ────────────────────────────────────────────────── */
  return (
    <div>
      {!live && (
        <div className="sage-toast info" style={{ marginTop: 0, marginBottom: 16 }}>
          This campaign isn&apos;t currently accepting submissions.
        </div>
      )}
      <div className="sage-field">
        <label className="sage-label">Evidence link (optional)</label>
        <input
          className="sage-input"
          placeholder="https://github.com/… or a public link to your work"
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          disabled={!live || submitting}
        />
      </div>
      <div className="sage-field">
        <label className="sage-label">Note (optional)</label>
        <textarea
          className="sage-textarea"
          rows={3}
          placeholder="Anything the reviewer should know."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={!live || submitting}
        />
      </div>
      <div className="sage-row">
        <button
          className="sage-btn sage-btn-primary"
          onClick={() => void submit()}
          disabled={!live || submitting}
        >
          {submitting ? (
            <>
              <Loader2 size={15} className="sage-spin2" /> Submitting…
            </>
          ) : (
            "Submit entry"
          )}
        </button>
        <span className="sage-hint">Signed in as {short(siwe.address ?? "")}</span>
      </div>
      {error && (
        <div className="sage-toast dan">
          <XCircle size={15} /> {error}
        </div>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  if (status === "paid") return <span className="sage-badge pos">Paid</span>;
  if (status === "rejected") return <span className="sage-badge dan">Rejected</span>;
  if (status === "approved") return <span className="sage-badge neutral">Approved</span>;
  if (status === "settling")
    return <span className="sage-badge indigo">Paying…</span>;
  return <span className="sage-badge neutral">Pending</span>;
}
