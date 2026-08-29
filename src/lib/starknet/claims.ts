import "server-only";

import { Account, CallData, Contract, RpcProvider, cairo } from "starknet";

import ABI from "./claims-abi.json";
import { starknetAddresses, starknetConfig, type StarknetConfig } from "./config";

/**
 * THE STARKNET SETTLEMENT CLIENT.
 *
 * Two operations carry the product: Sage escrows a finished campaign's payouts in one transaction,
 * and Sage relays a worker's collection so the worker needs no gas. Everything else here is reads.
 *
 * WHAT THIS FILE MUST NEVER DO: decide an amount. Every figure arriving here was produced by the
 * deterministic budget compiler and is passed through in 6-decimal base units, the same units the
 * vault already settles in. There is no conversion step and no rounding — a number that changed on
 * the way to the chain would make the receipt a lie.
 */

export interface PayoutLeg {
  /** `poseidon(CLAIM_TAG, secret)`, as a decimal string. */
  claimCommitment: string;
  /** `poseidon(REFUND_TAG, secret)`, or null to make the payout irrevocable. */
  refundCommitment: string | null;
  /** USDC base units. Produced upstream; never computed here. */
  amountBase: bigint;
}

/**
 * The rules a batch must satisfy before it costs a transaction.
 *
 * Pure and exported so the reasoning is testable without a chain. The contract enforces all of this
 * too — this exists so a caller gets a sentence naming the problem instead of a felt panic, and so
 * a malformed batch never reaches a signer.
 */
export function validateBatch(
  legs: readonly PayoutLeg[],
  expiryUnix: number,
  nowSec: number = Math.floor(Date.now() / 1000),
): void {
  if (legs.length === 0) throw new Error("nothing to escrow");
  if (legs.length > MAX_BATCH) {
    throw new Error(`batch of ${legs.length} exceeds the ${MAX_BATCH}-leg limit`);
  }
  if (legs.some((l) => l.amountBase <= BigInt(0))) {
    throw new Error("every payout must be a positive amount");
  }

  if (new Set(legs.map((l) => l.claimCommitment)).size !== legs.length) {
    // The contract rejects the duplicate and reverts the whole batch. Catching it here names the
    // invariant, and a repeated commitment means two workers were handed the same link.
    throw new Error("two payouts in this batch share a claim commitment");
  }

  const refundable = legs.filter((l) => l.refundCommitment !== null).length;
  if (refundable !== 0 && refundable !== legs.length) {
    // The contract takes ONE expiry for the whole batch, so a mixed batch would silently give the
    // refundable legs an expiry and reject the rest.
    throw new Error("a batch must be entirely refundable or entirely irrevocable");
  }
  if (refundable > 0 && expiryUnix <= nowSec) {
    throw new Error("a refundable batch needs an expiry in the future");
  }
  if (refundable === 0 && expiryUnix !== 0) {
    throw new Error("an irrevocable batch must pass expiry 0");
  }
}

export interface EscrowResult {
  transactionHash: string;
  totalBase: bigint;
  count: number;
}

/** Legs per batch. Must match `MAX_BATCH` in claims.cairo. */
export const MAX_BATCH = 32;

function connect(cfg: StarknetConfig): { account: Account; provider: RpcProvider } {
  const provider = new RpcProvider({ nodeUrl: cfg.rpcUrl });
  const account = new Account({ provider, address: cfg.accountAddress, signer: cfg.privateKey });
  return { account, provider };
}

function requireConfig(): StarknetConfig {
  const cfg = starknetConfig();
  if (!cfg) throw new Error("Starknet settlement is not configured");
  return cfg;
}

/**
 * Escrow a batch of payouts, pulling their sum from Sage's account in the same transaction.
 *
 * The approve and the deposit go out as ONE multicall. Starknet executes them atomically, so there
 * is never a window in which Sage has granted an allowance that has not yet been consumed — a
 * standing allowance on a money contract is a liability with no upside.
 *
 * The expiry/refund rule is enforced here as well as in the contract, so a caller gets a sentence
 * instead of a felt panic: refund commitments and an expiry travel together, or neither does.
 */
