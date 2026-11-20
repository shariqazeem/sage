import { explorerTxUrl } from "@/lib/deputy/networks";
import {
  legacyTx,
  OWN_WALLET_STEPS,
  ownWalletProgress,
  ownWalletShortfalls,
  type LegacyTx,
  type OwnWalletCall,
  type OwnWalletChainState,
  type OwnWalletParams,
  type OwnWalletStep,
  type Shortfall,
} from "./plan";

/**
 * THE LAUNCH, DRIVEN FROM THE BROWSER. No React and no wallet library: everything it touches arrives as
 * `OwnWalletIO`, so the same loop runs against MetaMask, a Privy embedded wallet, or a test's fake chain.
 *
 * One rule runs through it: THE CHAIN IS THE MEMORY. Before each step the chain is read again and the next
 * step is whatever it has not seen yet, so a reload, a second tab or a crash can't repeat one. The browser
 * remembers only transaction hashes (to show their links, and to wait for one still in flight instead of
 * sending it twice). And before the first signature of a visit, the wallet's m.USDC and METIS are checked
 * against what the steps still to send will take.
 */

export type TxStatus = "success" | "reverted" | "pending" | "unknown";

export interface OwnWalletIO {
  readState(params: OwnWalletParams): Promise<OwnWalletChainState>;
  estimateGas(from: `0x${string}`, call: OwnWalletCall): Promise<bigint>;
  /** the wallet signs and broadcasts one type-0 transaction; rejects when the person declines */
  send(tx: LegacyTx): Promise<`0x${string}`>;
  txStatus(hash: `0x${string}`): Promise<TxStatus>;
  waitFor(hash: `0x${string}`): Promise<"success" | "reverted">;
  /** the server's record door; it reads the chain itself */
  record(vault: `0x${string}`): Promise<{ ok: true; campaignId: string } | { ok: false; error: string; retry: boolean }>;
  /** transaction hashes this browser sent, per step */
  recall(step: OwnWalletStep): `0x${string}` | null;
  remember(step: OwnWalletStep, hash: `0x${string}` | null): void;
  sleep(ms: number): Promise<void>;
}

export type StepStatus = "waiting" | "sign" | "confirming" | "done" | "failed";

export interface StepView {
  step: OwnWalletStep;
  label: string;
  status: StepStatus;
  txHash: string | null;
  explorerUrl: string | null;
}

export type RunPhase = "ready" | "short" | "running" | "recording" | "live" | "stopped";

export interface RunView {
  phase: RunPhase;
  steps: StepView[];
  shortfalls: Shortfall[];
  balances: { usdcBase: bigint; nativeWei: bigint } | null;
  /** what went wrong on the last try, in words; the launch can be resumed */
  error: string | null;
  campaignId: string | null;
}

export const STEP_LABELS: Record<OwnWalletStep, string> = {
  create: "Create this test's vault",
  approve: "Approve the exact budget",
  fund: "Fund the vault",
  activate: "Activate it",
};

const SETTLE_TRIES = 12; // how long to wait for a node to show what a confirmed transaction did
const SETTLE_MS = 1500;

function stepsView(io: Pick<OwnWalletIO, "recall">, chainId: number, done: readonly OwnWalletStep[], active?: { step: OwnWalletStep; status: StepStatus }): StepView[] {
  return OWN_WALLET_STEPS.map((step) => {
    const hash = io.recall(step);
    const status: StepStatus = done.includes(step) ? "done" : active?.step === step ? active.status : "waiting";
    return { step, label: STEP_LABELS[step], status, txHash: hash, explorerUrl: hash ? explorerTxUrl(chainId, hash) : null };
  });
}

/** What a wallet's refusal reads as. A decline is an answer, not a failure. */
function sendError(e: unknown, step: OwnWalletStep): string {
  const code = (e as { code?: number } | null)?.code;
  const msg = e instanceof Error ? e.message : typeof (e as { message?: unknown } | null)?.message === "string" ? ((e as { message: string }).message) : "";
  if (code === 4001 || /user (rejected|denied)|rejected the request/i.test(msg)) return `You declined “${STEP_LABELS[step].toLowerCase()}”. Nothing was sent; your progress is saved.`;
  return `Your wallet didn't send “${STEP_LABELS[step].toLowerCase()}”${msg ? ` (${msg.slice(0, 160)})` : ""}. Nothing moved; try again.`;
}

