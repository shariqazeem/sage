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
      text: "Not accepted this time",
      color: "var(--dan)",
    };
  if (m.status === "blocked")
    return {
      icon: <XCircle size={15} color="var(--dan)" />,
      text: "The wallet blocked this payout — no funds moved",
      color: "var(--dan)",
    };
  const highFraud = m.brief?.fraudSignals?.some((f) => f.severity === "high");
  const held = m.autopay?.state === "held" || (!!m.brief && m.brief.recommendation !== "pay");
  if (held) {
    const why = highFraud
      ? "a fraud signal was flagged"
      : m.brief?.recommendation === "hold"
        ? "criteria not fully met"
        : "needs a human look";
    return {
      icon: <Clock size={15} color="var(--warn)" />,
      text: `Held for human review — ${why}`,
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
}: {
  campaignId: string;
  live: boolean;
  rewardUsd?: number | null;
  threshold?: number;
}) {
  const siwe = useSiwe();
  const [evidence, setEvidence] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<MySubmission | null>(null);
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
      await loadMine();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }, [campaignId, evidence, note, loadMine]);

  /* ── not signed in ──────────────────────────────────────────────────── */
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
  if (mine) {
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
