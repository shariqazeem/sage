import "server-only";

import { db } from "@/lib/db";
import { x402Payments } from "@/lib/db/schema";
import { OKX_ASSET, OKX_CHAIN_ID, type PaymentAuthorization } from "./okx";

/**
 * Claiming a payment, once.
 *
 * An EIP-3009 authorization is redeemable exactly once on-chain, so it must buy exactly one call
 * here. The nonce is the table's primary key and the INSERT is the claim: whoever inserts it first
 * gets the work, and a duplicate is a replay rather than a second purchase. Doing it this way means
 * two concurrent requests carrying the same authorization cannot both be served, which a
 * read-then-write check would allow.
 */

export type ClaimResult = { claimed: true } | { claimed: false; reason: string };

export function claimPayment(input: {
  nonce: string;
  tool: string;
  payer: string;
  payTo: string;
  auth: PaymentAuthorization;
  signature: string;
}): ClaimResult {
  try {
    const inserted = db
      .insert(x402Payments)
      .values({
        nonce: input.nonce,
        tool: input.tool,
        payer: input.payer,
        payTo: input.payTo,
        amount: input.auth.value,
        asset: OKX_ASSET,
        chainId: OKX_CHAIN_ID,
        validBefore: Number(input.auth.validBefore),
        signature: input.signature,
        authorizationJson: JSON.stringify(input.auth),
        createdAt: Date.now(),
      })
      .onConflictDoNothing()
      .run();
    if (inserted.changes === 0) {
      return {
        claimed: false,
        reason:
          "This payment authorization has already been used. Each one pays for a single call, so sign a new one to call again.",
      };
    }
    return { claimed: true };
  } catch (err) {
    // A storage failure must not silently become a free call, and must not become a false
    // accusation of replay either. Say which it is.
    return {
      claimed: false,
      reason: `Sage could not record the payment, so it did not run the call: ${
        err instanceof Error ? err.message : "storage error"
      }`,
    };
  }
}
