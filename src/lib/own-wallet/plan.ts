import { chainConfig, METIS_MAINNET_CHAIN_ID } from "@/lib/deputy/networks";
import { sameChainAddress } from "@/lib/campaigns/chain-address";
import { launchStepsFeeWei, needsFeeMessage, withHeadroom, type LaunchStep } from "@/lib/treasury/gas-policy";

/**
 * PAY FROM YOUR OWN WALLET, ON METIS (20 Nov 2026).
 *
 * From 1 Dec 2026 Metis counts only people who transact from a wallet they control. The Sage account is a
 * wallet Sage signs for, so a launch from it will not count; this is the same launch, signed by the
 * builder's own wallet instead. Everything here is PURE and runs in the browser and on the server alike:
 * what the wallet is asked to send, in what order, how each transaction is shaped for Metis, what to say
 * when the wallet is short, where a returning visitor resumes, and what a deployed vault must look like
 * before Sage calls the job live. No React, no network, no key.
 *
 * ONE NETWORK. This door exists on Metis (1088) and nowhere else.
 */
export const OWN_WALLET_CHAIN_ID = METIS_MAINNET_CHAIN_ID;

export const OWN_WALLET_STEPS = ["create", "approve", "fund", "activate"] as const satisfies readonly LaunchStep[];
export type OwnWalletStep = (typeof OWN_WALLET_STEPS)[number];

/** One call the wallet signs: exactly the call the account launch sends at the same position. */
export interface OwnWalletCall {
  step: OwnWalletStep;
  to: `0x${string}`;
  data: `0x${string}`;
  label: string;
}

/** What the server hands the browser for a plan the session owns. Every money-controlling value is the server's. */
export interface OwnWalletParams {
  chainId: number;
  /** the wallet that must sign: the session's own address */
  owner: `0x${string}`;
  /** the vault this owner and this plan produce (CREATE2), known before anything is sent */
  vault: `0x${string}`;
  factory: `0x${string}`;
  token: `0x${string}`;
  operator: `0x${string}`;
  /** the job's budget in token base units (6 dp), as a decimal string */
  budgetBase: string;
  tokenSymbol: string;
  tokenDecimals: number;
  calls: OwnWalletCall[];
}

/* ───────────────────────────────────────────── the network, for a wallet ── */

/** `wallet_addEthereumChain`'s parameters for Metis: what MetaMask needs to learn the network. */
export function metisAddChainParams(): {
  chainId: `0x${string}`;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: 18 };
  rpcUrls: string[];
  blockExplorerUrls: string[];
} {
  const c = chainConfig(OWN_WALLET_CHAIN_ID);
  return {
    chainId: `0x${OWN_WALLET_CHAIN_ID.toString(16)}`,
    chainName: "Metis Andromeda",
    nativeCurrency: { name: c.nativeName, symbol: c.nativeSymbol, decimals: 18 },
    // the public endpoint, never a server-side override: this string is handed to a wallet
    rpcUrls: ["https://andromeda.metis.io/?owner=1088"],
    blockExplorerUrls: [c.explorerUrl],
  };
}

/* ───────────────────────────────────────────── type 0, always, on Metis ── */

/** A transaction as the browser sends it on Metis: type 0, a gas price, a gas limit. Never EIP-1559 fields. */
export interface LegacyTx {
  type: "legacy";
  chainId: number;
  from: `0x${string}`;
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  gas: bigint;
  gasPrice: bigint;
}

/**
 * Shape one call for Metis. Metis rejects EIP-1559 (its node refuses a type-2 transaction before reading
 * it, measured 24 Oct 2026), so every transaction this door sends is type 0 with a gas price: the
 * network's own price and the node's own estimate, each with the 20% headroom the account launch uses.
 * Refuses any other chain rather than guessing how it prices.
 */