/**
 * LOOK, DON'T TOUCH: where the launch stands and whether the wallet can pay for the rest. Signs nothing.
 * A transaction this browser sent that is still in flight shows as confirming.
 */
export async function inspectOwnWalletLaunch(io: OwnWalletIO, params: OwnWalletParams): Promise<RunView> {
  const budget = BigInt(params.budgetBase);
  const state = await io.readState(params);
  const balances = { usdcBase: state.usdcBase, nativeWei: state.nativeWei };
  const progress = ownWalletProgress(state, budget);
  if (progress.kind === "stopped") return { phase: "stopped", steps: stepsView(io, params.chainId, []), shortfalls: [], balances, error: progress.reason, campaignId: null };
  if (progress.kind === "complete") return { phase: "ready", steps: stepsView(io, params.chainId, progress.done), shortfalls: [], balances, error: null, campaignId: null };
  const inFlight = io.recall(progress.step);
  if (inFlight && (await io.txStatus(inFlight).catch(() => "unknown" as const)) === "pending") {
    return { phase: "ready", steps: stepsView(io, params.chainId, progress.done, { step: progress.step, status: "confirming" }), shortfalls: [], balances, error: null, campaignId: null };
  }
  const shortfalls = ownWalletShortfalls({ owner: params.owner, budgetBase: budget, token: params.token, tokenSymbol: params.tokenSymbol, state, remaining: progress.remaining });
  return { phase: shortfalls.length ? "short" : "ready", steps: stepsView(io, params.chainId, progress.done), shortfalls, balances, error: null, campaignId: null };
}

/**
 * RUN (OR RESUME) THE LAUNCH: create → approve → fund → activate, then ask the server to record it.
 * Returns when the job is live, when something stops it, or when the wallet is short. Safe to call again
 * at any point: it picks up from the chain.
 */
export async function runOwnWalletLaunch(io: OwnWalletIO, params: OwnWalletParams, onView: (v: RunView) => void): Promise<RunView> {
  const budget = BigInt(params.budgetBase);
  let balances: RunView["balances"] = null;
  let checkedFunds = false;
  const emit = (v: Omit<RunView, "balances">): RunView => {
    const view = { ...v, balances };
    onView(view);
    return view;
  };
  const stop = (done: readonly OwnWalletStep[], error: string, failed?: OwnWalletStep): RunView =>
    emit({ phase: "ready", steps: stepsView(io, params.chainId, done, failed ? { step: failed, status: "failed" } : undefined), shortfalls: [], error, campaignId: null });

  // Each pass sends at most one transaction; a launch is four. The bound only stops a loop that makes no progress.
  for (let pass = 0; pass < OWN_WALLET_STEPS.length * 3; pass++) {
    const state = await io.readState(params);
    balances = { usdcBase: state.usdcBase, nativeWei: state.nativeWei };
    const progress = ownWalletProgress(state, budget);
    if (progress.kind === "stopped") return emit({ phase: "stopped", steps: stepsView(io, params.chainId, []), shortfalls: [], error: progress.reason, campaignId: null });
    if (progress.kind === "complete") return record(io, params, emit);
    const { step, done, remaining } = progress;

    // A transaction this browser already sent for this step: wait for it. NEVER send the step again while
    // the first one may still land.
    const earlier = io.recall(step);
    if (earlier) {
      const status = await knownStatus(io, earlier);
      if (status === "pending" || status === "success") {
        emit({ phase: "running", steps: stepsView(io, params.chainId, done, { step, status: "confirming" }), shortfalls: [], error: null, campaignId: null });
        const outcome = status === "success" ? "success" : await io.waitFor(earlier);
        if (outcome === "success") {
          if (await settled(io, params, budget, step)) continue;
          // a receipt from an earlier visit that the chain no longer reflects (an approval since withdrawn)
          // must not block the step forever: forget it, send nothing now, and let the next try decide
          if (status === "success") io.remember(step, null);
          return stop(done, `“${STEP_LABELS[step]}” is confirmed, but Metis hasn't shown it yet. Nothing more was sent; try again in a minute.`);
        }
      }
      // reverted, or the network never saw it: it moved nothing, and the step is free to be sent again
      io.remember(step, null);
    }

    // BEFORE ANY SIGNATURE: does the wallet hold what the rest will take?
    if (!checkedFunds) {
      const shortfalls = ownWalletShortfalls({ owner: params.owner, budgetBase: budget, token: params.token, tokenSymbol: params.tokenSymbol, state, remaining });
      if (shortfalls.length) return emit({ phase: "short", steps: stepsView(io, params.chainId, done), shortfalls, error: null, campaignId: null });
      checkedFunds = true;
    }

    const call = params.calls.find((c) => c.step === step);
    if (!call) return stop(done, "This plan isn't approved yet, so there is nothing to sign.");

    let tx: LegacyTx;
    try {
      tx = legacyTx({ chainId: params.chainId, from: params.owner, call, gasEstimate: await io.estimateGas(params.owner, call), gasPriceWei: state.gasPriceWei });
    } catch (e) {
      const why = e instanceof Error ? e.message.slice(0, 160) : "";
      return stop(done, `Metis says “${STEP_LABELS[step].toLowerCase()}” would fail${why ? ` (${why})` : ""}, so it wasn't sent. Nothing moved.`, step);
    }

    emit({ phase: "running", steps: stepsView(io, params.chainId, done, { step, status: "sign" }), shortfalls: [], error: null, campaignId: null });
    let hash: `0x${string}`;
    try {
      hash = await io.send(tx);
    } catch (e) {
      return stop(done, sendError(e, step));
    }
    io.remember(step, hash);
    emit({ phase: "running", steps: stepsView(io, params.chainId, done, { step, status: "confirming" }), shortfalls: [], error: null, campaignId: null });

    let outcome: "success" | "reverted";
    try {
      outcome = await io.waitFor(hash);
    } catch {
      // still in flight: the hash is remembered, and the next visit waits for it instead of sending again
      return stop(done, `“${STEP_LABELS[step]}” was sent and Metis hasn't confirmed it yet. Nothing is lost; come back in a minute and continue.`);
    }
    if (outcome === "reverted") {
      io.remember(step, null);
      return stop(done, `“${STEP_LABELS[step]}” failed on Metis. Nothing moved beyond the network fee; try again.`, step);
    }
    if (!(await settled(io, params, budget, step))) {
      return stop(done, `“${STEP_LABELS[step]}” is confirmed, but Metis hasn't shown it yet. Nothing more was sent; try again in a minute.`);
    }
  }
  return stop([], "The launch isn't moving forward. Nothing more was sent; reload and continue.");
}

