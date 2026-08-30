import "server-only";

import { Account, CallData, Contract, RpcProvider, hash } from "starknet";

import ABI from "./vault-abi.json";
import { starknetAddresses, starknetConfig } from "./config";
import { classSupportsSplitPayout } from "./vault-capability";

/**
 * TALKING TO A CAMPAIGN'S VAULT ON STARKNET.
 *
 * Sage's side of the founder-owned vault. What this file can do is narrow on purpose: it asks a
 * vault to release a reward, and it reads state. It cannot fund, cannot add missions, cannot
 * withdraw — not because those calls are missing here, but because the contract refuses them from
 * the operator key. Writing them would produce a function that always reverts.
 *
 * THE AMOUNT IS ABSENT FROM EVERY CALL, and that is the point. `requestPayout` names a mission and
 * the vault looks up what it pays. There is no parameter for a caller to inflate, which is why
 * "no model ever computes a money amount" holds even if everything above this line is wrong.
 */

/** Mirrors `refusal` in vault.cairo. A payout returns a code rather than throwing. */
export const REFUSAL = {
  0: "paid",
  1: "the vault is not active",
  2: "not the operator key",
  3: "no such mission in the vault",
  4: "the recipient address is empty",
  5: "the payout is missing its decision or intent commitment",
  6: "this wallet was already paid for this mission",
  7: "every completion of this mission is already paid",
  8: "this authorisation has already settled",
  9: "the campaign's budget ceiling is reached",
  10: "the vault's daily payout cap is reached",
  11: "the vault does not hold enough to pay this",
} as const;

export type RefusalCode = keyof typeof REFUSAL;

export const refusalReason = (code: number): string =>
  REFUSAL[code as RefusalCode] ?? `refused (code ${code})`;

export interface VaultState {
  owner: string;
  operator: string;
  token: string;
  /** 0 = Paused, 1 = Active, 2 = Revoked — see VaultStatus in vault.cairo. */
  status: number;
  statusLabel: "paused" | "active" | "revoked" | "unknown";
  budgetCeilingBase: bigint;
  dailyCapBase: bigint;
  totalSpentBase: bigint;
  rollingDailySpendBase: bigint;
}

function readProvider(): RpcProvider {
  const cfg = starknetAddresses();
  if (!cfg) throw new Error("Starknet is not configured");
  return new RpcProvider({ nodeUrl: cfg.rpcUrl });
}

function operatorAccount(): { account: Account; provider: RpcProvider } {
  const cfg = starknetConfig();
  if (!cfg) throw new Error("Starknet settlement is not configured");
  const provider = new RpcProvider({ nodeUrl: cfg.rpcUrl });
  return {
    account: new Account({ provider, address: cfg.accountAddress, signer: cfg.privateKey }),
    provider,
  };
}

const STATUS: Record<number, VaultState["statusLabel"]> = {
  0: "paused",
  1: "active",
  2: "revoked",
};

/** Variant NAMES, in the order `vault.cairo` declares them — the index is the wire encoding. */
const STATUS_VARIANTS = ["Paused", "Active", "Revoked"] as const;

/**
 * Read a `VaultStatus` back off the chain.
 *
 * This used to answer 0 — "paused" — for anything that arrived as an object, and starknet.js
 * returns a Cairo enum as exactly that: a `CairoCustomEnum` holding `{ variant: { Active: {} } }`.
 * So EVERY vault read as paused, always, whatever it really was.
 *
 * That is not a display bug. Attach refuses a paused vault, so no founder could open a campaign on
 * a vault they had correctly funded; and the settlement pre-flight holds work on a paused vault, so
 * no payout could ever have been released either. One wrong branch closed the whole rail, and it
 * closed it in the shape of a sentence about the founder's vault being wrong.
 *
 * `Paused` is variant zero deliberately — an uninitialised slot must read as "pays nobody" — which
 * is exactly why guessing zero on an unrecognised shape is the wrong default: it is indistinguishable
 * from a real refusal. An unreadable status now returns -1 and surfaces as "unknown", which no
 * caller treats as permission.
 */
