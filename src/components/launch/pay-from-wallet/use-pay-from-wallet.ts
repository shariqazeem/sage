"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useWallet } from "@/lib/wallet/use-wallet";
import { sameChainAddress } from "@/lib/campaigns/chain-address";
import { formatNative } from "@/lib/treasury/gas-policy";
import type { EmbeddedWallet } from "@/components/campaigns/embedded-wallet-bridge";
import type { PlanId } from "@/lib/plans/catalog";
import { OWN_WALLET_CHAIN_ID, OWN_WALLET_STEPS, type LegacyTx, type OwnWalletParams, type Shortfall } from "@/lib/own-wallet/plan";
import { browserOwnWalletIO, embeddedSender, injectedSender, type Eip1193 } from "@/lib/own-wallet/browser";
import { inspectOwnWalletLaunch, runOwnWalletLaunch, STEP_LABELS, type RunView, type StepView } from "@/lib/own-wallet/run";

/**
 * PAY FROM YOUR OWN WALLET, HEADLESS. The whole own-wallet launch as state and two actions, with no
 * markup: a page draws it however it likes (`PayFromWallet` beside this file is the plain version).
 *
 * It asks the server what this session may launch (and with which calls), reads the wallet's m.USDC and
 * METIS on Metis before anything is signed, walks create → approve → fund → activate with the wallet the
 * session signed in with, and has the server record the job once the chain shows it. A reload resumes from
 * the chain: a step already there is never sent again.
 *
 * WHICH WALLET SIGNS: the one the session IS. A MetaMask (or Rabby) sign-in signs with that injected
 * wallet; an email sign-in signs with its Privy embedded wallet (hand it in as `embedded`, from
 * `EmbeddedWalletBridge`). A wallet on another account is told which account to switch to, never used.
 */

/**
 * The Privy embedded wallet signs here only when this is "1". The path is built and its signed bytes are
 * checked before anything is broadcast, but it has not yet been run against a live Privy session on Metis;
 * until it has, an email sign-in is pointed at the account launch instead of at a door that may not open.
 */
export const embeddedPayEnabled = (): boolean => process.env.NEXT_PUBLIC_PAY_FROM_EMBEDDED?.trim() === "1";

export type PayPhase = "loading" | "signed-out" | "refused" | RunView["phase"];

export interface PayFromWalletApi {
  phase: PayPhase;
  chainId: number;
  network: "Metis";
  /** the wallet that pays: the session's own address */
  owner: string | null;
  /** this job's vault for that wallet, known before anything is sent */
  vault: string | null;
  /** which wallet will sign, once it is known to be the session's */
  walletKind: "injected" | "embedded" | null;
  budgetUsd: number | null;
  /** the wallet's balances on Metis, read before any signature */
  balances: { usdc: number; metis: string } | null;
  /** what the wallet is short of, each with the amount and where to get it */
  shortfalls: Shortfall[];
  /** the four steps with live status and transaction links */
  steps: StepView[];
  error: string | null;
  /** set with a plan-limit refusal: the plan that lifts it (null: none would) */
  upgradeTo: PlanId | null | undefined;
  campaignId: string | null;
  busy: boolean;
  /** approve the plan on screen (if it isn't yet) and send what is left; safe to call again after anything */
  pay: () => Promise<void>;
  /** read the wallet and the chain again (after adding money, say) */
  refresh: () => Promise<void>;
}

type Prepared =
  | { ok: true; stage: "live"; campaignId: string }
  | { ok: true; stage: "preview" | "ready"; params: OwnWalletParams }
  | { ok: false; status: number; error: string; reason?: string; upgradeTo?: PlanId | null };

const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;
const idleSteps = (): StepView[] => OWN_WALLET_STEPS.map((step) => ({ step, label: STEP_LABELS[step], status: "waiting", txHash: null, explorerUrl: null }));
const refusedSend = async (_tx: LegacyTx): Promise<`0x${string}`> => {
  throw new Error("read-only");
};

