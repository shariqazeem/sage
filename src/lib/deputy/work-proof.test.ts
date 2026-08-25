import { describe, expect, it } from "vitest";

import {
  extractTxHash,
  mergeWorkProofEvidence,
  parseWorkProofContract,
  runWorkProof,
} from "./work-proof";
import type { VerificationResult } from "@/lib/verify/contract";

/**
 * WORK PROOF judge lane — the deterministic pre-gate (docs/work-proof-design.md §C).
 * The split that matters: `definitive` (recorded hold, no LLM ever) vs `transient` (stays pending,
 * sweep retries) vs `verified` (report joins the evidence; the unchanged brain + gate still decide).
 */

const GOAT = 2345;
const WALLET = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"ab".repeat(32)}`;

const ok = (strength: VerificationResult["strength"] = "deterministic"): VerificationResult => ({
  verified: true,
  strength,
  detail: "matched",
  publicDetail: "Verified.",
});
const matcherFail: VerificationResult = {
  verified: false,
  strength: "deterministic",
  detail: "from 0xdead ≠ tester",
  publicDetail: "That transaction was not sent from your wallet.",
};
const wrapperHold: VerificationResult = {
  verified: false,
  strength: "deterministic",
  detail: "rpc/parse hold",
  publicDetail: "Couldn't read that transaction on-chain yet — it may still be pending.",
};

describe("parseWorkProofContract — strict, and malformed means the lane is simply absent", () => {
  it("parses each real kind", () => {
    expect(parseWorkProofContract({ kind: "onchain_tx", chainId: GOAT, methodSelector: "0xa9059cbb" })?.kind).toBe("onchain_tx");
    expect(
      parseWorkProofContract({ kind: "onchain_state", chainId: GOAT, contract: WALLET, callData: "0x70a08231" + "0".repeat(64) })?.kind,
    ).toBe("onchain_state");
    expect(parseWorkProofContract({ kind: "artifact_url", allowedHosts: ["x.org"], markerKind: "wallet" })?.kind).toBe("artifact_url");
    expect(parseWorkProofContract({ kind: "public_url", expectedText: ["done"] })?.kind).toBe("public_url");
  });

  it("null/malformed/unknown-chain/observation → null (legacy behavior)", () => {
    expect(parseWorkProofContract(null)).toBeNull();
    expect(parseWorkProofContract("x")).toBeNull();
    expect(parseWorkProofContract({ kind: "observation" })).toBeNull();
    expect(parseWorkProofContract({ kind: "onchain_tx", chainId: 424242 })).toBeNull();
    expect(parseWorkProofContract({ kind: "public_url", expectedText: [] })).toBeNull();
  });
});

describe("extractTxHash — bare hash or explorer link, wherever it sits", () => {
  it("finds it in the note, in an explorer url, and reports absence", () => {
    expect(extractTxHash(null, `did the thing, tx ${HASH}`)).toBe(HASH);
    expect(extractTxHash(`https://explorer.goat.network/tx/${HASH}`, null)).toBe(HASH);
    expect(extractTxHash("https://example.org", "no hash here 0x1234")).toBeNull();
  });
});

describe("runWorkProof onchain_tx", () => {
  const contract = { kind: "onchain_tx" as const, chainId: GOAT, methodSelector: "0xa9059cbb" };

  it("no hash in the submission → definitive (clear, actionable public reason)", async () => {
    const r = await runWorkProof(contract, { wallet: WALLET, evidenceUrl: null, note: "i did it" });
    expect(r.outcome).toBe("definitive");
    expect(r.result.publicDetail).toMatch(/transaction hash/);
  });

  it("verifier PASSES → verified, and the report names the hash + wallet + PASSED", async () => {
    const r = await runWorkProof(
      contract,
      { wallet: WALLET, evidenceUrl: null, note: `tx ${HASH}` },
      { verifyTx: async () => ok() },
    );
    expect(r.outcome).toBe("verified");
    if (r.outcome !== "verified") return;
    expect(r.report).toContain("RESULT: PASSED");
    expect(r.report).toContain(HASH);
    expect(r.report).toContain(WALLET);
    expect(r.report).toContain("not submitter-authored");
  });

  it("matcher failure (wrong sender) → definitive; wrapper hold → transient", async () => {
    const bad = await runWorkProof(contract, { wallet: WALLET, evidenceUrl: null, note: HASH }, { verifyTx: async () => matcherFail });
    expect(bad.outcome).toBe("definitive");
    const held = await runWorkProof(contract, { wallet: WALLET, evidenceUrl: null, note: HASH }, { verifyTx: async () => wrapperHold });
    expect(held.outcome).toBe("transient");
  });
});

