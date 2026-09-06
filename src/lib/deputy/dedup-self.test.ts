import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findCopiedArtifact, findNearDuplicate, otherPeoplesWork, type DedupCandidate } from "./dedup";
import { artifactFingerprint } from "./fingerprint";

/**
 * A person's own work is not a copy of itself. On 6 Sep 2026 a market seller's milestone-two page
 * (her milestone-one page plus a new section) matched her own earlier submission at 72% and the
 * copy watch HELD it as "possible copied work". The two cross-wallet watches now read other
 * people's work only; the fork-from-a-fresh-wallet case they exist for is unchanged.
 */
const SELLER = "0x04F1f6530F84e4A1DB7fa35bAFc313174A2482A54c775C4321487Eb0fE91f434";
const FORKER = "0x9a8B7c6D5e4F3a2B1c0D9e8F7a6B5c4D3e2F1a0B";
const base = `Sage seller storefront by ${SELLER}. Fresh produce from the Coronation market: yams, plantains, scotch
bonnet peppers, callaloo and thyme, weighed on the stall and priced in Jamaican dollars. Orders by WhatsApp before
nine in the morning are packed for pickup by noon. Delivery within Kingston on Tuesdays and Fridays for a flat fee.
Payment on pickup, or by bank transfer to the account on the receipt. Marker: ${SELLER}`;
const milestoneTwo = `${base}
Customer reviews: "the yams were the best I have bought this year" — Andrea, Half Way Tree. "Packed on time, every
time" — Marlon, Papine. Reviews are collected on pickup and published with the customer's first name only.`;
const fp = (text: string) => artifactFingerprint(text);
const cand = (wallet: string, text: string): DedupCandidate => ({ note: null, contentSha256: null, artifactFingerprint: fp(text), wallet });

describe("the cross-wallet watches read other people's work only", () => {
  it("her milestone-two page over her own milestone one is not a copy", () => {
    const one = cand(SELLER, base);
    const two = cand(SELLER, milestoneTwo);
    // the raw watch still sees the resemblance — that is the 6 Sep hold
    expect(findCopiedArtifact(two, [one])).not.toBeNull();
    // read as other people's work, there is nothing to compare against
    expect(findCopiedArtifact(two, otherPeoplesWork([one], [SELLER]))).toBeNull();
    expect(findNearDuplicate(two, otherPeoplesWork([one], [SELLER]))).toBeNull();
  });

  it("a fork of her page from a fresh wallet is still held", () => {
    const forged = base.split(SELLER).join(FORKER);
    const fork = cand(FORKER, forged);
    const hers = cand(SELLER, base);
    const hit = findCopiedArtifact(fork, otherPeoplesWork([hers], [FORKER]));
    expect(hit).not.toBeNull();
    expect(hit!.reason).toMatch(/copied work/);
  });

  it("every wallet that is this person is her own work — compared bare, whatever the spelling", () => {
    const linked = "0x0000abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456";
    const rows = [cand(SELLER.toLowerCase(), base), cand("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef123456", base), cand(FORKER, base)];
    const others = otherPeoplesWork(rows, [SELLER, linked]);
    expect(others.map((r) => r.wallet)).toEqual([FORKER]);
  });

  it("a candidate with no wallet is kept — an unknown sender is other people by default", () => {
    const rows: DedupCandidate[] = [{ note: "x", contentSha256: null, artifactFingerprint: null }];
    expect(otherPeoplesWork(rows, [SELLER])).toHaveLength(1);
  });

  it("both readers of the watches wrap their candidate lists — two lists that drift is the defect shape here", () => {
    const pipeline = readFileSync("src/lib/deputy/pipeline.ts", "utf8");
    const finalization = readFileSync("src/lib/deputy/finalization-db.ts", "utf8");
    const nearCall = pipeline.slice(pipeline.indexOf("const near = findNearDuplicate("), pipeline.indexOf("if (near)"));
    const copiedCall = pipeline.slice(pipeline.indexOf("const copied = findCopiedArtifact("), pipeline.indexOf("if (copied)"));
    expect(nearCall).toContain("otherPeoplesWork(");
    expect(copiedCall).toContain("otherPeoplesWork(");
    expect(finalization).toMatch(/others: otherPeoplesWork\(listSubmissionsForDedup\(/);
  });
});
