"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { usd } from "@/lib/format";
import { CopyButton } from "@/components/hire/copy-button";
import { BudgetRing } from "@/components/app/budget-ring";
import { AutopilotCard } from "@/components/campaigns/autopilot-card";
import {
  ReviewPanel,
  type ReviewSubmission,
} from "@/components/campaigns/review-panel";

interface DetailData {
  campaign: {
    id: string;
    title: string;
    descriptionMd: string;
    criteria: string[];
    status: string;
    rewardAmount: number;
    maxRecipients: number;
    vaultAddress: string;
    autonomy: "manual" | "autopilot";
    autopilotThreshold: number;
  };
  submissions: ReviewSubmission[];
  vault: { budget: number; spent: number; remaining: number } | null;
}

/**
 * Campaign detail as a full in-app surface (same back-button pattern as Deputy
 * detail). Header: title, status, the public-link copy chip, and live vault
 * numbers. Body: the review queue — the exact Pass 9 logic (pending/approved/
 * paid/rejected/blocked, the owner-signed allowlist→timelock-countdown→settle
 * motion, settle-all) — reading real data fetched for this poster.
 */
export function CampaignDetail({
  campaignId,
  onBack,
}: {
  campaignId: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<DetailData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // The ring's live remaining — seeded from the load, then lifted from the review
  // panel on each settle so the ring drains and fires its emerald pulse.
  const [vaultRemaining, setVaultRemaining] = useState<number | null>(null);
  // The standing mandate — seeded from the load, PATCHed on change (optimistic).
  const [autonomy, setAutonomy] = useState<"manual" | "autopilot">("manual");
  const [threshold, setThreshold] = useState(0.85);
  const [autoBusy, setAutoBusy] = useState(false);

  const patchAutonomy = useCallback(
    async (next: { autonomy: "manual" | "autopilot"; threshold: number }) => {
      setAutonomy(next.autonomy);
      setThreshold(next.threshold);
      setAutoBusy(true);
      try {
        await fetch(`/api/campaigns/${campaignId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            autonomy: next.autonomy,
            autopilotThreshold: next.threshold,
          }),
        });
      } catch {
        /* keep the optimistic value; the next load reconciles */
      } finally {
        setAutoBusy(false);
      }
    },
    [campaignId],
  );

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, { cache: "no-store" });
      const j = (await res.json()) as DetailData & { error?: string };
      if (!res.ok) {
        setErr(j.error ?? "Could not load this campaign.");
        return;
      }
      setData(j);
      setVaultRemaining(j.vault?.remaining ?? null);
      setAutonomy(j.campaign.autonomy);
      setThreshold(j.campaign.autopilotThreshold);
    } catch {
      setErr("Network error. Try again.");
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const publicPath = `/c/${campaignId}`;
  const publicUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${publicPath}`
      : publicPath;

  return (
    <section className="sb-detail">
      <button className="sb-back" onClick={onBack}>
        <ArrowLeft size={15} /> Campaigns
      </button>

      {err ? (
        <div className="sb-card sb-empty">{err}</div>
      ) : !data ? (
        <div className="sb-card sb-empty">
          <Loader2 size={16} className="sb-spin" /> Loading campaign…
        </div>
      ) : (
        <>
          <div
            className="sb-card sage-camp-detail-card"
            style={{ padding: 20, marginBottom: 16 }}
          >
            <div className="sage-camp-detail-main">
              <div className="sage-camp-top" style={{ marginBottom: 10 }}>
                <span className="sage-dep-name" style={{ fontSize: 18 }}>
                  {data.campaign.title}
                </span>
                <span
                  className={`sage-pol-chip ${
                    data.campaign.status === "live" ? "indigo" : "gray"
                  }`}
                >
                  {data.campaign.status}
                </span>
              </div>

              <div className="sage-linkrow">
                <span className="sage-link-chip mono">{publicPath}</span>
                <CopyButton value={publicUrl} label="public link" />
                <a
                  className="sage-copy"
                  href={publicPath}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open public page"
                >
                  <ExternalLink size={14} />
                </a>
              </div>

              <div className="sb-detail-stats" style={{ marginTop: 14 }}>
                <span>
                  <b className="mono">{usd(data.campaign.rewardAmount / 1_000_000)}</b>{" "}
                  per payout
                </span>
                <span>
                  <b className="mono">
                    {data.submissions.filter((s) => s.status === "paid").length}
                    {data.campaign.maxRecipients > 0
                      ? `/${data.campaign.maxRecipients}`
                      : ""}
                  </b>{" "}
                  paid
                </span>
              </div>
            </div>

            {data.vault && (
              <div className="sage-camp-detail-ring">
                <BudgetRing
                  remaining={vaultRemaining ?? data.vault.remaining}
                  budget={data.vault.budget}
                  size={132}
                  label="vault remaining"
                />
              </div>
            )}
          </div>

          <AutopilotCard
            autonomy={autonomy}
            threshold={threshold}
            busy={autoBusy}
            onChange={(n) => void patchAutonomy(n)}
          />

          <div className="sb-sec-label">Review queue</div>
          <ReviewPanel
            campaignId={campaignId}
            vaultAddress={data.campaign.vaultAddress}
            initial={data.submissions}
            remaining={data.vault?.remaining ?? null}
            rewardUsd={data.campaign.rewardAmount / 1_000_000}
            autonomy={autonomy}
            threshold={threshold}
            onRemaining={setVaultRemaining}
          />
        </>
      )}
    </section>
  );
}
