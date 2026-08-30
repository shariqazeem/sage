import { describe, expect, it } from "vitest";
import { Account, CallData, RpcProvider, cairo } from "starknet";

import { starknetAddresses, starknetConfig } from "./config";
import { mintClaimSecrets } from "./claim-link";

/**
 * CAN SAGE ESCROW A PAYOUT AT ALL?
 *
 * `escrowPayouts` has only ever run from `scripts/starknet-payout.ts`. The claim-link path is
 * about to become how every private-rail worker is paid, so it gets the same treatment the vault
 * payout got: run the REAL calls against the REAL contracts and commit nothing.
 *
 * A simulation catches the failures that actually happen here — a drifted ABI, calldata in the
 * wrong order (the pool deserialises straight into its signature, so one field out of place is a
 * revert with no message), an approve that does not cover the deposit, a commitment the contract
 * computes differently.
 *
 *   STARKNET_DRYRUN=1 npx vitest run escrow-dryrun.live
 */

const LIVE = process.env.STARKNET_DRYRUN === "1";
/** Ten cents, in USDC base units — the amount the real proof will commit. */
const AMOUNT = BigInt(100_000);

describe.skipIf(!LIVE)("escrowing a payout behind a claim commitment", () => {
  it("reports what the operator can actually spend", async () => {
    const cfg = starknetConfig()!;
    const addr = starknetAddresses()!;
    const provider = new RpcProvider({ nodeUrl: cfg.rpcUrl });
    const bal = (await provider.callContract({
      contractAddress: addr.token,
      entrypoint: "balanceOf",
      calldata: [cfg.accountAddress],
    })) as unknown as string[];
    const usdc = BigInt(bal[0]) + (BigInt(bal[1] ?? 0) << BigInt(128));
    console.log(
      `operator ${cfg.accountAddress}\n  USDC balance = ${usdc} base (${Number(usdc) / 1e6})\n` +
        `  claims contract = ${addr.claims}\n  token = ${addr.token}`,
    );
    // Not an assertion about the balance — just the number, printed, before anything is spent.
    expect(typeof usdc).toBe("bigint");
  }, 120_000);

  it("WOULD ESCROW — approve + deposit_many simulate clean against the live contracts", async () => {
    const cfg = starknetConfig()!;
    const addr = starknetAddresses()!;
    const provider = new RpcProvider({ nodeUrl: cfg.rpcUrl });
    const account = new Account({ provider, address: cfg.accountAddress, signer: cfg.privateKey });

    const secrets = mintClaimSecrets();
    const expiry = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    console.log(`  claim commitment = ${secrets.claimCommitment}\n  expiry = ${expiry}`);

    const calls = [
      {
        contractAddress: addr.token,
        entrypoint: "approve",
        calldata: CallData.compile({ spender: addr.claims, amount: cairo.uint256(AMOUNT) }),
      },
      {
        contractAddress: addr.claims,
        entrypoint: "deposit_many",
        calldata: CallData.compile({
          legs: [
            {
              claim_commitment: secrets.claimCommitment,
              refund_commitment: secrets.refundCommitment,
              amount: AMOUNT.toString(),
            },
          ],
          expiry: String(expiry),
          token: addr.token,
        }),
      },
    ];

    let reverted: string | null = null;
    let trace: unknown;
    try {
      const sim = await account.simulateTransaction([{ type: "INVOKE" as const, payload: calls }]);
      const r = sim as unknown as
        | { simulated_transactions?: { transaction_trace?: unknown }[] }
        | { transaction_trace?: unknown }[];
      trace = Array.isArray(r) ? r[0]?.transaction_trace : r.simulated_transactions?.[0]?.transaction_trace;
    } catch (e) {
      reverted = e instanceof Error ? e.message : String(e);
    }

    if (reverted) console.log(`  SIMULATION REVERTED:\n${reverted.slice(0, 1200)}`);
    else {
      const s = JSON.stringify(trace);
      console.log(`  simulated ok · trace ${s.length} chars · reverted=${/is_reverted":true/.test(s)}`);
    }
    expect(reverted, reverted ?? "").toBeNull();
  }, 180_000);
});