/** A transaction a node has not heard of may simply not have reached that node yet: ask a few times before believing it. */
async function knownStatus(io: OwnWalletIO, hash: `0x${string}`): Promise<TxStatus> {
  for (let i = 0; i < 3; i++) {
    const status = await io.txStatus(hash).catch(() => "unknown" as const);
    if (status !== "unknown") return status;
    await io.sleep(2000);
  }
  return "unknown";
}

/** A confirmed step counts once the chain READ shows it: a node a block behind must never cause a second send. */
async function settled(io: OwnWalletIO, params: OwnWalletParams, budget: bigint, step: OwnWalletStep): Promise<boolean> {
  for (let i = 0; i < SETTLE_TRIES; i++) {
    const progress = ownWalletProgress(await io.readState(params), budget);
    if (progress.kind !== "next" || progress.step !== step) return true;
    await io.sleep(SETTLE_MS);
  }
  return false;
}

async function record(io: OwnWalletIO, params: OwnWalletParams, emit: (v: Omit<RunView, "balances">) => RunView): Promise<RunView> {
  const steps = stepsView(io, params.chainId, OWN_WALLET_STEPS);
  emit({ phase: "recording", steps, shortfalls: [], error: null, campaignId: null });
  let last = "Sage couldn't record the job just now.";
  for (let i = 0; i < 4; i++) {
    const r = await io.record(params.vault).catch(() => ({ ok: false as const, error: "Sage couldn't be reached.", retry: true }));
    if (r.ok) return emit({ phase: "live", steps, shortfalls: [], error: null, campaignId: r.campaignId });
    last = r.error;
    if (!r.retry) break;
    await io.sleep(2500);
  }
  // the vault is funded and active on chain; only the record is missing, and asking again is safe
  return emit({ phase: "ready", steps, shortfalls: [], error: `${last} Your vault is funded and safe; continue to finish.`, campaignId: null });
}
