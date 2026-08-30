import { describe, expect, it } from "vitest";

import { DIRECT_BLOCK } from "./concierge";

/**
 * THE AGENT HAD NEVER HEARD OF THE PRIVATE RAIL.
 *
 * Sage settles on two chains and its own prompt mentioned one. A founder asking "can workers get
 * paid without their income being public?" would be answered from a prompt that knows nothing
 * about it — and the most likely answer to a capability a model has no knowledge of is "no", which
 * is false and turns away exactly the founder the rail was built for.
 *
 * What it must NOT do is over-claim: the agent wallet is EVM-only, so chat genuinely cannot fund a
 * Starknet campaign. That is a fact about where the button is, not a limit on what Sage can pay.
 */
describe("what the agent knows about how a campaign pays", () => {
  it("knows the private rail exists", () => {
    expect(DIRECT_BLOCK).toMatch(/private-capable/i);
    expect(DIRECT_BLOCK).toMatch(/starknet/i);
  });

  it("knows public receipts are the default, and why a founder would want them", () => {
    expect(DIRECT_BLOCK).toMatch(/public receipts/i);
    expect(DIRECT_BLOCK).toMatch(/auditor|funder|programme/i);
  });

  it("knows the privacy belongs to the TESTER, not the platform", () => {
    // The whole product position: it is the person earning who chooses, and never automatically.
    expect(DIRECT_BLOCK).toMatch(/tester chooses|person earning/i);
    expect(DIRECT_BLOCK).toMatch(/never automatic|not automatic/i);
  });

  it("knows the founder chooses at FUNDING time, so it does not ask too early", () => {
    expect(DIRECT_BLOCK).toMatch(/funding screen|at funding time|planUrl/i);
  });

  it("states the real limit without misstating it as an inability to pay privately", () => {
    // "Sage cannot pay privately" is false; "you fund that one on the web" is true.
    expect(DIRECT_BLOCK).toMatch(/cannot launch the private rail from chat/i);
    expect(DIRECT_BLOCK).toMatch(/never as "Sage cannot pay privately"/i);
  });

  it("does not promise that privacy changes the judging or the limits", () => {
    // A founder must not think the private rail is a different, looser product.
    expect(DIRECT_BLOCK).toMatch(/changes nothing about how Sage judges/i);
  });
});