export function legacyTx(input: { chainId: number; from: `0x${string}`; call: Pick<OwnWalletCall, "to" | "data">; gasEstimate: bigint; gasPriceWei: bigint }): LegacyTx {
  if (input.chainId !== OWN_WALLET_CHAIN_ID || chainConfig(input.chainId).gas !== "legacy") {
    throw new Error(`paying from your own wallet runs on Metis only (asked for chain ${input.chainId})`);
  }
  if (input.gasEstimate <= BigInt(0) || input.gasPriceWei <= BigInt(0)) throw new Error("a transaction needs a gas estimate and a gas price");
  return {
    type: "legacy",
    chainId: input.chainId,
    from: input.from,
    to: input.call.to,
    data: input.call.data,
    value: BigInt(0),
    gas: withHeadroom(input.gasEstimate),
    gasPrice: withHeadroom(input.gasPriceWei),
  };
}

/** The same transaction as an EIP-1193 `eth_sendTransaction` parameter: `type: "0x0"`, `gasPrice`, no fee-market fields. */
export function legacyRpcTx(tx: LegacyTx, nonce?: number): Record<string, string> {
  const hex = (n: bigint | number): string => `0x${n.toString(16)}`;
  return {
    type: "0x0",
    from: tx.from,
    to: tx.to,
    data: tx.data,
    value: hex(tx.value),
    gas: hex(tx.gas),
    gasPrice: hex(tx.gasPrice),
    ...(nonce == null ? {} : { nonce: hex(nonce) }),
  };
}

/* ───────────────────────────────────────────── where a launch stands ───── */

/** A vault's lifecycle as the contract numbers it (ICampaignVault.VaultState). */
export const VAULT_STATES = ["created", "funded", "active", "paused", "revoked"] as const;
export type VaultStateName = (typeof VAULT_STATES)[number];

/** What the chain says about this owner and this vault right now. Read fresh before every step. */
export interface OwnWalletChainState {
  /** the predicted vault has code: the factory call landed */
  vaultExists: boolean;
  /** the vault's lifecycle; null while the vault does not exist */
  vaultState: VaultStateName | null;
  /** what the owner has approved the vault to pull, in base units */
  allowanceBase: bigint;
  /** the owner's m.USDC, in base units */
  usdcBase: bigint;
  /** the owner's METIS, in wei */
  nativeWei: bigint;
  /** the network's gas price now, in wei */
  gasPriceWei: bigint;
}

export type OwnWalletProgress =
  | { kind: "next"; step: OwnWalletStep; done: OwnWalletStep[]; remaining: OwnWalletStep[] }
  | { kind: "complete"; done: OwnWalletStep[] }
  | { kind: "stopped"; reason: string };

/**
 * RESUME FROM THE CHAIN, NEVER FROM MEMORY. Which step comes next is read from what the chain already
 * holds, so a reload, a second tab or a lost browser can never repeat a step:
 * - the vault has code: it was created;
 * - the vault is past `created`: it was funded (fund is owner-only and moves the whole budget at once),
 *   so it is NEVER funded again, whatever the allowance says;
 * - the allowance covers the budget, or the funding already happened: the approval is done;
 * - the vault is `active`: there is nothing left to send.
 */
export function ownWalletProgress(state: Pick<OwnWalletChainState, "vaultExists" | "vaultState" | "allowanceBase">, budgetBase: bigint): OwnWalletProgress {
  if (!state.vaultExists) return { kind: "next", step: "create", done: [], remaining: [...OWN_WALLET_STEPS] };
  const s = state.vaultState;
  if (s === null) return { kind: "stopped", reason: "Sage could not read this job's vault. Nothing was sent; try again in a moment." };
  if (s === "revoked") return { kind: "stopped", reason: "This job's vault was closed from your wallet, so it can't go live. Start a new test to launch again." };
  if (s === "paused") return { kind: "stopped", reason: "This job's vault is paused from your wallet. Unpause it to go on." };
  if (s === "active") return { kind: "complete", done: [...OWN_WALLET_STEPS] };
  if (s === "funded") return { kind: "next", step: "activate", done: ["create", "approve", "fund"], remaining: ["activate"] };
  // created, not funded yet
  if (state.allowanceBase >= budgetBase) return { kind: "next", step: "fund", done: ["create", "approve"], remaining: ["fund", "activate"] };
  return { kind: "next", step: "approve", done: ["create"], remaining: ["approve", "fund", "activate"] };
}

/* ───────────────────────────────────────────── short of something ──────── */