export function usePayFromWallet(opts: {
  jobId: string;
  /** the plan revision on screen: paying approves this one, and refuses if it changed elsewhere */
  revision?: number;
  /** the Privy embedded wallet, when the page mounts `EmbeddedWalletBridge` */
  embedded?: EmbeddedWallet | null;
  /** told once, when a launch made in this visit goes live */
  onLive?: (campaignId: string) => void;
}): PayFromWalletApi {
  const { jobId, revision, embedded, onLive } = opts;
  const wallet = useWallet();
  const [phase, setPhase] = useState<PayPhase>("loading");
  const [params, setParams] = useState<OwnWalletParams | null>(null);
  const [view, setView] = useState<RunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgradeTo, setUpgradeTo] = useState<PlanId | null | undefined>(undefined);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const prepare = useCallback(
    async (approve: boolean): Promise<Prepared> => {
      try {
        const res = await fetch(`/api/launch/${jobId}/wallet`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ approve, expectedRevision: approve ? revision : undefined, chainId: OWN_WALLET_CHAIN_ID }),
        });
        const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (res.ok && j.ok === true) return j as unknown as Prepared;
        return { ok: false, status: res.status, error: typeof j.error === "string" ? j.error : "Sage couldn't prepare this launch.", reason: typeof j.reason === "string" ? j.reason : undefined, upgradeTo: (j.upgradeTo as PlanId | null | undefined) ?? undefined };
      } catch {
        return { ok: false, status: 0, error: "Sage couldn't be reached. Nothing was sent; try again." };
      }
    },
    [jobId, revision],
  );

  /** Take the server's answer into state. Returns the params when there is something to inspect or run. */
  const absorb = useCallback((p: Prepared): OwnWalletParams | null => {
    if (!p.ok) {
      setUpgradeTo(p.reason === "plan_limit" ? (p.upgradeTo ?? null) : undefined);
      if (p.status === 401) {
        setPhase("signed-out");
        setError(null);
      } else if (p.status === 0 || p.status === 429 || p.status >= 500) {
        // not a refusal: the launch is still there to try again
        setPhase((was) => (was === "loading" ? "ready" : was));
        setError(p.error);
      } else {
        setPhase("refused");
        setError(p.error);
      }
      return null;
    }
    setUpgradeTo(undefined);
    if (p.stage === "live") {
      setCampaignId(p.campaignId);
      setPhase("live");
      setError(null);
      return null;
    }
    setParams(p.params);
    return p.params;
  }, []);

  const show = useCallback((v: RunView) => {
    setView(v);
    setPhase(v.phase);
    setError(v.error);
    if (v.campaignId) setCampaignId(v.campaignId);
  }, []);

  const refresh = useCallback(async () => {
    if (running.current) return;
    const p = absorb(await prepare(false));
    if (!p) return;
    try {
      show(await inspectOwnWalletLaunch(browserOwnWalletIO({ jobId, owner: p.owner, send: refusedSend }), p));
    } catch {
      // the chain could not be read: the launch is still offered, and paying reads it again
      setPhase("ready");
      setError("Sage couldn't read Metis just now. Try again in a moment.");
    }
  }, [absorb, prepare, show, jobId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** The wallet that may sign: the session's own, or the reason there isn't one. */
  const signer = useCallback(
    async (owner: string): Promise<{ send: (tx: LegacyTx) => Promise<`0x${string}`> } | { error: string }> => {
      if (embedded && sameChainAddress(embedded.address, owner)) {
        if (!embeddedPayEnabled()) {
          return { error: "Paying from the wallet your email sign-in holds isn't switched on yet. Launch this one from your Sage account, or sign in with MetaMask to pay from your wallet." };
        }
        const client = await embedded.getWalletClient(OWN_WALLET_CHAIN_ID);
        if (!client) return { error: "Your wallet couldn't be opened. Reload and try again; nothing was sent." };
        return { send: embeddedSender(client as unknown as Eip1193) };
      }
      const provider = wallet.getProvider();
      if (!provider) return { error: `You're signed in as ${short(owner)}. Open this page in the browser that holds that wallet to pay from it.` };
      const address = wallet.address ?? (await wallet.connect().catch(() => null));
      if (!address) return { error: "Connect your wallet to pay. Nothing was sent." };
      if (!sameChainAddress(address, owner)) {
        return { error: `Your wallet is on ${short(address)} and you're signed in as ${short(owner)}. Switch your wallet to ${short(owner)} to pay.` };
      }
      return { send: injectedSender(provider as unknown as Eip1193) };
    },
    [embedded, wallet],
  );

  const pay = useCallback(async () => {
    if (running.current) return; // a double click sends nothing twice
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const p = absorb(await prepare(true));
      if (!p) return;
      const s = await signer(p.owner);
      if ("error" in s) {
        setError(s.error);
        return;
      }
      const final = await runOwnWalletLaunch(browserOwnWalletIO({ jobId, owner: p.owner, send: s.send }), p, show);
      if (final.phase === "live" && final.campaignId) onLive?.(final.campaignId);
    } catch {
      setError("Something interrupted the launch. Nothing is lost; continue to pick up where the chain is.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [absorb, prepare, signer, show, jobId, onLive]);

  const owner = params?.owner ?? null;
  const walletKind: PayFromWalletApi["walletKind"] = !owner
    ? null
    : embedded && sameChainAddress(embedded.address, owner)
      ? "embedded"
      : wallet.address && sameChainAddress(wallet.address, owner)
        ? "injected"
        : null;

  return {
    phase,
    chainId: OWN_WALLET_CHAIN_ID,
    network: "Metis",
    owner,
    vault: params?.vault ?? null,
    walletKind,
    budgetUsd: params ? Number(BigInt(params.budgetBase)) / 10 ** params.tokenDecimals : null,
    balances: view?.balances ? { usdc: Number(view.balances.usdcBase) / 1e6, metis: formatNative(view.balances.nativeWei) } : null,
    shortfalls: view?.shortfalls ?? [],
    steps: view?.steps ?? idleSteps(),
    error,
    upgradeTo,
    campaignId,
    busy,
    pay,
    refresh,
  };
}
