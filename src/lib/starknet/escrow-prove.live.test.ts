import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { escrowPayouts, readClaim } from "./claims";
import { claimUrl, mintClaimSecrets } from "./claim-link";

/**
 * THE ONE-SHOT MAINNET PROOF that Sage can escrow a payout behind a claim commitment.
 *
 * COMMITS REAL USDC. Guarded by ESCROW_PROVE=1 so it can never run as a side effect of any other
 * suite, and separate from `escrow-dryrun.live` which commits nothing.
 *
 * THE SECRETS ARE WRITTEN TO DISK BEFORE THE TRANSACTION, and the run aborts if that write fails.
 * A claim is opened by its preimage and by nothing else: lose the claim secret and the money is
 * collectable by nobody; lose the refund secret and it cannot be recovered after expiry either. A
 * proof that "succeeded" and printed its secrets into a terminal nobody kept is a stranded payout.
 *
 * It also ends somewhere useful: a real, uncollected claim link, so the shielded collect path can
 * be exercised for real rather than described.
 *
 *   ESCROW_PROVE=1 npx vitest run escrow-prove.live
 */

const LIVE = process.env.ESCROW_PROVE === "1";
/** Ten cents. Override with ESCROW_PROVE_BASE for a different amount. */
const AMOUNT = BigInt(process.env.ESCROW_PROVE_BASE ?? "100000");

describe.skipIf(!LIVE)("escrowing a real payout", () => {
  it("escrows, and leaves a claim that reads back on chain", async () => {
    const secrets = mintClaimSecrets();
    const expiry = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;

    // ── persist FIRST; if this throws, nothing has moved ───────────────────────
    const dir = `${process.env.HOME}/sage-claim-secrets`;
    mkdirSync(dir, { recursive: true });
    const file = `${dir}/escrow-proof-${expiry}.json`;
    writeFileSync(
      file,
      JSON.stringify(
        {
          ...secrets,
          amountBase: AMOUNT.toString(),
          expiry,
          note: "escrowPayouts mainnet proof. claimSecret opens the money; refundSecret recovers it after expiry.",
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(`secrets written to ${file}`);
    console.log(`  claimCommitment  ${secrets.claimCommitment}`);

    // Untouched before the deposit — proves the claim did not exist beforehand, so what we read
    // afterwards is this transaction's doing and not something already on chain.
    const before = await readClaim(secrets.claimCommitment);
    console.log(`  before: exists=${before.exists} claimed=${before.claimed} amount=${before.amountBase}`);
    expect(before.exists).toBe(false);

    console.log(`escrowing ${AMOUNT} base units (${Number(AMOUNT) / 1e6} USDC)…`);
    const result = await escrowPayouts(
      [
        {
          claimCommitment: secrets.claimCommitment,
          refundCommitment: secrets.refundCommitment,
          amountBase: AMOUNT,
        },
      ],
      expiry,
    );
    console.log(`  tx ${result.transactionHash} · total ${result.totalBase} · legs ${result.count}`);

    // escrowPayouts now waits for execution, so by here the deposit has actually run. Before that
    // fix this read raced the transaction and reported a claim that did not exist yet.
    const after = await readClaim(secrets.claimCommitment);
    console.log(`  after:  exists=${after.exists} claimed=${after.claimed} amount=${after.amountBase} expiry=${after.expiry}`);
    expect(after.exists).toBe(true);
    expect(after.claimed).toBe(false);
    expect(after.amountBase).toBe(AMOUNT);

    console.log(`\nCLAIM LINK (this is the money):\n  ${claimUrl("https://sagepays.xyz", secrets.claimSecret)}`);
    console.log(`refundable after ${new Date(expiry * 1000).toISOString()} with the refundSecret in ${file}`);
  }, 300_000);
});
