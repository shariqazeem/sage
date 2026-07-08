"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Clock,
  Minus,
  Quote,
  Sparkles,
} from "lucide-react";
import { short, usd } from "@/lib/format";
import type { DecisionBrief } from "@/lib/deputy/brain-core";

const GOAT_EXPLORER = "https://explorer.goat.network";

const REC: Record<
  DecisionBrief["recommendation"],
  { label: string; tone: "pos" | "amber" | "dan" }
> = {
  pay: { label: "Recommends paying", tone: "pos" },
  review: { label: "Needs a closer look", tone: "amber" },
  hold: { label: "Recommends holding", tone: "dan" },
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const trunc = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * The Deputy's verification receipt for one submission — the reasoning the
 * reviewer sees BEFORE they confirm. Renders the LLM brief when present and the
 * heuristic fallback otherwise; the engine badge is ALWAYS visible so there are
 * no hidden fallbacks. The payout shown is campaign config, never the model's —
 * the brain judges eligibility, the vault decides money. Advisory: the human
 * still clicks Approve & pay.
 */
export function DeputyAssessmentCard({
  brief,
  rewardUsd,
}: {
  brief: DecisionBrief;
  rewardUsd?: number | null;
}) {
  const rec = REC[brief.recommendation];
  const conf = Math.round(clamp01(brief.confidence) * 100);
  const met = brief.criteria.filter((c) => c.met).length;

  return (
    <div className="sage-assess">
      <div className="sage-assess-head">
        <span className="sage-assess-title">
          <Sparkles size={13} /> Deputy assessment
        </span>
        <span className={`sage-assess-rec ${rec.tone}`}>{rec.label}</span>
      </div>

      <span className={`sage-assess-engine ${brief.engine}`}>
        <span className="dot" />
        {brief.engine === "llm"
          ? `Deputy AI · ${brief.model ?? "llm"}`
          : "Heuristic v1 · LLM pending"}
      </span>

      {brief.criteria.length > 0 && (
        <div className="sage-assess-crit">
          {brief.criteria.map((c, i) => (
            <div key={i} className={`sage-assess-line ${c.met ? "met" : "unmet"}`}>
              {c.met ? <Check size={13} /> : <Minus size={13} />}
              <div className="sage-assess-line-body">
                <span>{c.criterion}</span>
                {c.quote && (
                  <span className="sage-assess-quote mono">
                    <Quote size={10} /> “{trunc(c.quote)}”
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {brief.fraudSignals.length > 0 && (
        <div className="sage-assess-fraud">
          {brief.fraudSignals.map((f, i) => (
            <span
              key={i}
              className={`sage-assess-chip ${f.severity}`}
              title={f.reason}
            >
              <AlertTriangle size={11} /> {f.signal}
            </span>
          ))}
        </div>
      )}

      <div className="sage-assess-conf">
        <div className="sage-assess-conf-bar">
          <span style={{ width: `${conf}%` }} />
        </div>
        <span className="sage-assess-conf-k mono">{conf}% confidence</span>
      </div>

      {brief.summary && <p className="sage-assess-summary">{brief.summary}</p>}

      {/* RAIL 1 — the x402 verification payment (real GOAT tx or honest pending) */}
      {brief.x402PaymentTx ? (
        <a
          className="sage-x402-chip paid"
          href={`${GOAT_EXPLORER}/tx/${brief.x402PaymentTx}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <BadgeCheck size={11} /> Verification paid · 0.1 USDC ·{" "}
          <span className="mono">{short(brief.x402PaymentTx)}</span>
        </a>
      ) : (
        <span className="sage-x402-chip pending">
          <Clock size={11} /> x402 pending merchant approval
        </span>
      )}

      <div className="sage-assess-signals mono">
        <span>
          criteria{" "}
          <b>
            {met}/{brief.criteria.length}
          </b>
        </span>
        <span>
          evidence <b>{brief.evidenceOk ? "fetched" : "unavailable"}</b>
        </span>
        {rewardUsd != null && (
          <span>
            payout <b>{usd(rewardUsd)}</b>{" "}
            <span className="sage-assess-cfg">config</span>
          </span>
        )}
        {brief.costUsd != null && (
          <span>
            cost <b>${brief.costUsd.toFixed(4)}</b>
          </span>
        )}
      </div>
    </div>
  );
}
