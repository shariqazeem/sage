"use client";

import { ArrowLeft } from "lucide-react";
import { NewCampaignForm } from "@/components/campaigns/new-campaign-form";

/**
 * Create a campaign inside the app shell (same back-button surface as detail).
 * Reuses the real form — validation, on-chain operator check, signed create —
 * and hands the new campaign's id back so the shell opens its detail directly.
 */
export function CampaignCreate({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (id: string) => void;
}) {
  return (
    <section className="sb-detail">
      <button className="sb-back" onClick={onBack}>
        <ArrowLeft size={15} /> Campaigns
      </button>
      <div className="sb-tabhead">
        <h1>New campaign</h1>
        <p>
          Describe the work, set a reward, share the link. You review each entry
          and pay winners from your vault — Sage never holds your keys.
        </p>
      </div>
      <div className="sb-card" style={{ padding: 20 }}>
        <NewCampaignForm onCreated={onCreated} />
      </div>
    </section>
  );
}
