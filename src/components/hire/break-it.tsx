"use client";

import { useEffect, useState } from "react";
import {
  CircleCheck,
  Ban,
  ArrowUpRight,
  Loader2,
  Lock,
  ShieldAlert,
} from "lucide-react";
import { getAddress } from "viem";
import { usd } from "@/lib/format";
import { CHECK_NAMES, CHECK_REASONS } from "@/lib/deputy/reasons";
import { readVaultState } from "@/lib/wallet/read-vault";
import { HoldButton } from "@/components/app/hold-button";
import { BudgetRing } from "@/components/app/budget-ring";

interface Network {
  name: string;
  chainId: number;
  explorer: string;
}

interface Outcome {
  ok: boolean;
  head: string;
  body: string;
  href?: string;
}

async function postJson(
  url: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error as string) ?? `Request failed (${res.status})`);
  return data;
}

/** The generic approved-spend action (unchanged behavior). */
function BreakAction({
  title,
  desc,
  button,
  run,
}: {
  title: string;
  desc: string;
  button: string;
  run: () => Promise<Outcome>;
}) {
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function go() {
    if (loading) return;
    setLoading(true);
    setOutcome(null);
    try {
      setOutcome(await run());
    } catch (e) {
      setOutcome({
        ok: false,
        head: "Couldn't reach the chain",
        body: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="hbreak-card">
      <div className="hbreak-title">{title}</div>
      <div className="hbreak-desc">{desc}</div>
      <button className="hbtn hbtn-secondary hbtn-sm" onClick={go} disabled={loading}>
        {loading ? (
          <>
            <Loader2 size={14} className="hspin" /> Submitting on-chain…
          </>
        ) : (
          button
        )}
      </button>
      {outcome && (
        <div className={`hbreak-result ${outcome.ok ? "pos" : "dan"}`}>
          <div className="head">
            {outcome.ok ? <CircleCheck size={15} /> : <Ban size={15} />}
            {outcome.head}
          </div>
          {outcome.body}
          {outcome.href && (
            <>
              {" "}
              <a href={outcome.href} target="_blank" rel="noopener noreferrer">
                View on explorer <ArrowUpRight size={11} style={{ verticalAlign: "-1px" }} />
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * MOMENT 2 — THE BLOCK. A spend just over the per-tx cap is a REAL on-chain
 * SpendRejected. On rejection the card slams into a barrier state: a red border
 * draws clockwise, the exact failed check (from reasons.ts, keyed by the real
 * failedCheckIndex) stamps in like a seal, and the balance shakes but does NOT
 * move — because no funds moved. Everything here is bound to the /api/spend result.
 */
function BlockDemo({ balance }: { balance: number }) {
  const [state, setState] = useState<"idle" | "loading" | "settled" | "blocked">(
    "idle",
  );
  const [reason, setReason] = useState<{ idx: number; name: string; text: string } | null>(
    null,
  );
  const [amount, setAmount] = useState("");
  const [href, setHref] = useState<string | undefined>();
  const [shake, setShake] = useState(false);

  async function run() {
    if (state === "loading") return;
    setState("loading");
    setReason(null);
    try {
      const d = await postJson("/api/spend", { scenario: "rejected" });
      setAmount(String(d.amount ?? ""));
      setHref(typeof d.explorerUrl === "string" ? d.explorerUrl : undefined);
      if (d.ok) {
        setState("settled");
        return;
      }
      const idx = Number(d.failedCheckIndex ?? 4);
      setReason({
        idx,
        name: CHECK_NAMES[idx] ?? "Policy check",
        text: CHECK_REASONS[idx] ?? "a policy check failed",
      });
      setState("blocked");
      // the balance shakes but never changes — no funds moved.
      setShake(true);
      window.setTimeout(() => setShake(false), 220);
    } catch (e) {
      setReason({
        idx: 0,
        name: "Chain error",
        text: e instanceof Error ? e.message : "please try again",
      });
      setState("blocked");
    }
  }

  const blocked = state === "blocked";
  return (
    <div className={`hbreak-card sage-block-card${blocked ? " blocked" : ""}`}>
      {blocked && (
        <svg
          className="sage-block-border"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          <rect x="0.6" y="0.6" width="98.8" height="98.8" rx="2" ry="2" pathLength={100} />
        </svg>
      )}
      <div className="hbreak-title">Try to overspend</div>
      <div className="hbreak-desc">
        A payment just over the per-transaction cap. Watch the vault refuse it — the
        funds never move.
      </div>

      <div className="sage-block-balance">
        <span className="k mono">Vault balance</span>
        <span className={`v mono${shake ? " shake" : ""}`}>{usd(balance)}</span>
        {blocked && (
          <span className="sage-block-steady mono">unchanged · no funds moved</span>
        )}
      </div>

      <button
        className="hbtn hbtn-secondary hbtn-sm"
        onClick={() => void run()}
        disabled={state === "loading"}
      >
        {state === "loading" ? (
          <>
            <Loader2 size={14} className="hspin" /> Submitting on-chain…
          </>
        ) : (
          "Try to overspend"
        )}
      </button>

      {blocked && reason && (
        <div className="sage-block-seal">
          <span className="sage-block-seal-ico">
            <Ban size={16} strokeWidth={2.2} />
          </span>
          <div className="sage-block-seal-body">
            <div className="sage-block-seal-head mono">
              BLOCKED · check {reason.idx} — {reason.name}
            </div>
            <div className="sage-block-seal-text">
              {reason.text}. No funds moved.
            </div>
            {href && (
              <a
                className="sage-block-seal-link"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                On-chain proof <ArrowUpRight size={11} style={{ verticalAlign: "-1px" }} />
              </a>
            )}
          </div>
        </div>
      )}
      {state === "settled" && (
        <div className="hbreak-result pos">
          <div className="head">
            <CircleCheck size={15} /> Settled — {amount}
          </div>
          Within policy this time; funds moved.
          {href && (
            <>
              {" "}
              <a href={href} target="_blank" rel="noopener noreferrer">
                explorer <ArrowUpRight size={11} style={{ verticalAlign: "-1px" }} />
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * MOMENT 4 — REVOKE. Terminal weight, funereal restraint. A confirm sheet slides
 * up (overlay elevation); the confirm requires a press-and-hold. On the REAL
 * revoke (POST /api/kill), the disposable-vault card desaturates to grayscale, its
 * ring drains to zero, and a red "REVOKED · permanent" stamp appears. No celebration.
 */
function RevokeDemo() {
  const killAddr = process.env.NEXT_PUBLIC_KILL_VAULT_ADDRESS as string | undefined;
  const [vault, setVault] = useState<{ budget: number; remaining: number } | null>(
    null,
  );
  const [sheet, setSheet] = useState(false);
  const [state, setState] = useState<"idle" | "revoking" | "revoked" | "error">(
    "idle",
  );
  const [err, setErr] = useState<string | null>(null);
  const [href, setHref] = useState<string | undefined>();

  useEffect(() => {
    if (!killAddr) return;
    let cancelled = false;
    void readVaultState(getAddress(killAddr)).then((v) => {
      if (cancelled || !v) return;
      setVault({ budget: v.budget, remaining: v.remaining });
      if (v.status === "revoked") setState("revoked");
    });
    return () => {
      cancelled = true;
    };
  }, [killAddr]);

  async function revoke() {
    setState("revoking");
    setErr(null);
    try {
      const d = await postJson("/api/kill");
      setHref(typeof d.explorerUrl === "string" ? d.explorerUrl : undefined);
      setState("revoked");
      setSheet(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Revoke failed.");
      setState("error");
    }
  }

  const revoked = state === "revoked";
  const budget = vault?.budget ?? 5000;
  const remaining = revoked ? 0 : (vault?.remaining ?? budget);

  return (
    <div className={`hbreak-card sage-revoke-card${revoked ? " revoked" : ""}`}>
      <div className="hbreak-title">Pull the kill switch</div>
      <div className="hbreak-desc">
        Revoke the operator on a disposable demo vault — never the live one. After
        this, every spend fails at the state check.
      </div>

      <div className="sage-revoke-visual">
        <div className="sage-revoke-vault">
          <BudgetRing
            remaining={remaining}
            budget={budget}
            size={116}
            danger={revoked}
            label={revoked ? "terminal" : "disposable vault"}
          />
        </div>
        {revoked && <div className="sage-revoke-stamp mono">REVOKED · permanent</div>}
      </div>

      {revoked ? (
        <div className="sage-revoke-done mono">
          Operator revoked · vault terminal.
          {href && (
            <>
              {" "}
              <a href={href} target="_blank" rel="noopener noreferrer">
                on-chain proof <ArrowUpRight size={11} style={{ verticalAlign: "-1px" }} />
              </a>
            </>
          )}
        </div>
      ) : (
        <button
          className="hbtn hbtn-secondary hbtn-sm"
          onClick={() => setSheet(true)}
          disabled={state === "revoking"}
        >
          Revoke (demo vault)
        </button>
      )}

      {sheet && !revoked && (
        <div
          className="sage-sheet-overlay"
          onClick={() => state !== "revoking" && setSheet(false)}
        >
          <div className="sage-sheet" onClick={(e) => e.stopPropagation()}>
            <span className="sage-sheet-ico">
              <ShieldAlert size={22} strokeWidth={1.9} />
            </span>
            <div className="sage-sheet-h">Revoke the operator?</div>
            <div className="sage-sheet-p">
              This is terminal. The disposable vault becomes permanently unusable —
              no spend will ever settle again. It cannot be undone.
            </div>
            {state === "revoking" ? (
              <div className="sage-sheet-working mono">
                <Loader2 size={14} className="hspin" /> Revoking on-chain…
              </div>
            ) : (
              <HoldButton
                className="sage-revoke-hold"
                label={
                  <>
                    <Lock size={15} /> Hold to revoke
                  </>
                }
                onComplete={() => void revoke()}
              />
            )}
            {err && <div className="sage-sheet-err">{err}</div>}
            {state !== "revoking" && (
              <button className="sage-sheet-cancel" onClick={() => setSheet(false)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function BreakIt({
  remaining,
}: {
  remaining: number;
  network: Network;
}) {
  return (
    <>
      <div className="hbreak">
        <BreakAction
          title="Approve a real spend"
          desc="A $5 payment to a vendor on the allowlist — within budget and caps, so the mandate lets it settle on-chain."
          button="Run approved spend"
          run={async () => {
            const d = await postJson("/api/spend", { scenario: "approved" });
            const amount = String(d.amount ?? "");
            const href = typeof d.explorerUrl === "string" ? d.explorerUrl : undefined;
            return d.ok
              ? {
                  ok: true,
                  head: `Settled — ${amount} to ${String(d.vendor ?? "")}`,
                  body: "Passed every policy check; the funds moved on-chain.",
                  href,
                }
              : {
                  ok: false,
                  head: `Rejected on-chain — ${amount}`,
                  body: `Blocked at policy check ${String(d.failedCheckIndex ?? "")} (likely the daily velocity cap). No funds moved.`,
                  href,
                };
          }}
        />
        <BlockDemo balance={remaining} />
        <RevokeDemo />
      </div>
      <div className="hbreak-note">
        <Lock size={16} style={{ flex: "none", marginTop: 1, color: "var(--accent)" }} />
        <span>
          The rejection is not a frontend simulation. It is an on-chain policy
          decision — every result here is a real transaction on Metis Sepolia,
          verifiable on the explorer. The kill switch only ever revokes a
          disposable demo vault, never the live operator.
        </span>
      </div>
    </>
  );
}
