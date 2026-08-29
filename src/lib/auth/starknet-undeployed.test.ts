import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * RECEIVING FUNDS DOES NOT DEPLOY A STARKNET ACCOUNT.
 *
 * An account is a contract, created by the wallet's own first OUTGOING transaction. So a wallet
 * can hold a real balance and still have no code at its address — which is exactly what happened
 * to a founder here: 1.97 STRK received, no account contract, and therefore no
 * `is_valid_signature` for any sign-in to call.
 *
 * My first version of this message told them to "receive any amount into it, or make one
 * transaction, and it deploys itself". They had already received. That advice would have sent them
 * in a circle — the failure mode of a helpful-sounding instruction that cannot work.
 */
describe("the undeployed-account guidance", () => {
  const route = readFileSync("src/app/api/auth/starknet/verify/route.ts", "utf8");

  it("never tells someone that receiving funds will deploy their account", () => {
    // The specific wrong advice, pinned so it cannot come back. The negated form — "receiving
    // funds does NOT deploy it" — is the correct sentence and must survive, so the check is for
    // the affirmative claim only.
    expect(route).not.toMatch(/receive any amount/i);
    const affirmative = /receiv\w*[^.]{0,40}?(?<!not )deploys? it/i;
    expect(route).not.toMatch(affirmative);
  });

  it("states the negation explicitly, because that is the misconception", () => {
    expect(route).toMatch(/RECEIVING FUNDS DOES NOT DEPLOY/i);
  });

  it("says what actually deploys an account: sending a transaction", () => {
    expect(route).toMatch(/SENDS its first transaction|sends? .{0,20}first transaction/i);
  });

  it("names the thing a person will look for in their wallet", () => {
    // Wallets label this "deploy" or "activate"; naming both is what makes it findable.
    expect(route).toMatch(/deploy or activate|activate/i);
  });

  it("still covers the wrong-network case, which looks identical from the server", () => {
    expect(route).toMatch(/different network/i);
  });
});
