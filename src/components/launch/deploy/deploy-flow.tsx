"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAddress } from "viem";
import { useWallet } from "@/lib/wallet/use-wallet";
import { useSiwe } from "@/lib/auth/use-siwe";
import { metisSepolia } from "@/lib/wallet/config";
import { buildClaimTypedData, type PlanClaim } from "@/lib/launch/claim";
import type { PlanView } from "../types";

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
  const siwe = useSiwe();
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

  /* ── claim: sign the EIP-712 plan-claim, take ownership ─────────────────── */
  const claim = useCallback(async () => {
    setError(null);
    setBusy(true);
    setNote("Securing plan ownership…");
    try {
      if (!siwe.authed) {
        const ok = await siwe.signIn();
        if (!ok) {
          setError("Sign-in was cancelled.");
          return;
        }
      }
      const walletClient = wallet.getWalletClient();
      const account = wallet.address;
      if (!walletClient || !account) {
        setError("Connect your wallet to continue.");
        return;
      }
      const ch = await post(`/api/launch/${jobId}/claim/challenge`);
      if (!ch.data.ok) {
        setError(String(ch.data.error ?? "Could not start the claim."));
        return;
      }
      const claimObj = ch.data.claim as PlanClaim;
      const typed = buildClaimTypedData(claimObj);
      let signature: string;
      try {
        signature = await walletClient.signTypedData({
          account: getAddress(account),
          domain: typed.domain,
          types: typed.types,
          primaryType: typed.primaryType,
          message: typed.message,
        });
      } catch {
        setError("You declined the ownership signature. Nothing was deployed.");
        return;
      }
      const claimed = await post(`/api/launch/${jobId}/claim`, { claim: claimObj, signature });
      if (!claimed.data.ok) {
        setError(String(claimed.data.error ?? "Could not record the claim."));
        return;
      }
      const d = claimed.data.deployment as DeploymentView;
      localStorage.setItem(storeKey, d.id);
      setDep(d);
    } finally {
      setBusy(false);
      setNote(null);
    }
  }, [siwe, wallet, post, jobId, storeKey]);

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
          batchMarker = await sendBatch(wallet, calls).catch(() => null);
        }
        let cur: DeploymentView | null = start;
        while (cur && cur.next.phase === "execute" && cur.next.step) {
          const step = cur.next.step;
          setNote(`${STEP_LABELS[step]}…`);
          if (cur.next.mode === "broadcast") {
            const call = calls.find((c) => c.step === step);
            const walletClient = wallet.getWalletClient();
            if (!call || !walletClient || !wallet.address) {
              setError("Your wallet is not connected. Reconnect to continue — nothing was lost.");
              break;
            }
            let txHash: string;
            try {
              if (batchMarker) {
                // The batch was already confirmed; use its per-step marker (no new prompt).
                txHash = `${batchMarker}${step}`.slice(0, 66);
              } else {
                txHash = await walletClient.sendTransaction({
                  account: getAddress(wallet.address),
                  chain: metisSepolia,
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
          const conf = await post(`/api/deployments/${cur.id}/steps/${step}/confirm`);
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
      const r = await post(`/api/deployments/${cur.id}/attach`);
      if (!r.data.ok) {
        setError(String(r.data.error ?? "Attachment did not complete. Your vault is safe."));
        if (r.data.deployment) setDep(r.data.deployment as DeploymentView);
        return;
      }
      setDep(r.data.deployment as DeploymentView);
    },
    [post],
  );

  const phase: Phase = dep?.next.phase ?? "claim";

  return (
    <div className="lxd" aria-label="Create and fund campaign">
      <Stepper phase={phase} dep={dep} />

      {note && (
        <div className="lxd-note" role="status">
          <span className="lxd-spin" aria-hidden /> {note}
        </div>
      )}
      {error && (
        <div className="lx-err" role="alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}

      {phase === "claim" && (
        <ClaimPanel siwe={siwe} busy={busy} onClaim={claim} />
      )}

      {phase === "limits" && dep && (
        <LimitsPanel
          plan={plan}
          founder={dep.founder}
          dailyCapUsd={dailyCapUsd}
          setDailyCapUsd={setDailyCapUsd}
          durationDays={durationDays}
          setDurationDays={setDurationDays}
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

function ClaimPanel({ siwe, busy, onClaim }: { siwe: ReturnType<typeof useSiwe>; busy: boolean; onClaim: () => void }) {
  return (
    <div className="lxd-panel">
      <p className="lxd-own">Your wallet owns this campaign. Sage receives only the bounded operator role.</p>
      {!siwe.available ? (
        <div className="lx-note">
          No wallet detected. Install a browser wallet (e.g. MetaMask) to create and fund your campaign, then reload this
          page. You’ll never paste a private key.
        </div>
      ) : !siwe.address ? (
        <button className="lx-btn" disabled={busy || siwe.connecting} onClick={() => void siwe.connect()}>
          {siwe.connecting ? "Connecting…" : "Connect your wallet"}
        </button>
      ) : !siwe.onMetis ? (
        <button className="lx-btn" onClick={() => void siwe.switchToMetis()}>
          Switch to Metis Sepolia
        </button>
      ) : (
        <button className="lx-btn" disabled={busy} onClick={onClaim}>
          {busy ? "Securing…" : "Secure plan ownership"}
        </button>
      )}
      {siwe.address && <div className="lxd-sub-addr mono">Connected: {short(siwe.address)}</div>}
    </div>
  );
}

function LimitsPanel(props: {
  plan: PlanView;
  founder: string;
  dailyCapUsd: string;
  setDailyCapUsd: (v: string) => void;
  durationDays: string;
  setDurationDays: (v: string) => void;
  busy: boolean;
  onReview: () => void;
}) {
  const { plan, founder, dailyCapUsd, setDailyCapUsd, durationDays, setDurationDays, busy, onReview } = props;
  return (
    <div className="lxd-panel">
      <div className="lxd-grid">
        <Field label="Total budget (fixed)"><span className="mono">${(Number(plan.totalBudgetBase) / 1e6).toFixed(2)} USDC</span></Field>
        <div className="lx-field" style={{ margin: 0 }}>
          <label className="lx-label">Daily payout limit (USDC)</label>
          <input className="lx-input" type="number" min="0.5" step="0.5" value={dailyCapUsd} onChange={(e) => setDailyCapUsd(e.target.value)} />
        </div>
        <div className="lx-field" style={{ margin: 0 }}>
          <label className="lx-label">Duration (days)</label>
          <input className="lx-input" type="number" min="1" max="90" step="1" value={durationDays} onChange={(e) => setDurationDays(e.target.value)} />
        </div>
        <Field label="Network"><span>Metis Sepolia (testnet)</span></Field>
        <Field label="Owner (you)"><span className="mono">{short(founder)}</span></Field>
        <Field label="Guardian"><span className="mono">{short(founder)}</span></Field>
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
            <Field label="Total budget"><span className="mono">${preview.totalBudgetHuman} USDC</span></Field>
            <Field label="Your balance">
              <span className="mono" style={{ color: preview.sufficientBalance ? "var(--lx-pos)" : "var(--lx-warn)" }}>
                ${preview.founderBalanceHuman} USDC
              </span>
            </Field>
            <Field label="Missions · completions">
              <span>{preview.missions.length} · {preview.missions.reduce((s, m) => s + Number(m.maxCompletions), 0)}</span>
            </Field>
            <Field label="Predicted vault"><span className="mono">{short(preview.predictedVault)}</span></Field>
            <Field label="Token approval"><span>Exactly ${preview.totalBudgetHuman} (never unlimited)</span></Field>
            <Field label="Wallet confirmations"><span>Up to 4 one-time setup signatures</span></Field>
          </div>

          {!preview.sufficientBalance && (
            <div className="lx-note">
              Your wallet is short ${preview.shortfallHuman} USDC to fund this campaign. Top up (or use the testnet
              faucet) and reload before continuing.
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
  const explorer = `https://sepolia-explorer.metisdevops.link/address/${dep.deployedVault ?? dep.predictedVault}`;
  return (
    <div className="lxd-panel lxd-live">
      <div className="lxd-live-badge" aria-hidden>✓</div>
      <div className="lx-h1" style={{ fontSize: 24 }}>Your campaign is live.</div>
      <div className="lxd-grid" style={{ marginTop: 12 }}>
        <Field label="Active missions"><span>{plan.missions.length} · {completions} completions</span></Field>
        <Field label="Funded"><span className="mono">${dep.totalBudgetHuman} USDC</span></Field>
        <Field label="Owner (you)"><span className="mono">{short(dep.founder)}</span></Field>
        <Field label="Sage operator"><span>Bounded payout role</span></Field>
        <Field label="Vault">
          <a className="lxd-link mono" href={explorer} target="_blank" rel="noopener noreferrer">{short(dep.deployedVault ?? dep.predictedVault)}</a>
        </Field>
        <Field label="Network"><span>Metis Sepolia</span></Field>
      </div>
      <div className="lxd-guarantee">Sage cannot withdraw these funds. It can only pay verified mission work within your limits.</div>
      {dep.attachedCampaignId && (
        <a className="lx-btn" href={`/c/${dep.attachedCampaignId}`} style={{ marginTop: 14, display: "inline-block", textDecoration: "none" }}>
          View tester mission board
        </a>
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
async function sendBatch(wallet: ReturnType<typeof useWallet>, calls: StepCall[]): Promise<string> {
  const client = wallet.getWalletClient();
  if (!client || !wallet.address) throw new Error("no wallet");
  const rpc = client.request as unknown as (a: { method: string; params: unknown[] }) => Promise<unknown>;
  const res = (await rpc({
    method: "wallet_sendCalls",
    params: [
      {
        version: "2.0.0",
        from: getAddress(wallet.address),
        chainId: `0x${metisSepolia.id.toString(16)}`,
        atomicRequired: true,
        calls: calls.map((c) => ({ to: getAddress(c.to), data: c.data, value: "0x0" })),
      },
    ],
  })) as { id?: string } | string;
  return typeof res === "string" ? res : (res.id ?? "0xbatch");
}
