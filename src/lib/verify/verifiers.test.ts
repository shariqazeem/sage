import { describe, it, expect } from "vitest";
import {
  matchTxShape,
  matchOnchainState,
  matchArtifact,
  matchPublicUrl,
  verifyOnchainTx,
  verifyArtifactUrl,
  type TxView,
  type ReceiptView,
} from "./verifiers";
import type { ArtifactUrlContract, OnchainStateContract, OnchainTxContract, PublicUrlContract } from "./contract";

/**
 * The deterministic verifiers — the foundation of the verification system (docs/verification-system.md).
 * These prove the core promise: a tester who did the real action verifies; a forged hash, a copied
 * artifact, or a wrong wallet does not. Pure matchers unit-tested offline; the async wrappers proven to
 * HOLD (never throw) on network/parse failure.
 */

const TESTER = "0xAbC0000000000000000000000000000000000001";
const OTHER = "0xdEf0000000000000000000000000000000000002";

describe("matchTxShape — the tester's own on-chain action", () => {
  const c: OnchainTxContract = {
    kind: "onchain_tx",
    chainId: 2345,
    to: "0x1111111111111111111111111111111111111111",
    methodSelector: "0x12345678",
    minValueWei: "1000000000000000", // 0.001
    logTopic0: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  };
  const goodTx: TxView = { from: TESTER, to: c.to!, value: BigInt("2000000000000000"), input: "0x12345678deadbeef" };
  const goodReceipt: ReceiptView = { status: "success", logs: [{ address: c.to!, topics: [c.logTopic0!] }] };

  it("verifies a genuine matching transaction", () => {
    const r = matchTxShape(goodTx, goodReceipt, c, TESTER);
    expect(r.verified).toBe(true);
    expect(r.strength).toBe("deterministic");
  });

  it("rejects a hash from someone else's wallet (the copied-hash attack)", () => {
    const r = matchTxShape({ ...goodTx, from: OTHER }, goodReceipt, c, TESTER);
    expect(r.verified).toBe(false);
    expect(r.publicDetail).toMatch(/not sent from your wallet/i);
  });

  it("rejects a reverted transaction", () => {
    const r = matchTxShape(goodTx, { ...goodReceipt, status: "reverted" }, c, TESTER);
    expect(r.verified).toBe(false);
  });

  it("rejects the wrong method / wrong contract / too-little value / missing effect", () => {
    expect(matchTxShape({ ...goodTx, input: "0x99999999" }, goodReceipt, c, TESTER).verified).toBe(false);
    expect(matchTxShape({ ...goodTx, to: OTHER }, goodReceipt, c, TESTER).verified).toBe(false);
    expect(matchTxShape({ ...goodTx, value: BigInt(1) }, goodReceipt, c, TESTER).verified).toBe(false);
    expect(matchTxShape(goodTx, { status: "success", logs: [] }, c, TESTER).verified).toBe(false);
  });

  it("checks only the fields the contract names (a minimal contract still verifies)", () => {
    const minimal: OnchainTxContract = { kind: "onchain_tx", chainId: 2345 };
    expect(matchTxShape(goodTx, goodReceipt, minimal, TESTER).verified).toBe(true);
  });
});

describe("matchOnchainState — ownership / balance the action produced", () => {
  it("verifies ownerOf === tester", () => {
    const word = `0x${"0".repeat(24)}${TESTER.slice(2).toLowerCase()}`;
    const c: OnchainStateContract = { kind: "onchain_state", chainId: 2345, contract: "0x1", callData: "0x", expectTesterAddress: true };
    expect(matchOnchainState(word, c, TESTER).verified).toBe(true);
    // a different owner fails
    const other = `0x${"0".repeat(24)}${OTHER.slice(2).toLowerCase()}`;
    expect(matchOnchainState(other, c, TESTER).verified).toBe(false);
  });

  it("verifies balanceOf ≥ min", () => {
    const c: OnchainStateContract = { kind: "onchain_state", chainId: 2345, contract: "0x1", callData: "0x", minUint: "1" };
    expect(matchOnchainState(`0x${"0".repeat(63)}1`, c, TESTER).verified).toBe(true);
    expect(matchOnchainState(`0x${"0".repeat(64)}`, c, TESTER).verified).toBe(false);
  });
});