export interface Shortfall {
  what: "usdc" | "fee";
  /** how much more is needed, in the token's smallest unit */
  missing: bigint;
  message: string;
}

const usd = (base: bigint): string => (Number(base) / 1e6).toFixed(2);
const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * BEFORE ANY SIGNATURE: is the wallet holding what the steps still to send will take? Each shortfall says
 * exactly what is missing, by how much and where to get it. The budget is only needed while the vault is
 * unfunded; the fee is the remaining steps' (a whole launch asks for the chain's launch floor, as the
 * account launch does).
 */
export function ownWalletShortfalls(input: { owner: string; budgetBase: bigint; token: string; tokenSymbol: string; state: OwnWalletChainState; remaining: readonly OwnWalletStep[] }): Shortfall[] {
  const c = chainConfig(OWN_WALLET_CHAIN_ID);
  const out: Shortfall[] = [];
  if (input.remaining.includes("fund") && input.state.usdcBase < input.budgetBase) {
    const missing = input.budgetBase - input.state.usdcBase;
    out.push({
      what: "usdc",
      missing,
      message: `Your wallet holds ${usd(input.state.usdcBase)} ${input.tokenSymbol} on ${c.name} and this test needs ${usd(input.budgetBase)}. Add ${usd(missing)} ${input.tokenSymbol} to ${short(input.owner)} on the ${c.name} network (the token is ${input.token}).`,
    });
  }
  const needWei = launchStepsFeeWei(OWN_WALLET_CHAIN_ID, input.remaining, input.state.gasPriceWei);
  if (input.state.nativeWei < needWei) {
    out.push({
      what: "fee",
      missing: needWei - input.state.nativeWei,
      message: needsFeeMessage({ chainId: OWN_WALLET_CHAIN_ID, action: "launch", needWei, haveWei: input.state.nativeWei, nativeSymbol: c.nativeSymbol, network: c.name, holder: "wallet" }),
    });
  }
  return out;
}

/* ───────────────────────────────────────────── is this vault the plan's? ─ */

/** What the approved plan compiles to: the only values a recorded vault may carry. */
export interface ExpectedVault {
  chainId: number;
  /** the session's own wallet: it must have created the vault and funded it */
  owner: string;
  vault: string;
  factory: string;
  operator: string;
  guardian: string;
  token: string;
  campaignIdHash: string;
  budgetBase: bigint;
  dailyVelocityCap: bigint;
  durationSeconds: bigint;
  missions: { missionIdHash: string; rewardBase: bigint; maxCompletions: bigint }[];
}

/** What the chain reports for that vault. Read by the server, from its own node; never supplied by a client. */
export interface VaultFacts {
  chainId: number;
  hasCode: boolean;
  /** the factory's own registry: who created this vault through it (zero address when it did not) */
  factoryOwner: string;
  /** the vault the factory holds for this owner and this campaign id */
  factoryCampaignVault: string;
  owner: string;
  operator: string;
  guardian: string;
  token: string;
  campaignIdHash: string;
  budgetCeiling: bigint;
  dailyVelocityCap: bigint;
  /** expiry minus activation, in seconds; null before activation */
  durationSeconds: bigint | null;
  state: VaultStateName;
  /** the vault's own balance of the settlement token */
  balanceBase: bigint;
  totalSpentBase: bigint;
  missionCount: number;
  missions: Record<string, { exists: boolean; rewardBase: bigint; maxCompletions: bigint }>;
}

