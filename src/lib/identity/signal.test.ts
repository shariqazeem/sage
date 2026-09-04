import { describe, expect, it } from "vitest";
import { signalMatches } from "./worldid";

/**
 * World's guidance: the signal is what binds a proof to the thing it was made for. A verifier that
 * checks the proof but not the signal accepts any valid proof for any subject — which would let a
 * proof lifted from an honest worker be replayed against an attacker's wallet, linking the victim to
 * a stranger and flagging them both.
 */
const A = `0x${"a".repeat(40)}`;
const B = `0x${"b".repeat(40)}`;

async function hashOf(signal: string): Promise<string> {
  const { hashSignal } = await import("@worldcoin/idkit/hashing");
  return hashSignal(signal);
}

describe("a proof must be about the wallet it is being bound to", () => {
  it("accepts a proof whose signal is this wallet", async () => {
    const payload = { responses: [{ signal_hash: await hashOf(A) }] };
    expect(await signalMatches(payload, A)).toBe(true);
  });

  it("REFUSES a proof made for someone else's wallet", async () => {
    const payload = { responses: [{ signal_hash: await hashOf(B) }] };
    expect(await signalMatches(payload, A)).toBe(false);
  });

  it("refuses a proof carrying no signal at all — unbound is the case this guards", async () => {
    expect(await signalMatches({ responses: [{}] }, A)).toBe(false);
    expect(await signalMatches({}, A)).toBe(false);
  });

  it("refuses when any response in a multi-part proof names a different wallet", async () => {
    const payload = { responses: [{ signal_hash: await hashOf(A) }, { signal_hash: await hashOf(B) }] };
    expect(await signalMatches(payload, A)).toBe(false);
  });

  it("reads a top-level signal_hash as well as per-response ones", async () => {
    expect(await signalMatches({ signal_hash: await hashOf(A) }, A)).toBe(true);
    expect(await signalMatches({ signal_hash: await hashOf(B) }, A)).toBe(false);
  });
});
