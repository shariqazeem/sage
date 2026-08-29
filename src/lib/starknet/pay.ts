import "server-only";

import { Account, CallData, RpcProvider, cairo } from "starknet";

import { starknetConfig } from "./config";

/**
 * DIRECT PAYMENT — the default, and what actually closes the loop.
 *
 * Someone who did the work and told Sage where they bank should not then have to go and *collect*
 * their money. The claim-link rail exists for the case where Sage has no address to pay: a person
 * invited by a link who has never held crypto. Whenever Sage does have an address — which is every
 * ordinary mission, gig and milestone, because `submissions.wallet` carries it — the money is sent
 * straight there and arrives with no action from them at all.
 *
 * This is the same shape Sage already settles in on GOAT, so the product's promise does not change
 * per chain: work is judged, and the payout lands.
 *
 * AMOUNTS ARE PASSED THROUGH, NEVER COMPUTED. Every figure originates in the deterministic budget
 * compiler in 6-decimal base units, which is exactly what USDC moves in on Starknet too — so there
 * is no conversion step anywhere on this path, and nothing to round.
 */

/** Legs per batch. Starknet multicalls are generous; this is a sanity bound, not a protocol limit. */
export const MAX_DIRECT_BATCH = 64;

export interface DirectPayment {
  /** The worker's own Starknet address, as recorded on their submission. */
  recipient: string;
  /** USDC base units, from the budget compiler. */
  amountBase: bigint;
}

export interface DirectPayResult {
  transactionHash: string;
  totalBase: bigint;
  count: number;
}

const isAddress = (v: string): boolean => /^0x[0-9a-fA-F]{1,64}$/.test(v);

/**
 * The rules a batch must satisfy before it costs a transaction. Pure, so the reasoning is testable
 * without a chain.
 */
export function validateDirectBatch(payments: readonly DirectPayment[]): bigint {
  if (payments.length === 0) throw new Error("nothing to pay");
  if (payments.length > MAX_DIRECT_BATCH) {
    throw new Error(`batch of ${payments.length} exceeds the ${MAX_DIRECT_BATCH}-payment limit`);
  }
  for (const p of payments) {
    if (!isAddress(p.recipient)) throw new Error(`not a Starknet address: ${p.recipient}`);
    if (p.amountBase <= BigInt(0)) throw new Error("every payment must be a positive amount");
  }
  // A repeated recipient is legitimate — one person can be paid for two missions — so it is NOT
  // rejected here. Deduplication belongs upstream, where it can tell "two payouts" from "the same
  // payout twice"; this layer cannot, and guessing would silently drop someone's money.
  return payments.reduce((sum, p) => sum + p.amountBase, BigInt(0));
}

/**
 * Pay one or many workers in a single transaction.
 *
 * Batching is not just an optimisation: one transaction for a whole campaign is a single fee and a
 * single receipt, which is what makes many small payouts economic at all. It is also what "net
 * settlement across multiple participants" means in practice.
 */
export async function payDirect(payments: readonly DirectPayment[]): Promise<DirectPayResult> {
  const cfg = starknetConfig();
  if (!cfg) throw new Error("Starknet settlement is not configured");

  const totalBase = validateDirectBatch(payments);
  const provider = new RpcProvider({ nodeUrl: cfg.rpcUrl });
  const account = new Account({
    provider,
    address: cfg.accountAddress,
    signer: cfg.privateKey,
  });

  const tx = await account.execute(
    payments.map((p) => ({
      contractAddress: cfg.tokenAddress,
      entrypoint: "transfer",
      calldata: CallData.compile({
        recipient: p.recipient,
        amount: cairo.uint256(p.amountBase),
      }),
    })),
  );

  return { transactionHash: tx.transaction_hash, totalBase, count: payments.length };
}

/** What Sage can currently pay out, in USDC base units. */
export async function payableBalance(): Promise<bigint> {
  const cfg = starknetConfig();
  if (!cfg) throw new Error("Starknet settlement is not configured");
  const provider = new RpcProvider({ nodeUrl: cfg.rpcUrl });
  const r = await provider.callContract({
    contractAddress: cfg.tokenAddress,
    entrypoint: "balanceOf",
    calldata: [cfg.accountAddress],
  });
  return (BigInt(r[1] ?? 0) << BigInt(128)) + BigInt(r[0] ?? 0);
}