export type VaultMismatch =
  | "wrong_chain"
  | "no_vault"
  | "not_from_factory"
  | "not_this_campaign"
  | "funder_not_you"
  | "operator"
  | "guardian"
  | "token"
  | "campaign_id"
  | "budget"
  | "daily_cap"
  | "duration"
  | "mission_count"
  | "mission_missing"
  | "mission_reward"
  | "mission_places"
  | "underfunded"
  | "not_active";

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * THE RECORD DOOR'S JUDGMENT. A vault is called live only when the chain itself says, field by field,
 * that it is the vault this plan compiles to:
 * - the factory created it, for this owner and this campaign (its registry, not an event a client names);
 * - its owner is the session's wallet. `fund` and `activate` are owner-only in the contract, so a vault
 *   that is funded and active was funded and activated BY that wallet: the funder is the session;
 * - operator (Sage's Metis operator), guardian, token, campaign id, budget, daily cap, duration and every
 *   mission's reward and places equal the compiled plan, and it carries no mission the plan does not;
 * - it holds the whole unspent budget, and it is active.
 * Pure; returns every mismatch, so a refusal names all of what is wrong.
 */
export function verifyOwnWalletVault(expected: ExpectedVault, facts: VaultFacts): { ok: true } | { ok: false; mismatches: VaultMismatch[] } {
  const m = new Set<VaultMismatch>();
  const same = sameChainAddress;
  if (expected.chainId !== OWN_WALLET_CHAIN_ID || facts.chainId !== expected.chainId) m.add("wrong_chain");
  if (!facts.hasCode) return { ok: false, mismatches: [...m, "no_vault"] };
  if (same(facts.factoryOwner, ZERO) || !facts.factoryOwner) m.add("not_from_factory");
  if (!same(facts.factoryCampaignVault, expected.vault)) m.add("not_this_campaign");
  if (!same(facts.owner, expected.owner) || !same(facts.factoryOwner, expected.owner)) m.add("funder_not_you");
  if (!same(facts.operator, expected.operator) || same(facts.operator, facts.owner)) m.add("operator");
  if (!same(facts.guardian, expected.guardian)) m.add("guardian");
  if (!same(facts.token, expected.token)) m.add("token");
  if (facts.campaignIdHash.toLowerCase() !== expected.campaignIdHash.toLowerCase()) m.add("campaign_id");
  // THE INVARIANT, on chain: the ceiling is Σ(reward × places), and it is the approved budget exactly.
  const planned = expected.missions.reduce((a, x) => a + x.rewardBase * x.maxCompletions, BigInt(0));
  if (planned !== expected.budgetBase || facts.budgetCeiling !== expected.budgetBase) m.add("budget");
  if (facts.dailyVelocityCap !== expected.dailyVelocityCap) m.add("daily_cap");
  if (facts.durationSeconds !== null && facts.durationSeconds !== expected.durationSeconds) m.add("duration");
  if (facts.missionCount !== expected.missions.length) m.add("mission_count");
  for (const x of expected.missions) {
    const on = facts.missions[x.missionIdHash.toLowerCase()];
    if (!on || !on.exists) {
      m.add("mission_missing");
      continue;
    }
    if (on.rewardBase !== x.rewardBase) m.add("mission_reward");
    if (on.maxCompletions !== x.maxCompletions) m.add("mission_places");
  }
  if (facts.balanceBase + facts.totalSpentBase < expected.budgetBase) m.add("underfunded");
  if (facts.state !== "active" || facts.durationSeconds === null) m.add("not_active");
  return m.size === 0 ? { ok: true } : { ok: false, mismatches: [...m] };
}

const MISMATCH_WORDS: Record<VaultMismatch, string> = {
  wrong_chain: "it is not on Metis",
  no_vault: "there is no vault at this job's address yet",
  not_from_factory: "Sage's vault factory did not create it",
  not_this_campaign: "it is not the vault the factory holds for this job",
  funder_not_you: "it was not created and funded by the wallet you are signed in with",
  operator: "its operator is not Sage's Metis operator",
  guardian: "its guardian is not your wallet",
  token: "it does not pay in m.USDC",
  campaign_id: "it belongs to a different job",
  budget: "its budget is not this job's budget",
  daily_cap: "its daily limit is not this job's",
  duration: "its duration is not this job's",
  mission_count: "it carries a different number of missions",
  mission_missing: "a mission of this job is missing from it",
  mission_reward: "a mission pays a different reward",
  mission_places: "a mission has a different number of places",
  underfunded: "it does not hold the whole budget",
  not_active: "it has not been activated",
};

/** One sentence naming everything that is wrong with a vault, for the person who tried to record it. */
export function vaultRefusal(mismatches: readonly VaultMismatch[]): string {
  return `Sage can't call this job live: ${mismatches.map((x) => MISMATCH_WORDS[x]).join("; ")}. Nothing was recorded, and whatever your wallet put in the vault is still yours to withdraw.`;
}
