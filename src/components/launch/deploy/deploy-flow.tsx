"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAddress } from "viem";
import { useWallet } from "@/lib/wallet/use-wallet";
import { viemChainFor, chainConfig, explorerAddressUrl } from "@/lib/deputy/networks";
import { defaultAutonomyFor } from "@/lib/campaigns/autonomy-default";
import { TreasuryLaunch } from "./treasury-launch";
import { reward, launchToken, type PlanView } from "../types";

/**
 * ONE WAY TO LAUNCH (26 Oct 2026, the founder's rule: an email and MetaMask must be the same "from login to
 * launching"). A plan launches from the account Sage keeps on Metis, in one step, for everyone, through
 * TreasuryLaunch. The browser-wallet route that sat behind it (claim the plan with a wallet signature, then
 * sign create, approve, fund and activate from MetaMask, on a network picked here) was a door only a wallet
 * sign-in could use, and it offered networks that are now closed, so it no longer starts. What remains of it
 * below RESUMES a deployment a founder began that way before, from its durable server state, so nothing in
 * flight is stranded.
 */

/**
 * The founder deployment journey. Everything money-affecting is verified server-side; this
 * component only gathers the wallet's signatures + transactions and is driven ENTIRELY by
 * the durable deployment state returned by the server — so a refresh, a disconnect, or a
 * duplicate click resumes from the exact same place and never resends a confirmed step.
 */

type Phase = "claim" | "limits" | "execute" | "attach" | "live" | "recovery" | "failed";
type Step = "create" | "approve" | "fund" | "activate";

interface DeploymentView {
  id: string;
  state: string;
  terminal: boolean;
  chainId: number;
  founder: string;
  predictedVault: string;
  deployedVault: string | null;
  attachedCampaignId: string | null;
  totalBudgetHuman: string;
  tokenDecimals: number;
  next: { phase: Phase; step?: Step; mode?: "broadcast" | "confirm" };
  steps: { step: Step; txHash: string | null; done: boolean }[];
  failureReason: string | null;
}
interface StepCall {
  step: Step;
  to: string;
  data: string;
  value: string;
  label: string;
}
interface Preview {
  predictedVault: string;
  token: string;
  totalBudgetHuman: string;
  founderBalanceHuman: string;
  sufficientBalance: boolean;
  shortfallHuman: string;
  vaultAlreadyExists: boolean;
  needsApproval: boolean;
  approvalIsExact: boolean;
  missions: { title: string; rewardHuman: string; maxCompletions: string }[];
  campaignIdHash: string;
  missionPlanDigest: string;
}

const STEP_LABELS: Record<Step, string> = {
  create: "Creating your campaign vault",
  approve: "Approving the budget",
  fund: "Funding the campaign",
  activate: "Activating Sage",
};

