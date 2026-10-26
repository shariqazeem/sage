import { afterEach, describe, expect, it } from "vitest";
import { matured, refusedOnChain, revocationReason, windowSecondsFor } from "./finalization";

const cand = (note: string, fp: string | null = null) => ({ note, contentSha256: null, artifactFingerprint: fp });

describe("the finalization window", () => {
  afterEach(() => { delete process.env.AUTOPAY_FINALIZE_MINUTES; });
  it("members-only pays now; an open campaign waits the window (30 minutes by default, env-tunable)", () => {
    expect(windowSecondsFor("unlisted", {})).toBe(0);
    expect(windowSecondsFor("listed", {})).toBe(1800);
    expect(windowSecondsFor(undefined, { AUTOPAY_FINALIZE_MINUTES: "5" })).toBe(300);
    expect(windowSecondsFor("listed", { AUTOPAY_FINALIZE_MINUTES: "0" })).toBe(0);
    expect(windowSecondsFor("listed", { AUTOPAY_FINALIZE_MINUTES: "soon" })).toBe(1800);
  });
  it("matures exactly at approvedAt + window", () => {
    expect(matured(1000, 60, 1059)).toBe(false);
    expect(matured(1000, 60, 1060)).toBe(true);
  });
  it("a later near-identical report revokes; an honest one finalizes", () => {
    const me = cand("I opened the privacy page and read about the Cairo vault, the Poseidon commitment and the one-time claim link that pays gas for the worker.");
    const later = cand("I opened the privacy page and read about the Cairo vault, the Poseidon commitment and the one-time claim link that pays gas for the worker too.");
    expect(revocationReason({ me, others: [later], linkedWallets: [], peerWallets: [] })).toMatch(/near-identical/);
    expect(revocationReason({ me, others: [cand("Completely different account of a different product with different words.")], linkedWallets: [], peerWallets: [] })).toBeNull();
  });
  it("a wallet the consolidation watch linked to another submitter revokes", () => {
    const me = cand("fine");
    expect(revocationReason({ me, others: [], linkedWallets: ["0x0270f1135c91912cd47d8d434aaf8698d4a5fc32a525c3033b90aaa284a0b8de"], peerWallets: ["0x270f1135c91912cd47d8d434aaf8698d4a5fc32a525c3033b90aaa284a0b8de"] })).toMatch(/linked on-chain to 1 other submitter/);
    expect(revocationReason({ me, others: [], linkedWallets: ["0x0999"], peerWallets: ["0x0270"] })).toBeNull();
  });
});

describe("what the sweep reads as a refusal (26 Oct 2026)", () => {
  it("is a refusal only when the chain recorded one", () => {
    // V2: a successful transaction that emitted the refusal, final for that intent
    expect(refusedOnChain({ settled: false, txHash: "0xrefused", failedCheckIndex: 7 })).toBe(true);
    // V1: "the recipient's approval is still inside its timelock window" — nothing was sent; it waits
    expect(refusedOnChain({ settled: false, txHash: null, failedCheckIndex: 3 })).toBe(false);
    expect(refusedOnChain({ settled: true, txHash: "0xpaid", failedCheckIndex: null })).toBe(false);
    expect(refusedOnChain({ settled: false, txHash: null, failedCheckIndex: null })).toBe(false);
  });
});