export function decodeVaultStatus(status: unknown): number {
  if (typeof status === "bigint" || typeof status === "number") return Number(status);
  if (typeof status === "object" && status !== null) {
    const withActive = status as { activeVariant?: () => string };
    if (typeof withActive.activeVariant === "function") {
      const i = STATUS_VARIANTS.indexOf(withActive.activeVariant() as (typeof STATUS_VARIANTS)[number]);
      if (i >= 0) return i;
    }
    // Older shapes expose the map directly: the live variant is the key that carries a value.
    const variant = (status as { variant?: Record<string, unknown> }).variant;
    if (variant) {
      for (const [name, value] of Object.entries(variant)) {
        if (value === undefined) continue;
        const i = STATUS_VARIANTS.indexOf(name as (typeof STATUS_VARIANTS)[number]);
        if (i >= 0) return i;
      }
    }
  }
  try {
    return Number(BigInt(status as bigint));
  } catch {
    return -1; // unreadable — never silently "paused", and never silently "active"
  }
}

export interface VaultPlanIdentity {
  campaignIdHash: string;
  missionPlanDigest: string;
}

export async function readVaultState(vaultAddress: string): Promise<VaultState> {
  const provider = readProvider();
  const c = new Contract({ abi: ABI, address: vaultAddress, providerOrAccount: provider });
  const [owner, operator, token, status, ceiling, daily, spent, rolling] = await Promise.all([
    c.call("get_owner", []),
    c.call("get_operator", []),
    c.call("get_token", []),
    c.call("get_status", []),
    c.call("get_budget_ceiling", []),
    c.call("get_daily_cap", []),
    c.call("get_total_spent", []),
    c.call("get_rolling_daily_spend", []),
  ]);
  const asHex = (v: unknown) => `0x${BigInt(v as bigint).toString(16)}`;
  const statusN = decodeVaultStatus(status);
  return {
    owner: asHex(owner),
    operator: asHex(operator),
    token: asHex(token),
    status: statusN,
    statusLabel: STATUS[statusN] ?? "unknown",
    budgetCeilingBase: BigInt(ceiling as bigint),
    dailyCapBase: BigInt(daily as bigint),
    totalSpentBase: BigInt(spent as bigint),
    rollingDailySpendBase: BigInt(rolling as bigint),
  };
}

/**
 * What the vault actually holds in the settlement token.
 *
 * Read from the TOKEN, not the vault, because the vault's own accounting cannot prove solvency:
 * `budget_ceiling` is a limit the owner set, and `total_spent` is what has left. Neither says
 * whether the money to honour the remaining work is present. Only the token's ledger does, and a
 * campaign attached to an unfunded vault would accept work it can never pay for.
 */
export async function readVaultBalance(vaultAddress: string): Promise<bigint> {
  const cfg = starknetAddresses();
  if (!cfg) throw new Error("Starknet is not configured");
  const provider = new RpcProvider({ nodeUrl: cfg.rpcUrl });
  const erc20 = new Contract({
    abi: [
      {
        type: "function",
        name: "balance_of",
        inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }],
        outputs: [{ type: "core::integer::u256" }],
        state_mutability: "view",
      },
    ],
    address: cfg.token,
    providerOrAccount: provider,
  });
  return BigInt((await erc20.call("balance_of", [vaultAddress])) as bigint);
}

export interface MissionTerms {
  exists: boolean;
  rewardBase: bigint;
  maxCompletions: number;
  paidCompletions: number;
}