describe("matchArtifact — a public object provably the tester's", () => {
  const c: ArtifactUrlContract = { kind: "artifact_url", allowedHosts: ["clawup.org"], markerKind: "wallet", mustContain: ["agent"] };

  it("verifies a live, on-host page carrying the tester's marker", () => {
    const r = matchArtifact(
      { status: 200, finalUrl: "https://clawup.org/agent/xyz", bodyText: `My agent owned by ${TESTER}` },
      c,
      TESTER,
    );
    expect(r.verified).toBe(true);
    expect(r.strength).toBe("strong");
  });

  it("rejects the homepage parrot — right host, no tester marker", () => {
    const r = matchArtifact({ status: 200, finalUrl: "https://clawup.org/", bodyText: "Build and Power Up Your AI Agent" }, c, TESTER);
    expect(r.verified).toBe(false);
    expect(r.publicDetail).toMatch(/unique marker/i);
  });

  it("rejects an off-site link and a dead link", () => {
    expect(matchArtifact({ status: 200, finalUrl: "https://evil.example/x", bodyText: TESTER }, c, TESTER).verified).toBe(false);
    expect(matchArtifact({ status: 404, finalUrl: "https://clawup.org/agent/x", bodyText: TESTER }, c, TESTER).verified).toBe(false);
  });

  it("accepts a subdomain of an allowed host but not a lookalike", () => {
    expect(matchArtifact({ status: 200, finalUrl: "https://app.clawup.org/a", bodyText: `agent ${TESTER}` }, c, TESTER).verified).toBe(true);
    expect(matchArtifact({ status: 200, finalUrl: "https://clawup.org.evil.com/a", bodyText: `agent ${TESTER}` }, c, TESTER).verified).toBe(false);
  });
});

describe("matchPublicUrl — verbatim expected text", () => {
  const c: PublicUrlContract = { kind: "public_url", expectedText: ["Simple, pay-as-you-go pricing", "$0.01"] };
  it("verifies when every expected string is present", () => {
    expect(matchPublicUrl("... Simple, pay-as-you-go pricing ... from $0.01 per call ...", c).verified).toBe(true);
  });
  it("fails when any is missing", () => {
    expect(matchPublicUrl("Simple, pay-as-you-go pricing only", c).verified).toBe(false);
  });
});

describe("async wrappers HOLD (never throw) on bad input / network failure", () => {
  it("onchain_tx: a non-hash holds without any RPC", async () => {
    const r = await verifyOnchainTx({ kind: "onchain_tx", chainId: 2345 }, "not-a-hash", TESTER);
    expect(r.verified).toBe(false);
    expect(r.publicDetail).toMatch(/transaction hash/i);
  });

  it("onchain_tx: an RPC that throws holds", async () => {
    const client = {
      getTransaction: () => Promise.reject(new Error("rpc down")),
      getTransactionReceipt: () => Promise.reject(new Error("rpc down")),
    };
    const r = await verifyOnchainTx({ kind: "onchain_tx", chainId: 2345 }, `0x${"a".repeat(64)}`, TESTER, { client });
    expect(r.verified).toBe(false);
    expect(r.publicDetail).toMatch(/pending|couldn't read/i);
  });

  it("artifact_url: a non-https url holds; a fetch that throws holds", async () => {
    const c: ArtifactUrlContract = { kind: "artifact_url", allowedHosts: ["clawup.org"], markerKind: "wallet" };
    expect((await verifyArtifactUrl(c, "http://clawup.org/x", TESTER)).verified).toBe(false);
    const throwing = (() => Promise.reject(new Error("net"))) as unknown as typeof fetch;
    expect((await verifyArtifactUrl(c, "https://clawup.org/x", TESTER, { fetchImpl: throwing })).verified).toBe(false);
  });

  it("artifact_url: a genuine fetch verifies through the wrapper", async () => {
    const c: ArtifactUrlContract = { kind: "artifact_url", allowedHosts: ["clawup.org"], markerKind: "wallet" };
    const okFetch = (async () =>
      new Response(`agent page for ${TESTER}`, { status: 200 })) as unknown as typeof fetch;
    const r = await verifyArtifactUrl(c, "https://clawup.org/agent/1", TESTER, { fetchImpl: okFetch });
    expect(r.verified).toBe(true);
  });
});

describe("artifact_url with NO host restriction — the MSME case (P-DIRECT 2026-08-28)", () => {
  const marker = "0xccbfb9bba88f282282a29aa1338175cc835e768d";
  const unpinned = { kind: "artifact_url", allowedHosts: [], markerKind: "wallet" } as const;

  it("accepts ANY host when the operator pinned none — the marker is the binding", () => {
    for (const url of ["https://paste.rs/x1", "https://some-shop.example/menu", "https://notes.site/abc"]) {
      const r = matchArtifact(
        { status: 200, finalUrl: url, bodyText: `Shop page. Published by ${marker}` },
        unpinned as never,
        marker,
      );
      expect(r.verified, `${url} should verify`).toBe(true);
    }
  });

  it("STILL refuses a page that does not carry the submitter's own marker", () => {
    const r = matchArtifact(
      { status: 200, finalUrl: "https://anywhere.example/p", bodyText: "A page with no wallet on it at all" },
      unpinned as never,
      marker,
    );
    expect(r.verified).toBe(false);
    expect(r.publicDetail).toMatch(/marker/i);
  });

  it("a PINNED host list still binds exactly as before", () => {
    const pinned = { kind: "artifact_url", allowedHosts: ["paste.rs"], markerKind: "wallet" } as const;
    const ok = matchArtifact({ status: 200, finalUrl: "https://paste.rs/x", bodyText: marker }, pinned as never, marker);
    expect(ok.verified).toBe(true);
    const off = matchArtifact({ status: 200, finalUrl: "https://elsewhere.io/x", bodyText: marker }, pinned as never, marker);
    expect(off.verified).toBe(false);
    expect(off.publicDetail).toContain("elsewhere.io");
  });
});
