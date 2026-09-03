import { describe, expect, it } from "vitest";
import { directLinksOf, linkWallets, linkedWalletsOf } from "./wallet-links";

/**
 * The link table is written by the consolidation watch with the chain's padded felt and read by the
 * judge, the finalization watch and the graph with the submission's unpadded felt. Both must meet.
 */
const HUB = "0x0270f1135c91912cd47d8d434aaf8698d4a5fc32a525c3033b90aaa284a0b8de";
const A = "0x0775e78dc7035cd00f0192452d326ba3467cbe06661c4d5d04816dd5f46a25ab";
const unpad = (w: string) => `0x${w.slice(2).replace(/^0+/, "")}`;
const keys = (ws: string[]) => ws.map((w) => unpad(w.toLowerCase()));

describe("wallet links — one wallet, every spelling", () => {
  it("a link written with padded felts is found from the unpadded submission form, and vice versa", () => {
    expect(linkWallets(HUB, A).linked).toBe(true);
    expect(keys(linkedWalletsOf(unpad(A)))).toContain(unpad(HUB));
    expect(keys(linkedWalletsOf(unpad(HUB)))).toContain(unpad(A));
    expect(keys(linkedWalletsOf(A.toUpperCase().replace("0X", "0x")))).toContain(unpad(HUB));
    // one wallet is one node, whatever spelling the rows carry
    expect(linkedWalletsOf(unpad(A))).toHaveLength(2);
  });
  it("the same pair in another spelling is not linked twice", () => {
    expect(linkWallets(unpad(A), HUB).linked).toBe(false);
    expect(linkWallets(HUB.toUpperCase().replace("0X", "0x"), unpad(A)).linked).toBe(false);
  });
  it("an EVM pair links in lowercase and reads back in any case", () => {
    const e1 = "0xAbCdEf0000000000000000000000000000000001", e2 = "0x0000000000000000000000000000000000000002";
    expect(linkWallets(e1, e2).linked).toBe(true);
    expect(keys(linkedWalletsOf(e1.toLowerCase()))).toContain("0x2");
    expect(keys(linkedWalletsOf("0x2"))).toContain(e1.toLowerCase());
  });
  it("direct links are the recorded rows; the closure is who they reach", () => {
    const B = "0x0499b03b05e4409e1a48de30aac576381d6f650ad6c36fec664301bec8da11d5";
    linkWallets(HUB, A); linkWallets(HUB, B);
    expect(keys(directLinksOf(unpad(A)))).toEqual([unpad(HUB)]);
    expect(keys(linkedWalletsOf(unpad(A))).sort()).toEqual([unpad(HUB), unpad(A), unpad(B)].sort());
  });
});