/**
 * Decode what the chain returned for one mission.
 *
 * Separated from the call and made total on purpose. `decodeVaultStatus` had to learn this the
 * expensive way: it assumed a number, starknet.js handed it a CairoCustomEnum, `Number(object)`
 * came back NaN -> 0, and every vault read as "paused" — the whole rail closed. The shapes a
 * client returns for a Cairo type change between versions, so the safe assumption is that this
 * function will one day be handed something it has not seen.
 *
 * `Boolean(m.exists)` was the same trap waiting: `Boolean("0x0")` is TRUE, so a mission the vault
 * does not have would read as present. This runs at ATTACH, where the verdict decides whether a
 * founder's plan is backed by the vault they funded — a fabricated "exists" there means being told
 * a campaign is live when some of its missions can never pay.
 *
 * Unreadable THROWS rather than guessing, in either direction. The caller turns that into "could
 * not read the vault, try again", which is honest and recoverable; a guess is neither.
 */
export function decodeMissionTerms(raw: unknown): MissionTerms {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`mission was unreadable (${raw === null ? "null" : typeof raw})`);
  }
  const o = raw as Record<string, unknown>;
  const pick = (...names: string[]): unknown => {
    for (const n of names) if (o[n] !== undefined) return o[n];
    return undefined;
  };

  /** Cairo `bool` over the wire: a boolean, a 0/1 integer, or a hex string, depending on client. */
  const asBool = (v: unknown): boolean => {
    if (typeof v === "boolean") return v;
    if (typeof v === "bigint") return v !== BigInt(0);
    if (typeof v === "number" && Number.isFinite(v)) return v !== 0;
    if (typeof v === "string") {
      const t = v.trim().toLowerCase();
      if (t === "true" || t === "false") return t === "true";
      try {
        return BigInt(t) !== BigInt(0);
      } catch {
        throw new Error(`mission "exists" was unreadable ("${v.slice(0, 24)}")`);
      }
    }
    throw new Error(`mission "exists" was unreadable (${typeof v})`);
  };

  const asInt = (v: unknown, field: string): bigint => {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
    if (typeof v === "string" && v.trim()) {
      try {
        return BigInt(v.trim());
      } catch {
        /* fall through to the throw */
      }
    }
    throw new Error(`mission "${field}" was unreadable (${typeof v})`);
  };

  const exists = asBool(pick("exists"));
  if (!exists) {
    // A vault returns the zero struct for a mission it does not have. Nothing else is meaningful,
    // and reading zeros as terms would be inventing a $0 mission that is not there.
    return { exists: false, rewardBase: BigInt(0), maxCompletions: 0, paidCompletions: 0 };
  }
  return {
    exists: true,
    rewardBase: asInt(pick("reward", "rewardBase"), "reward"),
    maxCompletions: Number(asInt(pick("max_completions", "maxCompletions"), "max_completions")),
    paidCompletions: Number(asInt(pick("paid_completions", "paidCompletions"), "paid_completions")),
  };
}

export async function readMission(
  vaultAddress: string,
  missionId: string,
): Promise<MissionTerms> {
  const provider = readProvider();
  const c = new Contract({ abi: ABI, address: vaultAddress, providerOrAccount: provider });
  return decodeMissionTerms(await c.call("get_mission", [missionId]));
}

export interface PayoutResult {
  /** true only when the vault actually released the money. */
  paid: boolean;
  transactionHash: string;
  code: number;
  reason: string;
}

/**
 * Ask a campaign's vault to release one completion of a mission.
 *
 * NOTE WHAT IS NOT AN ARGUMENT: the amount. The vault derives it from the mission, so no caller —
 * including a compromised Sage — can pay more than the mission promised.
 *
 * The vault returns a refusal CODE rather than reverting, which means a refused payout still costs
 * a transaction and still lands on chain. That is deliberate on its side (the reason becomes
 * public), and it means this function must read the outcome from the receipt rather than assume a
 * successful transaction paid anyone.
 */
