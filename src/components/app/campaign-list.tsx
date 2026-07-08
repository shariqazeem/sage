"use client";

import { ChevronRight, Plus } from "lucide-react";
import { usd } from "@/lib/format";
import { CountUp } from "@/components/app/count-up";
import type { CampaignCard } from "@/lib/campaigns/overview";

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "live" ? "pos" : status === "completed" ? "gray" : "amber";
  const cls =
    tone === "pos"
      ? "sage-pol-chip indigo"
      : tone === "amber"
        ? "sage-pol-chip amber"
        : "sage-pol-chip gray";
  return <span className={cls}>{status}</span>;
}

/**
 * The founder's campaigns, as design-system cards under the Deputy hero. Every
 * number is real (from overview): reward, paid-of-max progress, submission count,
 * and a pending-review badge when work is waiting. Tapping opens campaign detail
 * in-shell (same pattern as Deputy detail).
 */
export function CampaignList({
  campaigns,
  onOpen,
  onNew,
}: {
  campaigns: CampaignCard[];
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <>
      <div className="sb-sec-label" style={{ marginTop: 20 }}>
        Your campaigns
      </div>
      {campaigns.length === 0 ? (
        <div className="sb-card sb-empty">
          No campaigns yet. Create one — participants submit, you approve, and the
          vault pays real USDC.
        </div>
      ) : (
        <div className="sb-grid">
          {campaigns.map((c) => (
            <button
              key={c.id}
              className="sb-card sb-agent-tap sage-camp"
              onClick={() => onOpen(c.id)}
            >
              <div className="sage-camp-main">
                <div className="sage-camp-top">
                  <span className="sage-camp-title">{c.title}</span>
                  <StatusPill status={c.status} />
                </div>
                <div className="sage-camp-meta mono">
                  {usd(c.rewardBase / 1_000_000)} per payout ·{" "}
                  <CountUp value={c.paid} duration={450} />
                  {c.maxRecipients > 0 ? `/${c.maxRecipients}` : ""} paid ·{" "}
                  {c.submissions} submission{c.submissions === 1 ? "" : "s"}
                </div>
              </div>
              {c.pending > 0 && (
                <span className="sage-camp-badge">{c.pending} to review</span>
              )}
              <ChevronRight size={18} className="sb-agent-chev" />
            </button>
          ))}
        </div>
      )}
      <button className="sage-new" onClick={onNew} style={{ marginTop: 14 }}>
        <Plus size={16} /> New campaign
      </button>
    </>
  );
}
