import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Inbox, Lock, ShieldCheck, X } from "lucide-react";
import { reward as fmtReward, short, since } from "@/lib/format";
import type { FounderDesk } from "@/lib/campaigns/founder-activity";

/**
 * SAGE AT WORK — the agent's own timeline. Every row is a real event the pipeline recorded
 * (received, verified, paid, held, blocked) with its campaign and, for a payout, its receipt.
 * The same safe activity projection the boards read; nothing is invented here.
 */
export function SageAtWork({ desk, limit = 6 }: { desk: FounderDesk; limit?: number }) {
  const rows = desk.events.slice(0, limit);
  if (rows.length === 0) return null;
  return (
    <ol className="ws-tl">
      {rows.map((a, i) => {
        const tone = a.kind === "paid" ? "pos" : a.kind === "verified" ? "accent" : a.kind === "held" ? "warn" : a.kind === "blocked" ? "dan" : "";
        return (
          <li key={`${a.campaignId}:${a.id}`} className={`ws-tl-row${tone ? ` ${tone}` : ""}`}>
            <span className="ws-tl-ic">
              {a.kind === "received" ? <Inbox size={13} /> : a.kind === "verified" ? <ShieldCheck size={13} /> : a.kind === "paid" ? <CheckCircle2 size={13} /> : a.kind === "held" ? <Lock size={13} /> : <X size={13} />}
            </span>
            <div>
              <p className="ws-tl-t">
                {a.kind === "received" && "New submission received"}
                {a.kind === "verified" && (a.confidencePct != null ? `Verified · ${a.confidencePct}% confidence` : "Evidence verified")}
                {a.kind === "paid" && (
                  <>
                    Paid <span className="mono">{a.amountBase != null ? fmtReward(a.amountBase, 2345) : "reward"}</span>
                    {a.wallet ? <> to <span className="mono">{short(a.wallet)}</span></> : null}
                  </>
                )}
                {a.kind === "held" && (a.reasonClass ? `Held for review · ${a.reasonClass}` : "Held for review")}
                {a.kind === "blocked" && `Blocked · ${a.reasonClass ?? "integrity check"}`}
              </p>
              <p className="ws-tl-m">{a.campaignTitle}</p>
            </div>
            <span className="ws-tl-side">
              {a.kind === "paid" && a.txHash ? (
                <Link href={`/proof/${a.txHash}`}>receipt <ArrowUpRight size={11} /></Link>
              ) : i === 0 && desk.lastWorkedAt ? (
                <span className="ws-tl-live">live</span>
              ) : (
                since(a.at)
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