export interface PayoutArgs {
  vaultAddress: string;
  missionId: string;
  /** The WORKER: the vault's replay key and the name on the receipt. */
  recipient: string;
  /**
   * Where the money lands, when that is not the worker's own address.
   *
   * Only a vault whose CLASS has `request_payout_to` can do this, and asking one that cannot
   * reverts as an unknown selector. Callers decide the route from the class; this only encodes it.
   */
  payoutTarget?: string;
  decisionDigest: string;
  intentHash: string;
}

/** The exact call a payout sends. Shared, so a simulation cannot drift from the real thing.
 *  Exported for tests: WHICH entrypoint this picks decides whether a legacy vault can serve it. */
export function payoutCall(args: PayoutArgs) {
  const target = args.payoutTarget?.trim();
  // Same destination means the public entrypoint — which is the older one, so a legacy vault keeps
  // working unchanged and nothing has to know whether it could have split.
  if (!target || BigInt(target) === BigInt(args.recipient)) {
    return {
      contractAddress: args.vaultAddress,
      entrypoint: "request_payout",
      calldata: new CallData(ABI).compile("request_payout", {
        mission_id: args.missionId,
        recipient: args.recipient,
        decision_digest: args.decisionDigest,
        intent_hash: args.intentHash,
      }),
    };
  }
  return {
    contractAddress: args.vaultAddress,
    entrypoint: "request_payout_to",
    calldata: new CallData(ABI).compile("request_payout_to", {
      mission_id: args.missionId,
      worker: args.recipient,
      payout_target: target,
      decision_digest: args.decisionDigest,
      intent_hash: args.intentHash,
    }),
  };
}

/**
 * Which payout route a vault can serve, read from the class it was deployed from.
 *
 * A vault predating the split has no `request_payout_to`, and asking it reverts as an unknown
 * selector — on the settlement path, a cleared worker who cannot be paid. Unreadable counts as
 * "direct": the direction of that default pays someone publicly rather than stranding them.
 */
export async function payoutRouteFor(vaultAddress: string): Promise<"split" | "direct"> {
  try {
    const provider = readProvider();
    const classHash = await provider.getClassHashAt(vaultAddress);
    return classSupportsSplitPayout(String(classHash)) ? "split" : "direct";
  } catch {
    return "direct";
  }
}

export interface PayoutSimulation {
  /** would the vault release the money, as state stands right now? */
  wouldPay: boolean;
  code: number;
  reason: string;
  /** true when the call would revert outright rather than answer with a code. */
  reverted: boolean;
  error?: string;
}

/**
 * Ask the vault what it WOULD do, without asking it to do anything.
 *
 * An operator instrument, not part of settlement. It runs the real payout call against current
 * state and commits nothing, which is the only way to establish that this rail can pay before a
 * founder's money is the thing being tested: it proves the ABI compiles the call, the operator key
 * is the one the vault accepts, the mission exists under the felt settlement will look it up by,
 * and which refusal code — if any — the vault would answer with.
 *
 * DELIBERATELY NOT WIRED INTO SETTLEMENT. A refusal costing a transaction is the contract's
 * design, not an oversight: the reason lands on chain where the recipient can read it. Simulating
 * first to skip that would quietly make refusals private.
 */
