"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Loader2 } from "lucide-react";
import { short, usd } from "@/lib/format";

export interface FeedItem {
  wallet: string;
  payoutTx: string;
  at: number;
}
export interface PublicData {
  paid: number;
  verifying: number;
  feed: FeedItem[];
}

/** A stable signature so an unchanged poll is a no-op (no re-render). */
function version(d: PublicData): string {
  return `${d.paid}:${d.verifying}:${d.feed.map((f) => f.payoutTx).join(",")}`;
}

/**
 * The spectator sport — the public payout feed, live. Seeded from the server
 * render, then polls the lightweight public endpoint every 5s so anyone (no
 * wallet, no sign-in) watches entries get verified and paid in real time. Shows
 * settled payouts (recipient + on-chain proof — already public) and an AGGREGATE
 * "being verified now" count; individual pending work stays private.
 */
export function PublicFeed({
  campaignId,
  rewardUsd,
  initial,
}: {
  campaignId: string;
  rewardUsd: number;
  initial: PublicData;
}) {
  const [data, setData] = useState<PublicData>(initial);
  const lastVersion = useRef<string>(version(initial));

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/public`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const j = (await res.json()) as Partial<PublicData>;
        const next: PublicData = {
          paid: j.paid ?? 0,
          verifying: j.verifying ?? 0,
          feed: j.feed ?? [],
        };
        const v = version(next);
        if (v === lastVersion.current) return; // unchanged → no-op
        lastVersion.current = v;
        setData(next);
      } catch {
        /* transient — the next tick retries */
      }
    };
    timer = setInterval(() => void tick(), 5000);
    const onVis = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [campaignId]);

  return (
    <>
      <div className="sb-sec-label">
        Settled payouts
        {data.verifying > 0 && (
          <span
            className="mono"
            style={{ marginLeft: 8, fontSize: 11, color: "var(--accent)" }}
          >
            <Loader2
              size={11}
              className="sage-spin2"
              style={{ verticalAlign: "-1px", marginRight: 4 }}
            />
            {data.verifying} being verified now
          </span>
        )}
      </div>
      <div className="sage-subs" style={{ marginBottom: 20 }}>
        {data.feed.length > 0 ? (
          data.feed.map((s) => (
            <div className="sage-sub" key={s.payoutTx}>
              <div className="sage-sub-main">
                <div className="sage-sub-wallet">
                  <Check size={14} color="var(--pos)" />
                  <span className="mono">{short(s.wallet)}</span>
                </div>
                <a className="sage-sub-link" href={`/proof/${s.payoutTx}`}>
                  <ArrowUpRight size={13} /> View on-chain proof
                </a>
              </div>
              <div className="sage-sub-side">
                <span className="mono" style={{ fontWeight: 700, color: "var(--pos)" }}>
                  {usd(rewardUsd)}
                </span>
              </div>
            </div>
          ))
        ) : (
          <div className="sage-empty">
            {data.verifying > 0
              ? "Verifying the first entries now — payouts appear here live."
              : "Be the first — payouts are real and on-chain."}
          </div>
        )}
      </div>
    </>
  );
}