describe("runWorkProof onchain_state", () => {
  const contract = {
    kind: "onchain_state" as const,
    chainId: GOAT,
    contract: "0x3022b87ac063DE95b1570F46f5e470F8B53112D8",
    callData: "0x70a08231" + "0".repeat(64),
    injectTesterArgWord: 0,
    minUint: "1",
  };

  it("splices the tester's wallet into the calldata word and verifies on ≥ min", async () => {
    let seenData = "";
    const r = await runWorkProof(
      contract,
      { wallet: WALLET, evidenceUrl: null, note: null },
      {
        ethCall: async (_c, _to, data) => {
          seenData = data;
          return `0x${"0".repeat(63)}5`; // 5 ≥ 1
        },
      },
    );
    expect(r.outcome).toBe("verified");
    expect(seenData).toContain(WALLET.slice(2).toLowerCase());
  });

  it("state below the minimum → definitive; RPC throw → transient", async () => {
    const low = await runWorkProof(contract, { wallet: WALLET, evidenceUrl: null, note: null }, { ethCall: async () => `0x${"0".repeat(64)}` });
    expect(low.outcome).toBe("definitive");
    const down = await runWorkProof(contract, { wallet: WALLET, evidenceUrl: null, note: null }, {
      ethCall: async () => {
        throw new Error("rpc down");
      },
    });
    expect(down.outcome).toBe("transient");
  });
});

describe("runWorkProof artifact_url + public_url", () => {
  it("artifact without a link → definitive; verified artifact carries the marker story in the report", async () => {
    const contract = { kind: "artifact_url" as const, allowedHosts: ["x.org"], markerKind: "wallet" as const };
    const missing = await runWorkProof(contract, { wallet: WALLET, evidenceUrl: null, note: "made it" });
    expect(missing.outcome).toBe("definitive");
    const passed = await runWorkProof(
      contract,
      { wallet: WALLET, evidenceUrl: "https://x.org/me", note: null },
      { verifyArtifact: async () => ok("strong") },
    );
    expect(passed.outcome).toBe("verified");
    if (passed.outcome === "verified") expect(passed.report).toContain("cannot pass");
  });

  it("public_url: expected text present → verified; missing → definitive; fetch throw → transient; 404 → definitive", async () => {
    const contract = { kind: "public_url" as const, expectedText: ["deployment complete"] };
    const sub = { wallet: WALLET, evidenceUrl: "https://x.org/status", note: null };
    const respond = (status: number, body: string) =>
      (async () => new Response(body, { status })) as unknown as typeof fetch;

    expect((await runWorkProof(contract, sub, { fetchImpl: respond(200, "…deployment complete…") })).outcome).toBe("verified");
    expect((await runWorkProof(contract, sub, { fetchImpl: respond(200, "nothing here") })).outcome).toBe("definitive");
    expect((await runWorkProof(contract, sub, { fetchImpl: (async () => { throw new Error("net"); }) as unknown as typeof fetch })).outcome).toBe("transient");
    expect((await runWorkProof(contract, sub, { fetchImpl: respond(404, "gone") })).outcome).toBe("definitive");
  });
});

describe("mergeWorkProofEvidence — the report leads, the fetched page follows, ok is honestly true", () => {
  it("merges both sections with a content hash", () => {
    const m = mergeWorkProofEvidence("REPORT LINE", { text: "page body", ok: true });
    expect(m.ok).toBe(true);
    expect(m.text.indexOf("REPORT LINE")).toBe(0);
    expect(m.text).toContain("page body");
    expect(m.text).toContain("untrusted, submitter-controlled");
    expect(m.contentSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("report alone when nothing was fetched (hash-only onchain submission)", () => {
    const m = mergeWorkProofEvidence("REPORT LINE", { text: "", ok: false });
    expect(m.text).toBe("REPORT LINE");
    expect(m.ok).toBe(true);
  });
});
