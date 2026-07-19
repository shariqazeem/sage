"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Clock,
  Eye,
  Minus,
  Quote,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { short, usd } from "@/lib/format";
import type { DecisionBrief } from "@/lib/deputy/brain-core";

const GOAT_EXPLORER = "https://explorer.goat.network";

/** The machine-state verdict word + its tone. */
const VERDICT: Record<
  DecisionBrief["recommendation"],
  { word: string; tone: "pos" | "amber" | "dan" }
> = {
  pay: { word: "PAY", tone: "pos" },
  review: { word: "REVIEW", tone: "amber" },
  hold: { word: "HOLD", tone: "dan" },
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const trunc = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The high-severity injection signal, if the server-side detector fired. */
function injectionSignal(brief: DecisionBrief) {
  return brief.fraudSignals.find(
    (f) => f.severity === "high" && /injection/i.test(f.signal),
  );
}
/** The pattern families the detector named, parsed from its reason ("(a, b)"). */
function patternFamilies(reason: string): string | null {
  return reason.match(/\(([^)]+)\)/)?.[1] ?? null;
}
/** sha256 as first8…last8 for the provenance line. */
function shaShort(sha: string | null): string {
  return sha && sha.length > 18 ? `${sha.slice(0, 8)}…${sha.slice(-8)}` : "no evidence";
}

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
  threshold = 0.85,
  materialize = false,
}: {
  brief: DecisionBrief;
  rewardUsd?: number | null;
  /** the campaign's autopilot threshold — draws the notch on the confidence bar. */
  threshold?: number;
  /** when the brief just ARRIVED via polling, play the "print in" animation once. */
  materialize?: boolean;
}) {
  const v = VERDICT[brief.recommendation];
  const conf = Math.round(clamp01(brief.confidence) * 100);
  const thr = Math.round(clamp01(threshold) * 100);
  const met = brief.criteria.filter((c) => c.met).length;
  const clears = conf >= thr;

  // ATTACK: only the server-side injection detector's HIGH signal gets the strip.
  const attack = injectionSignal(brief);
  const families = attack ? patternFamilies(attack.reason) : null;
  const chips = attack
    ? brief.fraudSignals.filter((f) => f !== attack)
    : brief.fraudSignals;

  return (
    <div className={`sage-assess${materialize ? " sage-materialize" : ""}`}>
      {attack && (
        <div className="sage-attack-strip">
          <ShieldAlert size={14} />
          <span>
            <b>Attack detected</b> — instruction-like content in submitter data
            {families ? ` (${families})` : ""}. Treated as data, not instructions. Held.
          </span>
        </div>
      )}

      <div className="sage-assess-head">
        <span className="sage-assess-title">
          <Sparkles size={13} /> Sage assessment
        </span>
        <span className={`sage-assess-rec ${v.tone}`}>{v.word}</span>
      </div>

      <span className={`sage-assess-engine ${brief.engine}`}>
        <span className="dot" />
        {brief.engine === "llm"
          ? `Sage · ${brief.model ?? "llm"}`
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

      {chips.length > 0 && (
        <div className="sage-assess-fraud">
          {chips.map((f, i) => (
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
          <i
            className="sage-assess-notch"
            style={{ left: `${thr}%` }}
            aria-hidden
          />
        </div>
        <span className="sage-assess-conf-k mono">{conf}%</span>
      </div>
      <div className={`sage-assess-thresh mono ${clears ? "pass" : "hold"}`}>
        {clears
          ? `${conf}% ≥ ${thr}% autopay bar`
          : `${conf}% < ${thr}% — held for human review`}
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

      {/* provenance microline — model · latency · cost · reasonCode · evidence hash */}
      <div className="sage-assess-prov mono">
        {brief.engine === "llm" ? (brief.model ?? "llm") : "heuristic v1"}
        {brief.latencyMs != null && (
          <>
            <span className="sep">·</span>
            {brief.latencyMs}ms
          </>
        )}
        {brief.costUsd != null && (
          <>
            <span className="sep">·</span>${brief.costUsd.toFixed(4)}
          </>
        )}
        <span className="sep">·</span>
        {brief.reasonCode}
        <span className="sep">·</span>
        {brief.contentSha256 ? `sha256 ${shaShort(brief.contentSha256)}` : "no evidence"}
      </div>
    </div>
  );
}

/** The leak-safe OBSERVATION verdict — counts + the corpus digest only, never a matched string. Mirrors
 *  the server ObservationShadow's publishable face. */
export interface ObservationVerdict {
  distinctSources: number;
  matchedCount: number;
  keyDistinctSources: number;
  corpusDigest: string;
  barPass: boolean;
  barReasons: string[];
}

/**
 * The OBSERVATION assessment panel — Sage judged the account against its OWN private field test, not the
 * url-verifiable brain. THE panel an observation mission must render on every surface (tester board,
 * founder console, proof) so a blank evidence link never surfaces as "missing evidence" or "fraud".
 * Leak-safe by construction: counts + the corpus digest only, never a matched string.
 */
export function ObservationVerdictCard({ v, materialize = false }: { v: ObservationVerdict; materialize?: boolean }) {
  const digest = v.corpusDigest && v.corpusDigest.length > 16 ? `${v.corpusDigest.slice(0, 8)}…${v.corpusDigest.slice(-6)}` : v.corpusDigest;
  return (
    <div className={`sage-assess${materialize ? " sage-materialize" : ""}`}>
      <div className="sage-assess-head">
        <span className="sage-assess-title">
          <Sparkles size={13} /> Sage assessment · judged against its own eyes
        </span>
        <span className={`sage-assess-rec ${v.barPass ? "pos" : "amber"}`}>{v.barPass ? "MATCH" : "HOLD"}</span>
      </div>
      <p style={{ fontSize: 13.5, margin: "10px 0 2px", lineHeight: 1.5 }}>
        <Eye size={13} style={{ verticalAlign: "-2px", marginRight: 5, color: "var(--accent)" }} />
        Matched <b>{v.distinctSources}</b> of the <b>{v.keyDistinctSources}</b> distinct things Sage saw when it explored the product
        itself — specifics a copy of the mission card could not contain.
      </p>
      <div className="sage-assess-prov mono">
        matched <b>{v.matchedCount}</b>
        <span className="sep">·</span>distinct <b>{v.distinctSources}/{v.keyDistinctSources}</b>
        <span className="sep">·</span>corpus digest {digest}
      </div>
    </div>
  );
}
