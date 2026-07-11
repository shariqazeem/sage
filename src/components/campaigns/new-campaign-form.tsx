"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  Copy,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { short } from "@/lib/format";
import { useSiwe } from "@/lib/auth/use-siwe";
import { AutopilotCard } from "./autopilot-card";

interface Created {
  id: string;
  url: string;
}

/**
 * Create a reward campaign. Requires a signed-in wallet (the poster). On success
 * it surfaces the public participant link to share — the whole point of the
 * campaign layer: hand a link out, review what comes back, pay from your vault.
 */
export function NewCampaignForm({
  vaultAddress,
  onCreated,
  template,
}: {
  vaultAddress?: string;
  /** In-shell: open the new campaign's detail surface instead of routing away. */
  onCreated?: (id: string) => void;
  /** Optional starting values — used to land a fresh founder in a ready-to-run draft. */
  template?: {
    title?: string;
    description?: string;
    criteria?: string;
    rewardUsd?: string;
  };
}) {
  const siwe = useSiwe();
  const router = useRouter();
  const [title, setTitle] = useState(template?.title ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [criteria, setCriteria] = useState(template?.criteria ?? "");
  const [rewardUsd, setRewardUsd] = useState(template?.rewardUsd ?? "10");
  const [maxRecipients, setMaxRecipients] = useState("25");
  const [autonomy, setAutonomy] = useState<"manual" | "autopilot">("manual");
  const [threshold, setThreshold] = useState(0.85);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);
  const [vault, setVault] = useState<string | undefined>(vaultAddress);

  // Pay from the founder's own vault (created in onboarding) when present; the
  // server falls back to the seeded demo vault otherwise.
  useEffect(() => {
    if (vaultAddress) return;
    try {
      const v = window.localStorage.getItem("sage_vault");
      if (v) setVault(v);
    } catch {
      /* localStorage unavailable — server picks the demo vault */
    }
  }, [vaultAddress]);

  const create = useCallback(async () => {
    setError(null);
    if (!siwe.authed) {
      const ok = await siwe.signIn();
      if (!ok) {
        setError("Sign in with your wallet to create a campaign.");
        return;
      }
    }
    setBusy(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          criteria,
          rewardUsd,
          maxRecipients,
          vaultAddress: vault,
          autonomy,
          autopilotThreshold: threshold,
        }),
      });
      const json = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !json.id) {
        setError(json.error ?? "Could not create the campaign.");
        return;
      }
      const url = `${window.location.origin}/c/${json.id}`;
      setCreated({ id: json.id, url });
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }, [siwe, title, description, criteria, rewardUsd, maxRecipients, vault, autonomy, threshold]);

  const copy = useCallback(async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the link is still visible to copy manually */
    }
  }, [created]);

  /* ── created → share panel ──────────────────────────────────────────── */
  if (created) {
    return (
      <div className="sage-subs" style={{ padding: 22 }}>
        <div className="sage-eyebrow" style={{ color: "var(--pos)" }}>
          <Check size={13} /> Campaign is live
        </div>
        <p className="sage-hint" style={{ marginBottom: 14 }}>
          Share this link. Anyone can connect a wallet and submit; you review and
          pay from the review queue.
        </p>
        <div className="sage-row" style={{ marginBottom: 16 }}>
          <code className="mono" style={{ fontSize: 13 }}>
            {created.url}
          </code>
          <button className="sage-copy" onClick={() => void copy()} aria-label="Copy link">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        <div className="sage-row">
          <button
            className="sage-btn sage-btn-primary sage-btn-sm"
            onClick={() =>
              onCreated
                ? onCreated(created.id)
                : router.push(`/campaigns/${created.id}/review`)
            }
          >
            Go to review queue <ArrowRight size={14} />
          </button>
          <a className="sage-btn sage-btn-ghost sage-btn-sm" href={created.url} target="_blank" rel="noopener">
            Open public page
          </a>
        </div>
      </div>
    );
  }

  /* ── form ───────────────────────────────────────────────────────────── */
  return (
    <div>
      <div className="sage-field">
        <label className="sage-label">Campaign title</label>
        <input
          className="sage-input"
          placeholder="Test the Sage onboarding"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
        />
      </div>
      <div className="sage-field">
        <label className="sage-label">What are you asking people to do?</label>
        <textarea
          className="sage-textarea"
          rows={3}
          placeholder="Describe the work and how it's judged."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy}
        />
      </div>
      <div className="sage-field">
        <label className="sage-label">Acceptance criteria (one per line)</label>
        <textarea
          className="sage-textarea"
          rows={3}
          placeholder={"Completed the flow\nReported one issue with a link"}
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          disabled={busy}
        />
      </div>
      <div className="sage-row" style={{ marginBottom: 18 }}>
        <div className="sage-field sage-budget-field">
          <label className="sage-label">Reward (USDC)</label>
          <input
            className="sage-input mono"
            inputMode="decimal"
            value={rewardUsd}
            onChange={(e) => setRewardUsd(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="sage-field sage-budget-field">
          <label className="sage-label">Max recipients</label>
          <input
            className="sage-input mono"
            inputMode="numeric"
            value={maxRecipients}
            onChange={(e) => setMaxRecipients(e.target.value)}
            disabled={busy}
          />
        </div>
      </div>

      <AutopilotCard
        autonomy={autonomy}
        threshold={threshold}
        busy={busy}
        onChange={(n) => {
          setAutonomy(n.autonomy);
          setThreshold(n.threshold);
        }}
      />

      <div className="sage-row" style={{ marginTop: 18 }}>
        <button className="sage-btn sage-btn-primary" onClick={() => void create()} disabled={busy}>
          {busy ? (
            <>
              <Loader2 size={15} className="sage-spin2" /> Creating…
            </>
          ) : siwe.authed ? (
            <>
              Create campaign <ArrowRight size={15} />
            </>
          ) : (
            <>
              <ShieldCheck size={15} /> Sign in & create
            </>
          )}
        </button>
        <span className="sage-hint">
          {siwe.authed
            ? `Poster: ${short(siwe.address ?? "")}`
            : "Rewards are paid from your on-chain wallet."}
        </span>
      </div>

      {error && (
        <div className="sage-toast dan">
          <XCircle size={15} /> {error}
        </div>
      )}
    </div>
  );
}