export async function simulateVaultPayout(args: PayoutArgs): Promise<PayoutSimulation> {
  const { account } = operatorAccount();
  let trace: unknown;
  try {
    const sim = await account.simulateTransaction([
      { type: "INVOKE" as const, payload: [payoutCall(args)] },
    ]);
    // The RPC answers `{ simulated_transactions: [...] }`; older clients handed back the array
    // itself. Read both, because getting this wrong produces "the vault emitted neither outcome"
    // — a sentence that reads like a broken rail and means a broken reader.
    const r = sim as unknown as
      | { simulated_transactions?: { transaction_trace?: unknown }[] }
      | { transaction_trace?: unknown }[];
    trace = Array.isArray(r)
      ? r[0]?.transaction_trace
      : r.simulated_transactions?.[0]?.transaction_trace;
  } catch (e) {
    return {
      wouldPay: false,
      code: -1,
      reason: "the call would revert",
      reverted: true,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const events = collectEvents(trace);
  const released = hash.getSelectorFromName("PayoutReleased");
  const refused = hash.getSelectorFromName("PayoutRefused");
  const mine = events.filter((e) => BigInt(e.from_address) === BigInt(args.vaultAddress));
  const wouldPay = mine.some((e) => e.keys.some((k) => BigInt(k) === BigInt(released)));
  const refusal = mine.find((e) => e.keys.some((k) => BigInt(k) === BigInt(refused)));
  const code = refusal ? Number(BigInt(refusal.data[0] ?? 0)) : wouldPay ? 0 : -1;
  return {
    wouldPay,
    code,
    reason: code === -1 ? "the vault emitted neither outcome — read the trace" : refusalReason(code),
    reverted: false,
  };
}

/** Events from a simulation trace, which nests them by call rather than listing them flat. */
function collectEvents(trace: unknown): { from_address: string; keys: string[]; data: string[] }[] {
  const out: { from_address: string; keys: string[]; data: string[] }[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (Array.isArray(n.events)) {
      for (const e of n.events as Record<string, unknown>[]) {
        // A nested trace names the emitter `from_address`; some shapes omit it and inherit the
        // call's own contract. Fall back rather than dropping the event.
        const from = (e.from_address ?? n.contract_address) as string | undefined;
        if (from) {
          out.push({
            from_address: from,
            keys: ((e.keys as string[]) ?? []).map(String),
            data: ((e.data as string[]) ?? []).map(String),
          });
        }
      }
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  };
  walk(trace);
  return out;
}

export async function requestVaultPayout(args: PayoutArgs): Promise<PayoutResult> {
  const { account, provider } = operatorAccount();

  const tx = await account.execute([payoutCall(args)]);

  // Wait for execution, not just acceptance: `execute` resolves when the sequencer takes the
  // transaction, and a reverted one resolves just as happily.
  const receipt = (await provider.waitForTransaction(tx.transaction_hash)) as {
    execution_status?: string;
    events?: { from_address: string; keys: string[]; data: string[] }[];
  };
  if (receipt.execution_status && receipt.execution_status !== "SUCCEEDED") {
    throw new Error(`vault payout reverted on chain (${receipt.execution_status})`);
  }

  // THE TRANSACTION SUCCEEDING IS NOT THE PAYOUT SUCCEEDING. A refusal is a successful transaction
  // that emitted PayoutRefused and moved nothing, so the outcome is read from the events.
  const released = hash.getSelectorFromName("PayoutReleased");
  const refused = hash.getSelectorFromName("PayoutRefused");
  const mine = (receipt.events ?? []).filter(
    (e) => BigInt(e.from_address) === BigInt(args.vaultAddress),
  );
  const paid = mine.some((e) => e.keys.some((k) => BigInt(k) === BigInt(released)));
  const refusal = mine.find((e) => e.keys.some((k) => BigInt(k) === BigInt(refused)));
  const code = refusal ? Number(BigInt(refusal.data[0] ?? 0)) : 0;

  return {
    paid,
    transactionHash: tx.transaction_hash,
    code: paid ? 0 : code,
    reason: paid ? "paid" : refusalReason(code),
  };
}

/**
 * The founder-side calldata builders live in `./vault-calls`, which carries no `server-only` and
 * no credential, because they run in the founder's browser. Re-exported here so that the vault's
 * surface reads as one thing.
 */
export {
  addMissionCall,
  deployVaultCall,
  fundVaultCalls,
  planVaultDeployment,
  predictVaultAddress,
  saltForJob,
  vaultConstructorCalldata,
  UDC_ADDRESS,
} from "./vault-calls";
export type { PlannedMission, StarknetCall, VaultDeployment } from "./vault-calls";
