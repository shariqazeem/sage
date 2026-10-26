import { describe, expect, it } from "vitest";

import { DIRECT_BLOCK } from "./concierge";

/**
 * WHAT THE AGENT KNOWS ABOUT HOW A CAMPAIGN PAYS (26 Oct 2026: one network, Metis).
 *
 * The agent once had never heard of the private rail, and the likeliest answer to a capability a model
 * knows nothing about is a confident wrong one. Now the rail is CLOSED, and the same risk runs the other
 * way: an agent that still believes in two rails would offer Starknet to a founder, or tell a worker their
 * private payout is gone. It must know there is one way to pay, on Metis; that Arc and Starknet take
 * nothing new; and that a private payout already made still collects with its claim link.
 */
describe("what the agent knows about how a campaign pays", () => {
  it("knows there is one way, on Metis, with a public receipt, and why a founder would want one", () => {
    expect(DIRECT_BLOCK).toMatch(/ONE WAY, ON METIS/);
    expect(DIRECT_BLOCK).toMatch(/public receipt/i);
    expect(DIRECT_BLOCK).toMatch(/auditor|funder|programme/i);
  });

  it("knows Arc and Starknet are closed, and never offers them", () => {
    expect(DIRECT_BLOCK).toMatch(/Arc and Starknet are closed/);
    expect(DIRECT_BLOCK).toMatch(/never offer either for anything new/);
  });

  it("answers a privacy question truthfully: not for new work, and old claim links still pay", () => {
    expect(DIRECT_BLOCK).toMatch(/no longer offers private payouts for new work/);
    expect(DIRECT_BLOCK).toMatch(/still collects with its claim link/);
  });

  it("no longer describes a private rail a founder could choose", () => {
    expect(DIRECT_BLOCK).not.toMatch(/private-capable/i);
    expect(DIRECT_BLOCK).not.toMatch(/funding screen/i);
    expect(DIRECT_BLOCK).not.toMatch(/TWO RAILS/);
  });
});
