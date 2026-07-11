"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Clock,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Sparkles,
  Wallet,
  XCircle,
} from "lucide-react";
import { getAddress, type Address } from "viem";
import { short, since, usd } from "@/lib/format";
import { useWallet } from "@/lib/wallet/use-wallet";
import {
  allowlistRecipients,
  executeReady,
  type VendorProgress,
} from "@/lib/wallet/vendor-add";
import { formatCountdown } from "@/lib/wallet/allowlist-state";
import type { DecisionBrief } from "@/lib/deputy/brain-core";
import {
  shouldKeepPolling,
  briefFingerprint,
  type PollSub,
} from "@/lib/campaigns/live-poll";
import { CopyButton } from "@/components/hire/copy-button";
import { StatusBadge } from "./submit-panel";
import { DeputyAssessmentCard } from "./deputy-assessment";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export interface ReviewSubmission {
  id: string;
  wallet: string;
  evidenceUrl: string | null;
  note: string | null;
  status: string;
  payoutTx: string | null;
  rejectReason: string | null;
  createdAt: number;
  brief?: DecisionBrief | null;
  /** the latest autonomous outcome for this submission, if any. */
  autopay?: { state: "settled" | "held"; reason: string | null; at: number } | null;
}

/** Project a submission to the minimal shape the pure poll logic reasons about. */
const toPoll = (s: ReviewSubmission): PollSub => ({
  id: s.id,
  status: s.status,
  hasBrief: !!s.brief,
  briefFingerprint: briefFingerprint(s.brief),
  autopayState: s.autopay?.state ?? null,
  payoutTx: s.payoutTx,
});

/** Per-submission flow phase — the honest, guided motion from approve to paid. */
type Phase =
  | "idle"
  | "deciding"
  | "allowlisting"
  | "waiting"
  | "settling"
  | "paid"
  | "blocked"
  | "error"
  | "needs_wallet";

interface Flow {
  phase: Phase;
  msg?: string;
  readyAt?: number;
  proofUrl?: string;
  reason?: string;
  /** true when this "paid" state arrived via the autonomous Deputy — plays the cascade entrance. */
  cascade?: boolean;
}

interface DecideResponse {
  ok?: boolean;
  error?: string;
  status?: string;
  settled?: boolean;
  txHash?: string | null;
  reason?: string | null;
  needsOwnerAdd?: boolean;
  proofUrl?: string | null;
  vault?: { remaining: number } | null;
}

function progressMsg(p: VendorProgress): string {
  switch (p.phase) {
    case "checking": return "Checking the allowlist…";
    case "queuing": return "Sign to queue the recipient…";
    case "waiting": return "Queued — inside the timelock.";
    case "executing": return "Sign to finalize the recipient…";
    case "approved": return "Recipient allowlisted.";
    case "failed": return p.error ?? "Allowlisting failed.";
  }
}

/**
 * The poster's review queue. On a Sage-owned vault "Approve & pay" settles in one
 * click. On the poster's OWN vault the vault only pays pre-approved recipients
 * (the security model), so approve opens an inline, owner-signed allowlist step —
 * with a timelock countdown when the vault has one — then settles automatically.
 * Every state here is the server's on-chain truth.
 */
