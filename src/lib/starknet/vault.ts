import "server-only";

import { Account, CallData, Contract, RpcProvider, hash } from "starknet";

import ABI from "./vault-abi.json";
import { starknetAddresses, starknetConfig } from "./config";

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
  // A Cairo enum reads back as its variant index.
  const statusN = Number(
    typeof status === "object" && status !== null && "variant" in status
      ? 0
      : BigInt(status as bigint),
  );
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

export async function readMission(
  vaultAddress: string,
  missionId: string,
): Promise<MissionTerms> {
  const provider = readProvider();
  const c = new Contract({ abi: ABI, address: vaultAddress, providerOrAccount: provider });
  const m = (await c.call("get_mission", [missionId])) as {
    reward: bigint;
    max_completions: bigint;
    paid_completions: bigint;
    exists: boolean;
  };
  return {
    exists: Boolean(m.exists),
    rewardBase: BigInt(m.reward),
    maxCompletions: Number(m.max_completions),
    paidCompletions: Number(m.paid_completions),
  };
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
export async function requestVaultPayout(args: {
  vaultAddress: string;
  missionId: string;
  recipient: string;
  decisionDigest: string;
  intentHash: string;
}): Promise<PayoutResult> {
  const { account, provider } = operatorAccount();

  const tx = await account.execute([
    {
      contractAddress: args.vaultAddress,
      entrypoint: "request_payout",
      calldata: new CallData(ABI).compile("request_payout", {
        mission_id: args.missionId,
        recipient: args.recipient,
        decision_digest: args.decisionDigest,
        intent_hash: args.intentHash,
      }),
    },
  ]);

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