export function DeployFlow({ jobId, plan }: { jobId: string; plan: PlanView }) {
  const wallet = useWallet();
  const storeKey = `sage.deploy.${jobId}`;

  const [dep, setDep] = useState<DeploymentView | null>(null);
  const [calls, setCalls] = useState<StepCall[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batchSupported, setBatchSupported] = useState(false);
  const running = useRef(false);

  // Founder-chosen limits (defaults; budget itself is fixed from the approved plan).
  const budgetBase = Number(plan.totalBudgetBase);
  const [dailyCapUsd, setDailyCapUsd] = useState((budgetBase / 1e6).toString());
  const [durationDays, setDurationDays] = useState("14");
  // P18/P19 — the most times ONE wallet can be paid across this whole campaign. Default 1 (max Sybil
  // resistance — a fresh payout needs a fresh wallet); the founder raises it for trusted multi-mission testers.
  const [perWalletCap, setPerWalletCap] = useState("1");
  // Payout mode. Default autopilot — the agent that designs the missions also pays them,
  // inside the vault's on-chain limits. The founder can switch to manual review.
  // Members-only work autopays; public work starts with the team releasing each payout. Flip it here.
  const [autonomy, setAutonomy] = useState<"manual" | "autopilot">(defaultAutonomyFor(plan.visibility));

  const load = useCallback(
    async (id: string): Promise<DeploymentView | null> => {
      try {
        const res = await fetch(`/api/deployments/${id}`, { cache: "no-store" });
        if (res.status === 403 || res.status === 404) {
          localStorage.removeItem(storeKey);
          return null;
        }
        const data = await res.json();
        if (data.ok) {
          setDep(data.deployment);
          if (data.calls) setCalls(data.calls);
          return data.deployment as DeploymentView;
        }
      } catch {
        /* keep prior state */
      }
      return null;
    },
    [storeKey],
  );

  // Resume from durable state on mount (refresh-safe).
  useEffect(() => {
    const id = typeof window !== "undefined" ? localStorage.getItem(storeKey) : null;
    if (id) void load(id);
  }, [load, storeKey]);

  const post = useCallback(async (url: string, body?: unknown) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({ ok: false, error: "Unexpected response." }));
    return { status: res.status, data } as { status: number; data: Record<string, unknown> };
  }, []);

  /* ── preview: apply limits, read the chain, reach preflight_ready ───────── */
  const submitPreview = useCallback(async () => {
    if (!dep) return;
    setError(null);
    setBusy(true);
    setNote("Preparing your deployment preview…");
    try {
      const dailyCapBase = Math.round(Number(dailyCapUsd) * 1e6).toString();
      const durationSeconds = String(Math.max(1, Math.round(Number(durationDays))) * 86400);
      const r = await post(`/api/deployments/${dep.id}/preview`, { dailyCapBase, durationSeconds, guardian: dep.founder });
      if (!r.data.ok) {
        setError(String(r.data.error ?? "These limits aren’t valid."));
        return;
      }
      setPreview(r.data.preview as Preview);
      if (r.data.calls) setCalls(r.data.calls as StepCall[]);
      setDep(r.data.deployment as DeploymentView);
      // Truthfully probe EIP-5792 batch support so we only promise a batch we can deliver.
      setBatchSupported(await probeBatch(wallet));
    } finally {
      setBusy(false);
      setNote(null);
    }
  }, [dep, dailyCapUsd, durationDays, post, wallet]);

  // Resume-safety: if we reload straight into the execute phase (a deployment already
  // mid-flight), fetch the preview from the frozen settings so the panel + continue button
  // render — the founder can pick up exactly where they left off.
  useEffect(() => {
    if (dep && dep.next.phase === "execute" && !preview && calls.length > 0 && !busy) void submitPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep?.next.phase, calls.length]);

  /**
   * A SUBMITTED-BUT-UNCONFIRMED STEP MUST SELF-HEAL.
   *
   * `/reconcile` re-reads the chain and advances a step whose tx has since confirmed, without ever
   * re-broadcasting. It shipped with the deploy flow and NOTHING EVER CALLED IT — so a founder whose
   * confirm loop was interrupted reloaded into "Setting up…" forever. Measured 2026-08-15: the create
   * tx mined (status 0x1) and the vault was live on chain with 6,228 bytes of code, while the app sat
   * in `deploying` and reloading changed nothing, because resuming only re-read the same stuck row.
   *
   * Every ordinary interruption lands here: a closed tab, a dropped request, a flaky RPC, or the app
   * being redeployed mid-flow (which invalidates the in-flight server action the tab was waiting on).
   * Polling while — and only while — a step is awaiting confirmation makes all of them recover on
   * their own, and costs nothing on any other state.
   */
  useEffect(() => {
    if (!dep || dep.next.mode !== "confirm" || busy) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      const { data } = await post(`/api/deployments/${dep.id}/reconcile`);
      if (!stopped && data?.ok && data.deployment) setDep(data.deployment as DeploymentView);
    };
    void tick();
    const timer = setInterval(() => void tick(), 6000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep?.id, dep?.next.mode, dep?.next.step, busy]);

  /* ── execute: sequential wallet path (never resends a confirmed step) ───── */
  const runExecution = useCallback(
    async (start: DeploymentView) => {
      if (running.current) return;
      running.current = true;
      setError(null);
      setBusy(true);
      try {
        // EIP-5792: if the wallet supports it, send all remaining setup calls as ONE batch
        // (one confirmation). The server still verifies each step's on-chain effect in
        // order — batching changes only how the wallet confirms, never the safety checks.
        let batchMarker: string | null = null;
        if (batchSupported && start.next.mode === "broadcast") {
          setNote("Confirm the campaign setup in your wallet…");
          batchMarker = await sendBatch(wallet, calls, start.chainId).catch(() => null);
        }
        let cur: DeploymentView | null = start;
        while (cur && cur.next.phase === "execute" && cur.next.step) {
          const step = cur.next.step;
          setNote(`${STEP_LABELS[step]}…`);
          if (cur.next.mode === "broadcast") {
            let call = calls.find((c) => c.step === step);
            const walletClient = wallet.getWalletClient(cur.chainId);
            /**
             * THREE CAUSES, ONE MESSAGE, AND IT NAMED THE WRONG ONE.
             *
             * This fired when the wallet was disconnected, when the wallet client could not be
             * built, AND when the step's calldata was missing from `calls` — and always said
             * "your wallet is not connected". Measured 2026-08-15: a founder reconnected their
             * wallet, which is exactly what the message asked for, and got the same error again,
             * because the actual fault was the third one. A message that names the wrong cause
             * sends someone to fix something that was never broken.
             */
            if (!wallet.address || !walletClient) {
              setError("Your wallet is not connected. Reconnect to continue — nothing was lost.");
              break;
            }
            if (!call) {
              // the calldata is rebuilt server-side from the approved plan; re-fetch it rather
              // than blaming the wallet, and say so if it still is not there.
              const refreshed = await load(cur.id);
              const retryCall = refreshed
                ? (await (await fetch(`/api/deployments/${cur.id}`, { cache: "no-store" })).json())?.calls?.find(
                    (c: { step: string }) => c.step === step,
                  )
                : null;
              if (!retryCall) {
                setError(
                  `Sage could not rebuild the “${STEP_LABELS[step].toLowerCase()}” step. Nothing was lost and nothing was sent — reload the page, and tell us if it persists.`,
                );
                break;
              }
              calls.push(retryCall as (typeof calls)[number]);
              call = retryCall as NonNullable<typeof call>;
            }
            if (!call) break; // unreachable: the branch above either recovers it or breaks
            let txHash: string;
            try {
              if (batchMarker) {
                // The batch was already confirmed; use its per-step marker (no new prompt).
                txHash = `${batchMarker}${step}`.slice(0, 66);
              } else {
                txHash = await walletClient.sendTransaction({
                  account: getAddress(wallet.address),
                  chain: viemChainFor(cur.chainId),
                  to: getAddress(call.to),
                  data: call.data as `0x${string}`,
                  value: BigInt(0),
                });
              }
            } catch {
              setError(`You declined the “${STEP_LABELS[step].toLowerCase()}” confirmation. Your progress is saved; you can resume.`);
              break;
            }
            const sub = await post(`/api/deployments/${cur.id}/steps/${step}/submitted`, { txHash });
            if (!sub.data.ok) {
              setError(String(sub.data.error ?? "Could not record the transaction."));
              break;
            }
            cur = sub.data.deployment as DeploymentView;
            setDep(cur);
          }
          // confirm (server verifies the receipt + chain state; never trusts the client).
          // A `retryable` failure means the tx is still settling on-chain — poll, don't fail.
          let conf = await post(`/api/deployments/${cur.id}/steps/${step}/confirm`);
          for (let tries = 0; !conf.data.ok && conf.data.retryable && tries < 40; tries++) {
            setNote(`${STEP_LABELS[step]} — confirming on-chain…`);
            await new Promise((r) => setTimeout(r, 3000));
            conf = await post(`/api/deployments/${cur.id}/steps/${step}/confirm`);
          }
          if (!conf.data.ok) {
            setError(String(conf.data.error ?? "The step could not be verified."));
            if (conf.data.deployment) setDep(conf.data.deployment as DeploymentView);
            cur = null;
            break;
          }
          cur = conf.data.deployment as DeploymentView;
          setDep(cur);
        }
        if (cur && cur.next.phase === "attach") await attach(cur);
      } finally {
        running.current = false;
        setBusy(false);
        setNote(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calls, wallet, post, batchSupported],
  );

  /* ── attach: verify + atomic persist → live ────────────────────────────── */
  const attach = useCallback(
    async (cur: DeploymentView) => {
      setNote("Verifying the campaign…");
      const r = await post(`/api/deployments/${cur.id}/attach`, { autonomy, perWalletCap: Math.max(1, Math.round(Number(perWalletCap) || 1)) });
      if (!r.data.ok) {
        setError(String(r.data.error ?? "Attachment did not complete. Your vault is safe."));
        if (r.data.deployment) setDep(r.data.deployment as DeploymentView);
        return;
      }
      setDep(r.data.deployment as DeploymentView);
    },
    [post, autonomy, perWalletCap],
  );

  const phase: Phase = dep?.next.phase ?? "claim";

  return (
    <div className="lxd" aria-label="Fund and launch">
      {phase !== "live" && (
        <div className="lxd-lead">
          <h3 className="lxd-lead-h">Launch it from your account</h3>
          <p className="lxd-lead-p">
            Sage creates this job&apos;s vault from your account on Metis, funds it with the budget above and starts
            paying verified work inside your limits. It can <b>never</b> spend more than this job&apos;s budget, and
            what the job doesn&apos;t spend returns to your account.
          </p>
        </div>
      )}
      {/* Only a deployment begun from a browser wallet before 26 Oct 2026 has steps to show: it resumes here. */}
      {dep && <Stepper phase={phase} dep={dep} />}

      {note && (
        <div className="lxd-note" role="status">
          <span className="lxd-spin" aria-hidden /> {note}
        </div>
      )}
      {/* FUND ONCE, THE AGENT LAUNCHES: the one door, for an email and a wallet sign-in alike. */}
      {!dep && <TreasuryLaunch jobId={jobId} budgetUsd={Number(plan.totalBudgetBase) / 10 ** plan.tokenDecimals} />}

      {error && (
        <div className="lx-err" role="alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}

      {phase === "limits" && dep && (
        <LimitsPanel
          plan={plan}
          founder={dep.founder}
          chainId={dep.chainId}
          dailyCapUsd={dailyCapUsd}
          setDailyCapUsd={setDailyCapUsd}
          durationDays={durationDays}
          setDurationDays={setDurationDays}
          perWalletCap={perWalletCap}
          setPerWalletCap={setPerWalletCap}
          autonomy={autonomy}
          setAutonomy={setAutonomy}
          busy={busy}
          onReview={submitPreview}
        />
      )}

      {phase === "execute" && dep && (
        <PreviewPanel
          preview={preview}
          dep={dep}
          busy={busy}
          batchSupported={batchSupported}
          onStart={() => runExecution(dep)}
        />
      )}

      {phase === "attach" && dep && (
        <div className="lxd-panel">
          <p className="lx-sub">Your vault is deployed and funded. Finishing setup…</p>
          <button className="lx-btn" disabled={busy} onClick={() => attach(dep)}>
            {busy ? "Verifying…" : "Verify and go live"}
          </button>
        </div>
      )}

      {phase === "recovery" && dep && (
        <RecoveryPanel dep={dep} busy={busy} onRetry={() => attach(dep)} />
      )}

      {phase === "live" && dep && <LiveSuccess dep={dep} plan={plan} />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── sub-panels ── */

function Stepper({ phase, dep }: { phase: Phase; dep: DeploymentView | null }) {
  const steps: { key: Phase | Step; label: string }[] = [
    { key: "claim", label: "Wallet ownership" },
    { key: "limits", label: "Campaign limits" },
    { key: "create", label: "Create vault" },
    { key: "approve", label: "Approve budget" },
    { key: "fund", label: "Fund" },
    { key: "activate", label: "Activate" },
    { key: "live", label: "Live" },
  ];
  const rank: Record<string, number> = { claim: 0, limits: 1, create: 2, approve: 3, fund: 4, activate: 5, attach: 6, live: 6, recovery: 6, failed: 6 };
  const cur = rank[phase] ?? 0;
  const doneSteps = new Set((dep?.steps ?? []).filter((s) => s.done).map((s) => s.step));
  return (
    <ol className="lxd-steps" aria-label="Deployment progress">
      {steps.map((s, i) => {
        const isStep = ["create", "approve", "fund", "activate"].includes(s.key);
        const done = phase === "live" ? true : isStep ? doneSteps.has(s.key as Step) : i < cur;
        const active = i === cur || (isStep && dep?.next.step === s.key);
        return (
          <li key={s.key} className={`lxd-step ${done ? "done" : ""} ${active ? "active" : ""}`}>
            <span className="lxd-step-dot" aria-hidden>{done ? "✓" : i + 1}</span>
            <span className="lxd-step-label">{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function LimitsPanel(props: {
  plan: PlanView;
  founder: string;
  chainId: number;
  dailyCapUsd: string;
  setDailyCapUsd: (v: string) => void;
  durationDays: string;
  setDurationDays: (v: string) => void;
  perWalletCap: string;
  setPerWalletCap: (v: string) => void;
  autonomy: "manual" | "autopilot";
  setAutonomy: (v: "manual" | "autopilot") => void;
  busy: boolean;
  onReview: () => void;
}) {
  const { plan, founder, chainId, dailyCapUsd, setDailyCapUsd, durationDays, setDurationDays, perWalletCap, setPerWalletCap, autonomy, setAutonomy, busy, onReview } = props;
  return (
    <div className="lxd-panel">
      <div className="lxd-grid">
        <Field label="Total budget (fixed)"><span className="mono">{reward(plan.totalBudgetBase, chainId)}</span></Field>
        <div className="lx-field" style={{ margin: 0 }}>
          <label className="lx-label">Daily payout limit ({launchToken(chainId)})</label>
          <input className="lx-input" type="number" min="0.5" step="0.5" value={dailyCapUsd} onChange={(e) => setDailyCapUsd(e.target.value)} />
        </div>
        <div className="lx-field" style={{ margin: 0 }}>
          <label className="lx-label">Duration (days)</label>
          <input className="lx-input" type="number" min="1" max="90" step="1" value={durationDays} onChange={(e) => setDurationDays(e.target.value)} />
        </div>
        <div className="lx-field" style={{ margin: 0 }}>
          <label className="lx-label">Payouts per wallet</label>
          <input className="lx-input" type="number" min="1" max="1000" step="1" value={perWalletCap} onChange={(e) => setPerWalletCap(e.target.value)} />
          <span className="lx-hint">Most times one wallet can be paid across the whole campaign. 1 = strongest Sybil resistance.</span>
        </div>
        <Field label="Settles on"><span>{chainConfig(chainId).chipLabel}{chainConfig(chainId).isMainnet ? "" : " (testnet)"}</span></Field>
        <Field label="Owner (you)"><span className="mono">{short(founder)}</span></Field>
        <Field label="Guardian"><span className="mono">{short(founder)}</span></Field>
      </div>
      <div className="lxd-autonomy" style={{ marginTop: 16 }}>
        <label className="lx-label">Payout mode</label>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button
            type="button"
            onClick={() => setAutonomy("autopilot")}
            className={`lx-btn${autonomy === "autopilot" ? "" : " ghost"}`}
            style={{ flex: 1 }}
          >
            Sage pays
          </button>
          <button
            type="button"
            onClick={() => setAutonomy("manual")}
            className={`lx-btn${autonomy === "manual" ? "" : " ghost"}`}
            style={{ flex: 1 }}
          >
            You release
          </button>
        </div>
        <p className="lx-approve-note" style={{ marginTop: 8 }}>
          {plan.visibility === "unlisted"
            ? "Members-only work. "
            : "Open to the public board — Sage approves at once and settles after a short window it uses to watch the wallet graph; a copy or a cluster is revoked with the reason. "}
          {autonomy === "autopilot"
            ? "Sage designed these missions — and pays verified work on its own the moment its confidence clears 85%, inside the on-chain limits above. Nothing else can move funds."
            : "Sage verifies and recommends each submission; you release every reward yourself. The vault still enforces every limit on-chain."}
        </p>
      </div>
      <p className="lx-approve-note" style={{ marginTop: 14 }}>
        The vault enforces these limits on-chain. Sage operates within them and can never exceed the budget, the daily
        cap, or the per-mission rewards.
      </p>
      <button className="lx-btn" disabled={busy} onClick={onReview}>
        {busy ? "Preparing…" : "Review deployment"}
      </button>
    </div>
  );
}

function PreviewPanel({ preview, dep, busy, batchSupported, onStart }: { preview: Preview | null; dep: DeploymentView; busy: boolean; batchSupported: boolean; onStart: () => void }) {
  const [showTech, setShowTech] = useState(false);
  return (
    <div className="lxd-panel">
      {preview ? (
        <>
          <div className="lxd-grid">
            <Field label="Total budget"><span className="mono">{preview.totalBudgetHuman} {launchToken(dep.chainId)}</span></Field>
            <Field label="Your balance">
              <span className="mono" style={{ color: preview.sufficientBalance ? "var(--lx-pos)" : "var(--lx-warn)" }}>
                {preview.founderBalanceHuman} {launchToken(dep.chainId)}
              </span>
            </Field>
            <Field label="Missions · completions">
              <span>{preview.missions.length} · {preview.missions.reduce((s, m) => s + Number(m.maxCompletions), 0)}</span>
            </Field>
            <Field label="Predicted vault"><span className="mono">{short(preview.predictedVault)}</span></Field>
            <Field label="Token approval"><span>Exactly {preview.totalBudgetHuman} {launchToken(dep.chainId)} (never unlimited)</span></Field>
            <Field label="Wallet confirmations"><span>Up to 4 one-time setup signatures</span></Field>
          </div>

          {!preview.sufficientBalance && (
            <div className="lx-note">
              Your wallet is short {preview.shortfallHuman} {launchToken(dep.chainId)} to fund this campaign. Top it up with USDC on{" "}
              {chainConfig(dep.chainId).name} and reload before continuing.
            </div>
          )}
          {preview.vaultAlreadyExists && (
            <div className="lx-note">This exact vault already exists on-chain — Sage will resume rather than redeploy.</div>
          )}

          <button className="lxd-tech-toggle" onClick={() => setShowTech((s) => !s)}>
            {showTech ? "Hide" : "Show"} technical details
          </button>
          {showTech && (
            <div className="lxd-tech">
              <Row k="campaignIdHash" v={preview.campaignIdHash} />
              <Row k="missionPlanDigest" v={preview.missionPlanDigest} />
              <Row k="predicted vault" v={preview.predictedVault} />
              <Row k="settlement token" v={preview.token} />
            </div>
          )}

          <p className="lxd-own" style={{ marginTop: 14 }}>
            {batchSupported
              ? "Your wallet can confirm this setup as a batch. Nothing is spent beyond the exact budget you see here."
              : "Your wallet will ask for a few one-time setup confirmations. Nothing is spent beyond the exact budget you see here."}
          </p>
          <button className="lx-btn" disabled={busy || !preview.sufficientBalance} onClick={onStart}>
            {busy ? "Setting up…" : "Create and fund campaign"}
          </button>
        </>
      ) : (
        <p className="lx-sub">Preparing your preview…</p>
      )}
      <RunningSteps dep={dep} />
    </div>
  );
}

function RunningSteps({ dep }: { dep: DeploymentView }) {
  const anyTx = dep.steps.some((s) => s.txHash);
  if (!anyTx) return null;
  return (
    <ul className="lxd-txs">
      {dep.steps.map((s) => (
        <li key={s.step} className={s.done ? "done" : s.txHash ? "pending" : ""}>
          <span className="lxd-tx-k">{STEP_LABELS[s.step]}</span>
          {s.txHash ? <span className="mono lxd-tx-h">{short(s.txHash)}</span> : <span className="lxd-tx-w">waiting</span>}
        </li>
      ))}
    </ul>
  );
}

function RecoveryPanel({ dep, busy, onRetry }: { dep: DeploymentView; busy: boolean; onRetry: () => void }) {
  return (
    <div className="lxd-panel lxd-recovery">
      <div className="lx-h1" style={{ fontSize: 20 }}>Your vault is safe — one step to finish</div>
      <p className="lx-sub">
        The vault was created and funded, but the final step didn’t complete
        {dep.failureReason ? ` (${dep.failureReason})` : ""}. Nothing was lost and no funds can be withdrawn by Sage. You
        can safely retry — this only re-runs the finishing step, never a new deployment.
      </p>
      {dep.deployedVault && <div className="lxd-sub-addr mono">Vault: {short(dep.deployedVault)}</div>}
      <button className="lx-btn" disabled={busy} onClick={onRetry}>
        {busy ? "Retrying…" : "Retry finishing setup"}
      </button>
    </div>
  );
}

function LiveSuccess({ dep, plan }: { dep: DeploymentView; plan: PlanView }) {
  const completions = plan.missions.reduce((s, m) => s + Number(m.maxCompletions), 0);
  const explorer = explorerAddressUrl(dep.chainId, dep.deployedVault ?? dep.predictedVault);
  return (
    <div className="lxd-panel lxd-live">
      <div className="lxd-live-badge" aria-hidden>✓</div>
      <div className="lx-h1" style={{ fontSize: 24 }}>Your campaign is live.</div>
      <div className="lxd-grid" style={{ marginTop: 12 }}>
        <Field label="Active missions"><span>{plan.missions.length} · {completions} completions</span></Field>
        <Field label="Funded"><span className="mono">{dep.totalBudgetHuman} {launchToken(dep.chainId)}</span></Field>
        <Field label="Owner (you)"><span className="mono">{short(dep.founder)}</span></Field>
        <Field label="Sage operator"><span>Bounded payout role</span></Field>
        <Field label="Vault">
          <a className="lxd-link mono" href={explorer} target="_blank" rel="noopener noreferrer">{short(dep.deployedVault ?? dep.predictedVault)}</a>
        </Field>
        <Field label="Network"><span>{chainConfig(dep.chainId).chipLabel}</span></Field>
      </div>
      <div className="lxd-guarantee">Sage cannot withdraw these funds. It can only pay verified mission work within your limits.</div>
      {dep.attachedCampaignId && (
        <div style={{ marginTop: 14, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <a className="lx-btn" href={`/campaign/${dep.attachedCampaignId}`} style={{ display: "inline-block", textDecoration: "none" }}>
            Open campaign console
          </a>
          <a href={`/c/${dep.attachedCampaignId}`} className="lxd-link" style={{ textDecoration: "none" }}>
            View public tester board →
          </a>
          <a href="/workspace/jobs" className="lxd-link" style={{ textDecoration: "none" }}>
            All your campaigns →
          </a>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="lxd-f">
      <div className="lxd-f-k">{label}</div>
      <div className="lxd-f-v">{children}</div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="lx-map-row">
      <span className="lx-map-k">{k}</span>
      <span className="lx-map-v mono">{v}</span>
    </div>
  );
}
function short(s: string): string {
  return s && s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s;
}

/** Truthfully detect EIP-5792 atomic batch support (never promise a batch we can't send). */
async function probeBatch(wallet: ReturnType<typeof useWallet>): Promise<boolean> {
  try {
    const client = wallet.getWalletClient();
    if (!client || !wallet.address) return false;
    const rpc = client.request as unknown as (a: { method: string; params: unknown[] }) => Promise<unknown>;
    const caps = (await rpc({ method: "wallet_getCapabilities", params: [getAddress(wallet.address)] })) as
      | Record<string, { atomic?: { status?: string } }>
      | undefined;
    if (!caps) return false;
    return Object.values(caps).some((c) => c.atomic?.status === "supported" || c.atomic?.status === "ready");
  } catch {
    return false;
  }
}

/** Send all setup calls as one EIP-5792 batch; returns the batch id (one confirmation). */
async function sendBatch(wallet: ReturnType<typeof useWallet>, calls: StepCall[], chainId: number): Promise<string> {
  const client = wallet.getWalletClient(chainId);
  if (!client || !wallet.address) throw new Error("no wallet");
  const rpc = client.request as unknown as (a: { method: string; params: unknown[] }) => Promise<unknown>;
  const res = (await rpc({
    method: "wallet_sendCalls",
    params: [
      {
        version: "2.0.0",
        from: getAddress(wallet.address),
        chainId: `0x${chainId.toString(16)}`,
        atomicRequired: true,
        calls: calls.map((c) => ({ to: getAddress(c.to), data: c.data, value: "0x0" })),
      },
    ],
  })) as { id?: string } | string;
  return typeof res === "string" ? res : (res.id ?? "0xbatch");
}