export function ReviewPanel({
  campaignId,
  vaultAddress,
  initial,
  remaining,
  rewardUsd = null,
  autonomy = "manual",
  threshold = 0.85,
  onRemaining,
}: {
  campaignId: string;
  vaultAddress: string;
  initial: ReviewSubmission[];
  remaining: number | null;
  /** per-payout reward in whole USDC — the amount that CountUps on settle. */
  rewardUsd?: number | null;
  /** the campaign's mandate — autopilot campaigns keep polling for the Deputy's own settles. */
  autonomy?: "manual" | "autopilot";
  /** the autopilot confidence threshold — drives the receipt's notch. */
  threshold?: number;
  /** lifts the new vault remaining to the parent so its ring can pulse. */
  onRemaining?: (remaining: number) => void;
}) {
  const wallet = useWallet();
  const [subs, setSubs] = useState<ReviewSubmission[]>(initial);
  const [left, setLeft] = useState<number | null>(remaining);
  const [flows, setFlows] = useState<Record<string, Flow>>({});
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [batchBusy, setBatchBusy] = useState(false);
  // Live feed: ids whose receipt should play the "materialize" animation once,
  // because a real/upgraded brief just arrived via polling.
  const [materializeIds, setMaterializeIds] = useState<Set<string>>(() => new Set());

  const vault = getAddress(vaultAddress);
  const setFlow = useCallback(
    (id: string, f: Flow) => setFlows((p) => ({ ...p, [id]: f })),
    [],
  );

  // latest-value refs so the poll loop reads current state without re-subscribing
  const subsRef = useRef(subs);
  subsRef.current = subs;
  const flowsRef = useRef(flows);
  flowsRef.current = flows;
  const leftRef = useRef(left);
  leftRef.current = left;
  const lastVersion = useRef<string | null>(null);

  // Tick once a second while any recipient is inside its timelock, so the
  // countdown is live (and offer "Finish payout" the instant it matures).
  const anyWaiting = Object.values(flows).some((f) => f.phase === "waiting");
  useEffect(() => {
    if (!anyWaiting) return;
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [anyWaiting]);

  const patch = (id: string, next: Partial<ReviewSubmission>) =>
    setSubs((p) => p.map((s) => (s.id === id ? { ...s, ...next } : s)));

  /**
   * LIVE FEED — merge a light poll snapshot into the queue. Never clobbers a row
   * the poster is actively driving; only absorbs server truth for idle rows. Fires
   * the receipt "materialize" when a real/upgraded brief lands, and drives the
   * SettleRail cascade + ring drain when the autonomous Deputy settles a row.
   */
  const applyPoll = useCallback(
    (incoming: ReviewSubmission[]) => {
      const cur = subsRef.current;
      const curFlows = flowsRef.current;
      const known = new Set(cur.map((s) => s.id));
      const mat = new Set<string>();
      const settled: { id: string; tx: string }[] = [];

      const absorb = (existing: ReviewSubmission, inc: ReviewSubmission) => {
        const phase = curFlows[existing.id]?.phase;
        const manualOwned =
          phase === "deciding" ||
          phase === "allowlisting" ||
          phase === "waiting" ||
          phase === "settling" ||
          phase === "paid" ||
          phase === "blocked";
        if (
          inc.status === "pending" &&
          inc.brief &&
          briefFingerprint(inc.brief) !== briefFingerprint(existing.brief)
        ) {
          mat.add(existing.id);
        }
        if (
          inc.status === "paid" &&
          inc.payoutTx &&
          inc.autopay?.state === "settled" &&
          existing.status !== "paid" &&
          phase !== "paid"
        ) {
          settled.push({ id: existing.id, tx: inc.payoutTx });
        }
        // the poster's click owns this row while a manual flow runs; only fill a
        // missing brief, never move its status out from under the flow.
        if (manualOwned) {
          return existing.brief ? existing : { ...existing, brief: inc.brief ?? null };
        }
        return {
          ...existing,
          status: inc.status,
          payoutTx: inc.payoutTx ?? existing.payoutTx,
          rejectReason: inc.rejectReason ?? existing.rejectReason,
          brief: inc.brief ?? existing.brief,
          autopay: inc.autopay ?? existing.autopay,
        };
      };

      const incById = new Map(incoming.map((i) => [i.id, i]));
      const merged = cur.map((s) => {
        const inc = incById.get(s.id);
        return inc ? absorb(s, inc) : s;
      });
      // submissions that appeared while the poster was watching
      for (const inc of incoming) {
        if (known.has(inc.id)) continue;
        merged.push(inc);
        if (inc.status === "pending" && inc.brief) mat.add(inc.id);
        if (inc.status === "paid" && inc.payoutTx && inc.autopay?.state === "settled")
          settled.push({ id: inc.id, tx: inc.payoutTx });
      }

      setSubs(merged);
      if (mat.size) setMaterializeIds((p) => new Set([...p, ...mat]));
      // the autonomous payout plays the SAME cascade as a manual approval
      for (const { id, tx } of settled) {
        setFlow(id, { phase: "paid", proofUrl: `/proof/${tx}`, cascade: true });
      }
      if (settled.length && rewardUsd != null) {
        const next = Math.max(0, (leftRef.current ?? 0) - settled.length * rewardUsd);
        setLeft(next);
        onRemaining?.(next);
      }
    },
    [rewardUsd, onRemaining, setFlow],
  );

  // Poll the LIGHT endpoint while the Deputy still has async work to show. Cheap
  // (no reconciler / no vault read), version-gated (unchanged payload = no-op),
  // paused when the tab is hidden, and cleared on unmount.
  const pollActive = shouldKeepPolling(subs.map(toPoll), autonomy);
  useEffect(() => {
    if (!pollActive) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch(`/api/campaigns/${campaignId}?light=1`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          version?: string;
          submissions?: ReviewSubmission[];
        };
        if (!json.submissions) return;
        if (json.version && json.version === lastVersion.current) return; // no-op
        lastVersion.current = json.version ?? null;
        applyPoll(json.submissions);
      } catch {
        /* transient — the next tick retries */
      }
    };
    const start = () => {
      if (!timer) timer = setInterval(() => void tick(), 2500);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVis = () => {
      if (document.hidden) stop();
      else {
        void tick(); // catch up immediately on return, then resume
        start();
      }
    };
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pollActive, campaignId, applyPoll]);

  const callDecide = async (id: string, decision: "approve" | "reject") => {
    const res = await fetch(`/api/campaigns/${campaignId}/submissions/${id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    return { res, body: (await res.json()) as DecideResponse };
  };

  const callSettle = async (id: string) => {
    const res = await fetch(`/api/campaigns/${campaignId}/submissions/${id}/settle`, {
      method: "POST",
    });
    return { res, body: (await res.json()) as DecideResponse };
  };

  /** Land a settle/decide response into the right terminal (or allowlist) state. */
  async function land(sub: ReviewSubmission, body: DecideResponse, viaSettle: boolean) {
    if (body.vault) {
      setLeft(body.vault.remaining);
      onRemaining?.(body.vault.remaining);
    }
    if (body.settled && body.proofUrl && body.txHash) {
      patch(sub.id, { status: "paid", payoutTx: body.txHash });
      setFlow(sub.id, { phase: "paid", proofUrl: body.proofUrl });
      return;
    }
    if (body.needsOwnerAdd && !viaSettle) {
      await runAllowlist(sub);
      return;
    }
    if (body.needsOwnerAdd) {
      setFlow(sub.id, {
        phase: "error",
        msg: "Recipient still isn't allowlisted. Try again.",
      });
      return;
    }
    patch(sub.id, { status: "blocked" });
    setFlow(sub.id, { phase: "blocked", reason: body.reason ?? "a policy check failed" });
  }

  const ensureOwnerWallet = async () => {
    if (!wallet.address) await wallet.connect();
    if (wallet.address && !wallet.onMetis) await wallet.switchToMetis();
    const wc = wallet.getWalletClient();
    return wc && wallet.address ? { wc, owner: wallet.address as Address } : null;
  };

  async function runAllowlist(sub: ReviewSubmission) {
    const w = await ensureOwnerWallet();
    if (!w) {
      setFlow(sub.id, { phase: "needs_wallet" });
      return;
    }
    setFlow(sub.id, { phase: "allowlisting", msg: "Allowlisting recipient…" });
    try {
      const results = await allowlistRecipients({
        wallet: w.wc,
        owner: w.owner,
        vault,
        recipients: [getAddress(sub.wallet)],
        onProgress: (p) =>
          setFlow(sub.id, {
            phase: p.phase === "waiting" ? "waiting" : "allowlisting",
            msg: progressMsg(p),
            readyAt: p.readyAt,
          }),
      });
      const r = results[0];
      if (r?.status === "approved") await settle(sub);
      else if (r?.status === "queued") setFlow(sub.id, { phase: "waiting", readyAt: r.readyAt });
      else setFlow(sub.id, { phase: "error", msg: r?.error ?? "Allowlisting failed." });
    } catch (err) {
      setFlow(sub.id, { phase: "error", msg: err instanceof Error ? err.message : String(err) });
    }
  }

  async function finishWaiting(sub: ReviewSubmission) {
    const w = await ensureOwnerWallet();
    if (!w) {
      setFlow(sub.id, { phase: "needs_wallet" });
      return;
    }
    setFlow(sub.id, { phase: "allowlisting", msg: "Finalizing the allowlist…" });
    try {
      const results = await executeReady({
        wallet: w.wc,
        owner: w.owner,
        vault,
        recipients: [getAddress(sub.wallet)],
      });
      const r = results[0];
      if (r?.status === "approved") await settle(sub);
      else if (r?.status === "queued") setFlow(sub.id, { phase: "waiting", readyAt: r.readyAt });
      else setFlow(sub.id, { phase: "error", msg: r?.error ?? "Not ready yet." });
    } catch (err) {
      setFlow(sub.id, { phase: "error", msg: err instanceof Error ? err.message : String(err) });
    }
  }

  async function settle(sub: ReviewSubmission) {
    setFlow(sub.id, { phase: "settling", msg: "Releasing the reward…" });
    try {
      const { res, body } = await callSettle(sub.id);
      if (!res.ok) {
        setFlow(sub.id, { phase: "error", msg: body.error ?? "Settlement failed." });
        return;
      }
      await land(sub, body, true);
    } catch {
      setFlow(sub.id, { phase: "error", msg: "Network error." });
    }
  }

  const approve = async (sub: ReviewSubmission) => {
    setFlow(sub.id, { phase: "deciding", msg: "Approving…" });
    try {
      const { res, body } = await callDecide(sub.id, "approve");
      if (!res.ok) {
        setFlow(sub.id, { phase: "error", msg: body.error ?? "Approve failed." });
        return;
      }
      await land(sub, body, false);
    } catch {
      setFlow(sub.id, { phase: "error", msg: "Network error." });
    }
  };

  const reject = async (sub: ReviewSubmission) => {
    setFlow(sub.id, { phase: "deciding", msg: "Rejecting…" });
    try {
      const { res, body } = await callDecide(sub.id, "reject");
      if (!res.ok) {
        setFlow(sub.id, { phase: "error", msg: body.error ?? "Reject failed." });
        return;
      }
      patch(sub.id, { status: "rejected" });
      setFlow(sub.id, { phase: "idle" });
    } catch {
      setFlow(sub.id, { phase: "error", msg: "Network error." });
    }
  };

  /** Batch: allowlist every approved recipient in one sequence, then settle each. */
  const settleAll = async () => {
    const targets = subs.filter((s) => s.status === "approved");
    if (targets.length === 0) return;
    const w = await ensureOwnerWallet();
    if (!w) {
      targets.forEach((s) => setFlow(s.id, { phase: "needs_wallet" }));
      return;
    }
    setBatchBusy(true);
    try {
      targets.forEach((s) => setFlow(s.id, { phase: "allowlisting", msg: "Allowlisting…" }));
      const results = await allowlistRecipients({
        wallet: w.wc,
        owner: w.owner,
        vault,
        recipients: targets.map((s) => getAddress(s.wallet)),
        onProgress: (p) => {
          const sub = targets.find((s) => s.wallet.toLowerCase() === p.address.toLowerCase());
          if (sub)
            setFlow(sub.id, {
              phase: p.phase === "waiting" ? "waiting" : "allowlisting",
              msg: progressMsg(p),
              readyAt: p.readyAt,
            });
        },
      });
      for (const sub of targets) {
        const r = results.find((x) => x.address.toLowerCase() === sub.wallet.toLowerCase());
        if (r?.status === "approved") await settle(sub);
        else if (r?.status === "queued") setFlow(sub.id, { phase: "waiting", readyAt: r.readyAt });
        else setFlow(sub.id, { phase: "error", msg: r?.error ?? "Allowlisting failed." });
      }
    } finally {
      setBatchBusy(false);
    }
  };

  const pending = subs.filter((s) => s.status === "pending");
  const approved = subs.filter((s) => s.status === "approved");
  const decided = subs.filter((s) => s.status !== "pending" && s.status !== "approved");
  const ordered = [...pending, ...approved, ...decided];

  return (
    <div>
      <div className="sage-row" style={{ marginBottom: 16, justifyContent: "space-between" }}>
        {left !== null && (
          <span className="sage-metachip">
            <Wallet size={13} color="var(--sec)" />
            <span className="k">Vault remaining</span>
            <span className="v mono">{usd(left)}</span>
          </span>
        )}
        {approved.length > 0 && (
          <button className="sage-btn sage-btn-primary sage-btn-sm" onClick={() => void settleAll()} disabled={batchBusy}>
            {batchBusy ? (
              <>
                <Loader2 size={13} className="sage-spin2" /> Settling…
              </>
            ) : (
              `Settle all approved (${approved.length})`
            )}
          </button>
        )}
      </div>

      {subs.length === 0 ? (
        <div className="sage-subs">
          <div className="sage-empty">
            No submissions yet. Share the public link and entries will appear here
            for review.
          </div>
        </div>
      ) : (
        <div className="sage-subs">
          {ordered.map((s) => (
            <Row
              key={s.id}
              s={s}
              flow={flows[s.id] ?? { phase: "idle" }}
              now={now}
              rewardUsd={rewardUsd}
              threshold={threshold}
              materialize={materializeIds.has(s.id)}
              onApprove={() => void approve(s)}
              onReject={() => void reject(s)}
              onFinish={() => void finishWaiting(s)}
              onRetryAllowlist={() => void runAllowlist(s)}
            />
          ))}
        </div>
      )}

      <p className="sage-hint" style={{ marginTop: 16 }}>
        x402 verification fee — activates when GOAT merchant credentials land.
      </p>
    </div>
  );
}

type RailNode = "pending" | "active" | "done" | "blocked";

function RailDot({ state }: { state: RailNode }) {
  return (
    <span className={`sage-rail-dot ${state}`}>
      {state === "done" ? (
        <Check size={12} strokeWidth={3} />
      ) : state === "blocked" ? (
        <XCircle size={12} />
      ) : state === "active" ? (
        <Loader2 size={12} className="sage-spin2" />
      ) : null}
    </span>
  );
}

/**
 * MOMENT 1 — the settle cascade. A vertical rail bound to the real Flow phase:
 * Deputy verified → Vault checks (6) → USDC settled. Nodes light indigo (active)
 * then green (done) as each real async step completes; a blocked spend turns the
 * checks node red. The final node becomes the /proof link + copy chip, and the
 * released amount counts up. No node lights on a timer — only on real state.
 */
function SettleRail({
  phase,
  reason,
  proofUrl,
  rewardUsd,
  cascade = false,
}: {
  phase: Phase;
  reason?: string;
  proofUrl?: string;
  rewardUsd: number | null;
  /** an autonomous settle arriving via poll — play the cascade entrance. */
  cascade?: boolean;
}) {
  let verify: RailNode = "pending";
  let checks: RailNode = "pending";
  let settled: RailNode = "pending";
  switch (phase) {
    case "deciding":
      verify = "active";
      break;
    case "allowlisting":
    case "waiting":
      verify = "done";
      break;
    case "settling":
      verify = "done";
      checks = "active";
      break;
    case "paid":
      verify = "done";
      checks = "done";
      settled = "done";
      break;
    case "blocked":
      verify = "done";
      checks = "blocked";
      break;
    default:
      return null;
  }
  const proofFull =
    proofUrl && typeof window !== "undefined"
      ? `${window.location.origin}${proofUrl}`
      : proofUrl;
  return (
    <div className={`sage-rail${cascade ? " sage-cascade-in" : ""}`}>
      <div className={`sage-rail-node ${verify}`}>
        <RailDot state={verify} />
        <span className="sage-rail-label">Deputy verified</span>
      </div>
      <div className={`sage-rail-node ${checks}`}>
        <RailDot state={checks} />
        <div className="sage-rail-main">
          <span className="sage-rail-label">Vault checks (6)</span>
          {checks === "blocked" && reason && (
            <span className="sage-rail-sub dan">{reason} · no funds moved</span>
          )}
        </div>
      </div>
      {phase !== "blocked" && (
        <div className={`sage-rail-node ${settled}`}>
          <RailDot state={settled} />
          <div className="sage-rail-main">
            <span className="sage-rail-label">
              USDC settled
              {settled === "done" && rewardUsd != null && (
                <>
                  {" · "}
                  <PayoutCount value={rewardUsd} />
                </>
              )}
            </span>
            {settled === "done" && proofUrl && (
              <span className="sage-rail-proof">
                <a className="sage-rail-prooflink" href={proofUrl}>
                  <ExternalLink size={12} /> View proof
                </a>
                {proofFull && <CopyButton value={proofFull} label="proof link" />}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Counts up from 0 to the released amount on mount — the settle moment. */
function PayoutCount({ value }: { value: number }) {
  const [d, setD] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      setD(value);
      return;
    }
    const t0 = performance.now();
    const dur = 700;
    const tick = (n: number) => {
      const p = Math.min(1, (n - t0) / dur);
      setD(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else setD(value);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);
  return (
    <span
      className="sage-rail-amount mono"
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {usd(d)}
    </span>
  );
}

/**
 * MOMENT 3 — the timelock as a radial timer. A conic ring depletes in real time,
 * bound to the on-chain readyAt (Date.now vs the maturity), around the recipient
 * chip with mono seconds inside. When it matures the ring flips green.
 */
function TimelockRadial({ readyAt, wallet }: { readyAt: number; wallet: string }) {
  const ringRef = useRef<HTMLDivElement>(null);
  const secRef = useRef<HTMLSpanElement>(null);
  const totalRef = useRef<number | null>(null);
  const [matured, setMatured] = useState(false);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = Date.now() / 1000;
      const left = Math.max(0, readyAt - now);
      if (totalRef.current == null) totalRef.current = Math.max(left, 1);
      ringRef.current?.style.setProperty("--frac", String(clamp01(left / totalRef.current)));
      if (secRef.current) secRef.current.textContent = formatCountdown(left);
      if (left <= 0) {
        setMatured(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [readyAt]);

  return (
    <div className={`sage-timelock${matured ? " ready" : ""}`}>
      <div ref={ringRef} className="sage-timelock-ring">
        <span ref={secRef} className="sage-timelock-sec mono" />
      </div>
      <div className="sage-timelock-info">
        <span className="mono">{short(wallet)}</span>
        <span className="sage-hint">
          {matured
            ? "Timelock cleared — ready to settle"
            : "Timelock — additions are deliberate, by design"}
        </span>
      </div>
    </div>
  );
}

function Row({
  s,
  flow,
  now,
  rewardUsd,
  threshold,
  materialize,
  onApprove,
  onReject,
  onFinish,
  onRetryAllowlist,
}: {
  s: ReviewSubmission;
  flow: Flow;
  now: number;
  rewardUsd: number | null;
  threshold: number;
  /** play the receipt "materialize" once — set when the brief just arrived. */
  materialize: boolean;
  onApprove: () => void;
  onReject: () => void;
  onFinish: () => void;
  onRetryAllowlist: () => void;
}) {
  const pending = s.status === "pending";
  const busy =
    flow.phase === "deciding" ||
    flow.phase === "allowlisting" ||
    flow.phase === "settling";
  const secondsLeft = flow.readyAt ? flow.readyAt - now : 0;
  const matured = flow.phase === "waiting" && secondsLeft <= 0;

  return (
    <div className="sage-sub">
      <div className="sage-sub-main">
        <div className="sage-sub-wallet">
          <Wallet size={14} color="var(--sec)" />
          <span className="mono">{short(s.wallet)}</span>
          <span className="sage-hint">· {since(s.createdAt)}</span>
        </div>
        {s.note && <div className="sage-sub-note">{s.note}</div>}
        {s.evidenceUrl && (
          <a className="sage-sub-link" href={s.evidenceUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={13} /> {s.evidenceUrl}
          </a>
        )}

        {/* the Deputy's autonomous outcome — held (amber) or paid-by-Deputy */}
        {s.autopay?.state === "held" && s.status !== "paid" && (
          <div className="sage-autopay held">
            <Clock size={13} /> Held by Deputy — {s.autopay.reason}
          </div>
        )}
        {s.status === "paid" && s.autopay?.state === "settled" && (
          <div className="sage-autopay paid">
            <Sparkles size={13} /> Paid by Deputy
            {typeof s.brief?.confidence === "number" && (
              <> · {Math.round(s.brief.confidence * 100)}% confidence</>
            )}
            {s.payoutTx && (
              <>
                {" · "}
                <a href={`/proof/${s.payoutTx}`}>proof</a>
              </>
            )}
          </div>
        )}
        {s.status === "paid" && s.payoutTx && (
          <a className="sage-sub-link" href={`/proof/${s.payoutTx}`}>
            <ExternalLink size={13} /> Payout proof
          </a>
        )}
        {s.status === "rejected" && s.rejectReason && (
          <div className="sage-sub-note" style={{ color: "var(--dan)" }}>{s.rejectReason}</div>
        )}

        {/* the Deputy's verification receipt, before you confirm */}
        {pending && s.brief && (
          <DeputyAssessmentCard
            brief={s.brief}
            rewardUsd={rewardUsd}
            threshold={threshold}
            materialize={materialize}
          />
        )}

        {/* the settle cascade — bound to the real flow phase (moment 1) */}
        {(flow.phase === "deciding" ||
          flow.phase === "allowlisting" ||
          flow.phase === "waiting" ||
          flow.phase === "settling" ||
          flow.phase === "paid" ||
          flow.phase === "blocked") && (
          <SettleRail
            phase={flow.phase}
            reason={flow.reason}
            proofUrl={flow.proofUrl}
            rewardUsd={rewardUsd}
            cascade={flow.cascade}
          />
        )}
        {/* owner-signing / timelock context beneath the rail */}
        {flow.phase === "allowlisting" && (
          <div className="sage-flow">
            <ShieldCheck size={13} /> {flow.msg}
            <span className="sage-hint">
              {" "}
              The vault only pays pre-approved recipients — by design.
            </span>
          </div>
        )}
        {flow.phase === "waiting" && !matured && flow.readyAt && (
          <TimelockRadial readyAt={flow.readyAt} wallet={s.wallet} />
        )}
        {flow.phase === "needs_wallet" && (
          <div className="sage-flow amber">
            Connect the vault owner wallet on Metis to allowlist the recipient.
          </div>
        )}
        {flow.phase === "error" && (
          <div className="sage-flow dan">
            <XCircle size={13} /> {flow.msg}
          </div>
        )}
      </div>

      <div className="sage-sub-side">
        <StatusBadge status={s.status} />
        {pending && !busy && (
          <div className="sage-sub-actions">
            <button className="sage-btn sage-btn-ghost sage-btn-sm" onClick={onReject}>
              Reject
            </button>
            <button className="sage-btn sage-btn-primary sage-btn-sm" onClick={onApprove}>
              Approve &amp; pay
            </button>
          </div>
        )}
        {busy && (
          <button className="sage-btn sage-btn-sm" disabled>
            <Loader2 size={13} className="sage-spin2" /> {flow.msg ?? "Working…"}
          </button>
        )}
        {flow.phase === "waiting" && matured && (
          <button
            className="sage-btn sage-btn-primary sage-btn-sm sage-spring-in"
            onClick={onFinish}
          >
            Finish payout
          </button>
        )}
        {s.status === "approved" && flow.phase === "idle" && (
          <button className="sage-btn sage-btn-primary sage-btn-sm" onClick={onRetryAllowlist}>
            Complete payout
          </button>
        )}
        {(flow.phase === "error" || flow.phase === "needs_wallet") &&
          s.status === "approved" && (
            <button className="sage-btn sage-btn-sm" onClick={onRetryAllowlist}>
              Retry
            </button>
          )}
      </div>
    </div>
  );
}
