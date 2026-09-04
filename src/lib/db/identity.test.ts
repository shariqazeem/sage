import { describe, expect, it } from "vitest";
import { identityCount, identityFor, recordIdentityProof } from "./identity";
import { linkedWalletsOf } from "@/lib/campaigns/wallet-links";
import { standingOf } from "@/lib/identity/standing";

/**
 * The whole value of a personhood proof is the nullifier's stability: the same human proving from a
 * second wallet is not a second worker. These are the two cases that decide whether the farm works.
 */
const W = (n: string) => `0x${n.repeat(40)}`;

describe("personhood proofs collapse one person's wallets", () => {
  it("an honest first verification stands the wallet up, alone", () => {
    const r = recordIdentityProof({ wallet: W("a"), provider: "worldid", nullifier: "0xperson-one", level: "orb" });
    expect(r.alsoTheirs).toEqual([]);
    expect(identityFor(W("a"))?.nullifier).toBe("0xperson-one");
    expect(standingOf(W("a")).tier).toBe("established");
  });

  it("THE SAME PERSON FROM A SECOND WALLET IS LINKED, and both drop to flagged", () => {
    recordIdentityProof({ wallet: W("b"), provider: "worldid", nullifier: "0xperson-two", level: "orb" });
    const second = recordIdentityProof({ wallet: W("c"), provider: "worldid", nullifier: "0xperson-two", level: "orb" });
    expect(second.alsoTheirs.map((w) => w.toLowerCase())).toContain(W("b"));
    // linked exactly as an on-chain payout forward would link them
    expect(linkedWalletsOf(W("c")).map((w) => w.toLowerCase())).toContain(W("b"));
    expect(standingOf(W("c")).tier).toBe("flagged");
    expect(standingOf(W("b")).tier).toBe("flagged");
  });

  it("re-proving from the same wallet is not a cluster", () => {
    recordIdentityProof({ wallet: W("d"), provider: "worldid", nullifier: "0xperson-three", level: "orb" });
    const again = recordIdentityProof({ wallet: W("d"), provider: "worldid", nullifier: "0xperson-three", level: "orb" });
    expect(again.alsoTheirs).toEqual([]);
    expect(standingOf(W("d")).tier).toBe("established");
  });

  it("counts people, not wallets", () => {
    const c = identityCount();
    expect(c.wallets).toBeGreaterThan(c.people);
  });
});
