import { describe, expect, it } from "vitest";
import { readStarknetSnapshot } from "./vault-adapter";
import { starknetKnownVaultClasses, starknetVaultClassHash } from "./config";

/**
 * LIVE: the vault that predates the privacy class must still be recognised as Sage's.
 *   STARKNET_PROVENANCE_LIVE=1 npx vitest run known-classes.live   (VM: real env, real chain)
 */
const LIVE = process.env.STARKNET_PROVENANCE_LIVE === "1";
const OLD_VAULT = "0xd39db387767383af7be6a90d4bf394abf9d7f63db109056d5b30798a6f7e2e"; // the live sagepays.xyz gig's vault

describe.skipIf(!LIVE)("provenance across declared classes (live)", () => {
  it("the previous-class vault is recognised while the deploy target is the privacy class", async () => {
    const known = starknetKnownVaultClasses();
    expect(known.length).toBeGreaterThanOrEqual(2);
    const snap = await readStarknetSnapshot(OLD_VAULT as never, 900001, []);
    expect(snap.factoryRecognizes).toBe(true);
    // and it is recognised through the PREVIOUS entry, not by accident of the target
    expect(BigInt(starknetVaultClassHash() as string)).toBe(BigInt("0x6d55773e63601dfbd861c78e03c5ac3085b472d7c067d9c5634da03a00b5aa0"));
  }, 60_000);
});