export async function escrowPayouts(
  legs: readonly PayoutLeg[],
  expiryUnix: number,
): Promise<EscrowResult> {
  const cfg = requireConfig();

  validateBatch(legs, expiryUnix);

  const totalBase = legs.reduce((sum, l) => sum + l.amountBase, BigInt(0));
  const { account } = connect(cfg);

  const tx = await account.execute([
    {
      contractAddress: cfg.tokenAddress,
      entrypoint: "approve",
      calldata: CallData.compile({
        spender: cfg.claimsAddress,
        amount: cairo.uint256(totalBase),
      }),
    },
    {
      contractAddress: cfg.claimsAddress,
      entrypoint: "deposit_many",
      calldata: new CallData(ABI).compile("deposit_many", {
        legs: legs.map((l) => ({
          claim_commitment: l.claimCommitment,
          refund_commitment: l.refundCommitment ?? "0",
          amount: l.amountBase.toString(),
        })),
        expiry: expiryUnix.toString(),
        token: cfg.tokenAddress,
      }),
    },
  ]);

  return { transactionHash: tx.transaction_hash, totalBase, count: legs.length };
}

/**
 * Collect a worker's payout to an address they name, with Sage paying the gas.
 *
 * This is the point of the whole rail. `claim_to_address` is ungated in the contract because the
 * preimage is the authority, so anyone can submit it — which means a worker who holds no token,
 * has never used Starknet, and whose account is not even deployed can still be paid.
 *
 * Sage relaying it is a convenience, not a dependency: the same call works from any wallet, and a
 * worker who would rather not have Sage submit for them can do it themselves.
 */
export async function relayClaim(secret: string, recipient: string): Promise<string> {
  const cfg = requireConfig();
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(recipient)) {
    throw new Error(`not a Starknet address: ${recipient}`);
  }
  const { account } = connect(cfg);
  const tx = await account.execute([
    {
      contractAddress: cfg.claimsAddress,
      entrypoint: "claim_to_address",
      calldata: new CallData(ABI).compile("claim_to_address", { secret, recipient }),
    },
  ]);
  return tx.transaction_hash;
}

export interface OnChainClaim {
  exists: boolean;
  claimed: boolean;
  amountBase: bigint;
  expiry: number;
}

/**
 * The on-chain state of one claim.
 *
 * An unfunded commitment reads as `exists: false` rather than throwing, so the claim page can
 * answer "is this link real?" without spending a transaction to find out.
 */
export async function readClaim(claimCommitment: string): Promise<OnChainClaim> {
  // Reads use the PUBLIC config: asking whether a link is real is a public question about public
  // state, and gating it on the signing key would take the claim page down whenever the key is
  // absent — including on any deployment that only ever needs to read.
  const cfg = starknetAddresses();
  if (!cfg) throw new Error("Starknet settlement is not configured");
  const provider = new RpcProvider({ nodeUrl: cfg.rpcUrl });
  const contract = new Contract({ abi: ABI, address: cfg.claims, providerOrAccount: provider });
  const raw = (await contract.call("get_claim", [claimCommitment])) as {
    token: bigint;
    amount: bigint;
    expiry: bigint;
    claimed: boolean;
  };
  return {
    exists: BigInt(raw.token) !== BigInt(0),
    claimed: Boolean(raw.claimed),
    amountBase: BigInt(raw.amount),
    expiry: Number(raw.expiry),
  };
}

/** What the contract still owes in the settlement token — its liabilities, which its balance covers. */
export async function readOutstanding(): Promise<bigint> {
  const cfg = starknetAddresses();
  if (!cfg) throw new Error("Starknet settlement is not configured");
  const provider = new RpcProvider({ nodeUrl: cfg.rpcUrl });
  const contract = new Contract({ abi: ABI, address: cfg.claims, providerOrAccount: provider });
  return BigInt((await contract.call("get_outstanding", [cfg.token])) as bigint);
}
