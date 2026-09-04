"use client";

import { useEffect, useState } from "react";
import { Compass, Loader2 } from "lucide-react";

interface Mandate {
  enabled: number;
  productUrl: string | null;
  goal: string | null;
  instruction: string | null;
  policy: { weeklyCapBase: number; perCampaignCapBase: number; probeBase: number; reserveFloorBase: number; maxConcurrent: number };
  vetoWindowMinutes: number;
}
interface View { armed: boolean; mandate: Mandate | null; stance: { moving: boolean; reason: string } | null }

const usd = (b: number) => (b / 1e6).toFixed(0);

/**
 * THE STANDING MANDATE, in the founder's words: what Sage may buy work against, and the ceilings it
 * cannot argue with. Arming it changes nothing about launching by hand — both doors stay open, and
 * a founder who prefers to choose the work themselves simply never turns this on.
 */
export function MandateCard() {
  const [v, setV] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ productUrl: "", goal: "", instruction: "", weeklyCapUsd: "50", perCampaignCapUsd: "15", probeUsd: "5", reserveFloorUsd: "0", vetoWindowMinutes: "20" });

  const load = async () => {
    try {
      const r = await fetch("/api/operator", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as View;
      setV(j);
      if (j.mandate) {
        setF({
          productUrl: j.mandate.productUrl ?? "",
          goal: j.mandate.goal ?? "",
          instruction: j.mandate.instruction ?? "",
          weeklyCapUsd: usd(j.mandate.policy.weeklyCapBase),
          perCampaignCapUsd: usd(j.mandate.policy.perCampaignCapBase),
          probeUsd: usd(j.mandate.policy.probeBase),
          reserveFloorUsd: usd(j.mandate.policy.reserveFloorBase),
          vetoWindowMinutes: String(j.mandate.vetoWindowMinutes),
        });
      }
    } catch {
      /* the card simply does not render a stance */
    }
  };
  useEffect(() => { void load(); }, []);

  const save = async (enabled: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/operator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...f, enabled, weeklyCapUsd: Number(f.weeklyCapUsd), perCampaignCapUsd: Number(f.perCampaignCapUsd), probeUsd: Number(f.probeUsd), reserveFloorUsd: Number(f.reserveFloorUsd), vetoWindowMinutes: Number(f.vetoWindowMinutes) }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) setErr(j.error ?? "Could not save that.");
      else await load();
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <section className="ws-card">
      <div className="ws-card-h"><h2><Compass size={15} /> Let Sage run it</h2></div>
      <p className="ws-note">
        Fund the treasury once and Sage decides what work to buy against your product, designs it,
        funds it and pays for it — inside the ceilings you set here. Every move is proposed with its
        reason before the money leaves, and you can stop any of them. Launching by hand keeps working
        exactly as it does now.
      </p>

      <div className="mc-grid">
        <label className="mc-f mc-wide"><span>Your product</span><input className="ws-input" value={f.productUrl} onChange={set("productUrl")} placeholder="https://yourproduct.com" /></label>
        <label className="mc-f mc-wide"><span>What you want from it</span><input className="ws-input" value={f.goal} onChange={set("goal")} placeholder="get developers through the quickstart" /></label>
        <label className="mc-f mc-wide">
          <span>Tell it what to do — it follows this on every move</span>
          <textarea
            className="ws-input mc-instruction"
            rows={2}
            value={f.instruction}
            onChange={set("instruction")}
            placeholder="focus on the signup flow this week, and prefer written walkthroughs over quick reads"
          />
        </label>
        <label className="mc-f"><span>A week, at most</span><input className="ws-input" inputMode="decimal" value={f.weeklyCapUsd} onChange={set("weeklyCapUsd")} /></label>
        <label className="mc-f"><span>One campaign, at most</span><input className="ws-input" inputMode="decimal" value={f.perCampaignCapUsd} onChange={set("perCampaignCapUsd")} /></label>
        <label className="mc-f"><span>First probe</span><input className="ws-input" inputMode="decimal" value={f.probeUsd} onChange={set("probeUsd")} /></label>
        <label className="mc-f"><span>Never spend below</span><input className="ws-input" inputMode="decimal" value={f.reserveFloorUsd} onChange={set("reserveFloorUsd")} /></label>
        <label className="mc-f"><span>Minutes to object</span><input className="ws-input" inputMode="numeric" value={f.vetoWindowMinutes} onChange={set("vetoWindowMinutes")} /></label>
      </div>

      {err && <p className="mc-err">{err}</p>}
      {v?.armed && v.stance && <p className="mc-stance">{v.stance.reason.charAt(0).toUpperCase() + v.stance.reason.slice(1)}.</p>}

      <div className="mc-actions">
        <button type="button" className="nm-btn" disabled={busy} onClick={() => void save(true)}>
          {busy ? <Loader2 size={13} className="mc-spin" /> : v?.armed ? "Save changes" : "Let Sage run it"}
        </button>
        {v?.armed && (
          <button type="button" className="nm-btn ghost" disabled={busy} onClick={() => void save(false)}>
            Take back the wheel
          </button>
        )}
      </div>
    </section>
  );
}
