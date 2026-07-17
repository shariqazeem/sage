"use client";

import { useState } from "react";
import { Check, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { HoldButton } from "@/components/app/hold-button";

const pct = (n: number) => `${Math.round(Math.max(0, Math.min(1, n)) * 100)}%`;
const clamp = (n: number) => Math.max(0.5, Math.min(0.99, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The standing-mandate card — the "confirm policy once" surface. Manual keeps the
 * human in the loop on every payout; Autopilot lets the Deputy pay submissions its
 * AI brain verifies, inside the SAME on-chain limits the vault enforces. Turning
 * autopilot ON is a deliberate press-and-hold; turning it OFF is a plain click.
 */
export function AutopilotCard({
  autonomy,
  threshold,
  onChange,
  busy,
}: {
  autonomy: "manual" | "autopilot";
  threshold: number;
  onChange: (next: { autonomy: "manual" | "autopilot"; threshold: number }) => void;
  busy?: boolean;
}) {
  const [pendingEnable, setPendingEnable] = useState(false);
  const isAuto = autonomy === "autopilot";
  const thrPct = Math.round(Math.max(0, Math.min(1, threshold)) * 100);

  return (
    <div className={`sage-auto${isAuto ? " on" : ""}`}>
      <div className="sage-auto-head">
        <span className="sage-auto-title">
          <Sparkles size={13} /> Standing mandate
        </span>
        <span className={`sage-auto-state${isAuto ? " on" : ""}`}>
          {isAuto ? "Autopilot" : "Manual"}
        </span>
      </div>

      <div className="sage-auto-opts">
        <button
          type="button"
          className={`sage-auto-opt${!isAuto ? " on" : ""}`}
          disabled={busy}
          onClick={() => {
            setPendingEnable(false);
            if (isAuto) onChange({ autonomy: "manual", threshold });
          }}
        >
          <span className="sage-auto-opt-top">
            <ShieldCheck size={15} /> Manual review
            {!isAuto && <Check className="tick" size={14} />}
          </span>
          <span className="sage-auto-opt-p">
            You confirm every payout. Sage verifies and recommends; you click
            Approve &amp; pay.
          </span>
        </button>

        <button
          type="button"
          className={`sage-auto-opt${isAuto ? " on" : ""}`}
          disabled={busy}
          onClick={() => {
            if (!isAuto) setPendingEnable(true);
          }}
        >
          <span className="sage-auto-opt-top">
            <Sparkles size={15} /> Autopilot
            {isAuto && <Check className="tick" size={14} />}
          </span>
          <span className="sage-auto-opt-p">
            Configure the mandate once. Sage pays verified work on its own.
            Every spend still passes the vault&apos;s on-chain checks it cannot
            change — and can never pay for the same work twice.
          </span>
        </button>
      </div>

      {isAuto && (
        <div className="sage-auto-thresh">
          <div className="sage-auto-thresh-row">
            <span>Pays when AI confidence is</span>
            <div className="sage-auto-stepper">
              <button
                type="button"
                disabled={busy}
                onClick={() => onChange({ autonomy, threshold: clamp(round2(threshold - 0.05)) })}
                aria-label="lower threshold"
              >
                −
              </button>
              <span className="mono">≥ {pct(threshold)}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => onChange({ autonomy, threshold: clamp(round2(threshold + 0.05)) })}
                aria-label="raise threshold"
              >
                +
              </button>
            </div>
          </div>
          {/* the autopay bar, visualized — reuses the receipt's notch so the
              threshold reads the same everywhere the Deputy is judged. */}
          <div
            className="sage-assess-conf-bar"
            style={{ margin: "12px 0 2px" }}
            aria-hidden
          >
            <span style={{ width: `${thrPct}%`, opacity: 0.35 }} />
            <i className="sage-assess-notch" style={{ left: `${thrPct}%` }} />
          </div>
          <p className="sage-auto-note">
            Only Sage&apos;s AI brain can auto-pay. Without an AI key — or when it
            can&apos;t verify a submission — autopilot holds it for you. Nothing is
            ever simulated, and the vault still enforces every limit on-chain.
          </p>
        </div>
      )}

      {pendingEnable && !isAuto && (
        <div className="sage-auto-confirm">
          <HoldButton
            className="sage-auto-hold"
            durationMs={1400}
            label={
              <>
                <Lock size={14} /> Hold to enable autopilot
              </>
            }
            onComplete={() => {
              setPendingEnable(false);
              onChange({ autonomy: "autopilot", threshold });
            }}
          />
          <button
            type="button"
            className="sage-auto-cancel"
            onClick={() => setPendingEnable(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
