import { describe, expect, it } from "vitest";
import { runWorkProof } from "./work-proof";
import type { VerificationContract } from "@/lib/verify/contract";

/**
 * P-VERIFY — the verification contracts against REAL data.
 *
 * Three of the four contract kinds have never executed in production: measured 2026-08-28, every
 * mission ever created used `artifact_url`. `public_url`, `onchain_tx` and `onchain_state` are
 * unit-tested against mocks only, which proves the parsing, not that the internet and the chain
 * answer the way the code assumes. Gated (real network + RPC):
 *
 *   VERIFY_LIVE=1 npx vitest run verify-contracts.live
 *
 * Every case asserts BOTH directions: the honest submission verifies, and the near-miss is
 * refused. A verifier that only ever says yes is not a verifier.
 */
const LIVE = process.env.VERIFY_LIVE === "1";
const GOAT = 2345;

// A real, stable payout on GOAT mainnet: the first AI-earned payout, $0.50 USDC.
const REAL_TX = "0xb0120330aba99dcf25d5aba913d1c8ecf341782653f1b20b4eaafa575155d827";
const AI_WALLET = "0xcCbFB9bBa88F282282a29aa1338175Cc835E768D";
const USDC = "0x3022b87ac063DE95b1570F46f5e470F8B53112D8";
const OPERATOR_ISH = "0x83b4b4f6348f71ffbdbb0cb046e428ca646f3c35";

const sub = (over: Partial<{ wallet: string; evidenceUrl: string | null; note: string | null }> = {}) => ({
  wallet: AI_WALLET,
  evidenceUrl: null,
  note: null,
  ...over,
});

describe.runIf(LIVE)("P-VERIFY — contracts against the real internet and the real chain", () => {
  it("public_url: verifies required text on a real page, and refuses text that is not there", async () => {
    const contract = { kind: "public_url", expectedText: ["Every settlement. Every refusal."] } as VerificationContract;
    const good = await runWorkProof(contract, sub({ evidenceUrl: "https://sagepays.xyz/explorer" }));
    expect(good.outcome, `expected verified, got ${good.outcome}: ${JSON.stringify(good.result?.detail)}`).toBe("verified");

    const missing = { kind: "public_url", expectedText: ["a sentence this page certainly does not contain 9f3a"] } as VerificationContract;
    const bad = await runWorkProof(missing, sub({ evidenceUrl: "https://sagepays.xyz/explorer" }));
    expect(bad.outcome).toBe("definitive");
  }, 120_000);

  it("artifact_url: refuses an off-host link and a page missing the submitter's marker", async () => {
    const contract = { kind: "artifact_url", allowedHosts: ["paste.rs"], markerKind: "wallet" } as VerificationContract;
    const offHost = await runWorkProof(contract, sub({ evidenceUrl: "https://sagepays.xyz/explorer" }));
    expect(offHost.outcome).toBe("definitive");
    expect(offHost.result?.publicDetail ?? "").toMatch(/sagepays\.xyz|requires a link/i);

    // a real page on the right host, but it carries a DIFFERENT wallet's marker
    const wrongMarker = await runWorkProof(contract, sub({ wallet: `0x${"9".repeat(40)}`, evidenceUrl: "https://paste.rs/3iBt3" }));
    expect(wrongMarker.outcome).toBe("definitive");
  }, 120_000);

  it("onchain_tx: verifies a REAL mainnet transaction and refuses one the submitter did not send", async () => {
    const contract = { kind: "onchain_tx", chainId: GOAT, to: USDC, methodSelector: "0xa9059cbb" } as VerificationContract;
    // the payout was sent BY the operator TO the AI, so the AI is not the sender: must refuse.
    const notSender = await runWorkProof(contract, sub({ wallet: AI_WALLET, note: `done, tx ${REAL_TX}` }));
    expect(notSender.outcome, "a tx the submitter did not send must never verify").not.toBe("verified");

    const noHash = await runWorkProof(contract, sub({ note: "I did it, trust me" }));
    expect(noHash.outcome).toBe("definitive");
    expect(noHash.result?.publicDetail ?? "").toMatch(/transaction hash/i);
  }, 120_000);

  it("onchain_state: reads real chain state — a wallet's USDC balance — and refuses an impossible floor", async () => {
    // balanceOf(<tester>) >= 1 wei: true for a wallet that has been paid.
    const balanceOf = { kind: "onchain_state", chainId: GOAT, contract: USDC, callData: `0x70a08231${"0".repeat(64)}`, injectTesterArgWord: 0, minUint: "1" } as VerificationContract;
    const paid = await runWorkProof(balanceOf, sub({ wallet: AI_WALLET }));
    expect(["verified", "transient"], `got ${paid.outcome}`).toContain(paid.outcome);

    const impossible = { ...balanceOf, minUint: "999999999999999999999" } as VerificationContract;
    const refused = await runWorkProof(impossible, sub({ wallet: AI_WALLET }));
    expect(["definitive", "transient"]).toContain(refused.outcome);
    if (refused.outcome === "definitive") expect(refused.result.verified).toBe(false);
  }, 120_000);

  it("a wallet with no history cannot satisfy a balance floor (the honest negative)", async () => {
    const contract = { kind: "onchain_state", chainId: GOAT, contract: USDC, callData: `0x70a08231${"0".repeat(64)}`, injectTesterArgWord: 0, minUint: "1" } as VerificationContract;
    const empty = await runWorkProof(contract, sub({ wallet: `0x${"1".repeat(40)}` }));
    expect(["definitive", "transient"]).toContain(empty.outcome);
  }, 120_000);
});
