import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import { attestationChallenge } from "./route";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const account = privateKeyToAccount(KEY);

/**
 * The challenge is what stops the attestation endpoint being a binary-search oracle. If a single
 * signature worked for every floor, an attacker with one signed message could walk the floor down
 * and recover the exact income the record was redacted to hide.
 */
describe("the attestation challenge", () => {
  it("binds the wallet AND the floor, so a signature cannot be replayed at another floor", () => {
    const at = 1_756_000_000;
    const w = account.address;
    expect(attestationChallenge(w, 500, at)).not.toBe(attestationChallenge(w, 250, at));
    expect(attestationChallenge(w, 500, at)).not.toBe(attestationChallenge(w, null, at));
    // ...and not across wallets either.
    expect(attestationChallenge(w, 500, at)).not.toBe(
      attestationChallenge("0x00000000000000000000000000000000000000bb", 500, at),
    );
  });

  it("binds the time, so an old signature goes stale", () => {
    const w = account.address;
    expect(attestationChallenge(w, 500, 1_000)).not.toBe(attestationChallenge(w, 500, 2_000));
  });

  it("is case-insensitive about the wallet, so a checksummed address still verifies", () => {
    const at = 1_756_000_000;
    expect(attestationChallenge(account.address.toUpperCase(), 500, at)).toBe(
      attestationChallenge(account.address.toLowerCase(), 500, at),
    );
  });

  it("states plainly what is being agreed to", () => {
    const msg = attestationChallenge(account.address, 500, 1_756_000_000);
    // A person approving this in a wallet UI must be able to read what it authorises.
    expect(msg).toContain("Sage earnings attestation");
    expect(msg).toContain("at least $500.00");
    expect(msg).toContain(account.address.toLowerCase());
  });

  it("round-trips through a real wallet signature", async () => {
    const { verifyMessage } = await import("viem");
    const at = Math.floor(Date.now() / 1000);
    const message = attestationChallenge(account.address, 500, at);
    const signature = await account.signMessage({ message });

    expect(
      await verifyMessage({ address: account.address, message, signature }),
    ).toBe(true);

    // The same signature must NOT verify against a lower floor — that is the oracle defence.
    expect(
      await verifyMessage({
        address: account.address,
        message: attestationChallenge(account.address, 250, at),
        signature,
      }),
    ).toBe(false);
  });
});
