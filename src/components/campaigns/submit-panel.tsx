"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { short } from "@/lib/format";
import { useSiwe } from "@/lib/auth/use-siwe";

interface MySubmission {
  id: string;
  status: string;
  payoutTx: string | null;
  evidenceUrl: string | null;
}

/**
 * The participant's side of a campaign: connect + sign in, submit an entry, and
 * see its real status. A paid entry links to its on-chain proof — the same
 * verifiable receipt the poster released. Uses the unified .sage-* vocabulary so
 * a stranger meets the same product as the app.
 */
export function SubmitPanel({
  campaignId,
  live,
}: {
  campaignId: string;
  live: boolean;
}) {
  const siwe = useSiwe();
  const [evidence, setEvidence] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<MySubmission | null>(null);

  const loadMine = useCallback(async () => {
    if (!siwe.authed) {
      setMine(null);
      return;
    }
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/me`, { cache: "no-store" });
      const json = (await res.json()) as { submission: MySubmission | null };
      setMine(json.submission);
    } catch {
      setMine(null);
    }
  }, [campaignId, siwe.authed]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

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

  /* ── already submitted → show live status ───────────────────────────── */
  if (mine) {
    const paid = mine.status === "paid";
    const rejected = mine.status === "rejected";
    return (
      <div className="sage-subs">
        <div className="sage-sub">
          <div className="sage-sub-main">
            <div className="sage-sub-wallet">
              {paid ? (
                <CheckCircle2 size={15} color="var(--pos)" />
              ) : rejected ? (
                <XCircle size={15} color="var(--dan)" />
              ) : (
                <Loader2 size={15} className="sage-spin2" color="var(--accent)" />
              )}
              Your entry
            </div>
            <div className="sage-sub-note">
              {paid
                ? "Paid on-chain. The reward has been released to your wallet."
                : rejected
                  ? "Not accepted this time."
                  : "Submitted. Waiting on the poster's review."}
            </div>
            {paid && mine.payoutTx && (
              <a className="sage-sub-link" href={`/proof/${mine.payoutTx}`}>
                <ExternalLink size={13} /> View payout proof
              </a>
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
