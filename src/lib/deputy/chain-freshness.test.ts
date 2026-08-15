import { describe, it, expect, vi } from "vitest";

vi.mock("./chain", () => ({ publicClient: vi.fn() }));

import { judgeHeadAge, freshnessHoldReason, MAX_HEAD_AGE_SECONDS } from "./chain-freshness";

/**
 * A DOWN RPC IS LOUD. A STALE ONE IS SILENT, AND FAR WORSE.
 *
 * Measured on prod (2026-08-15): a backend behind rpc.goat.network's anycast address sat at block
 * 14,594,173 for over ten hours while reporting `eth_syncing: false` with 3 peers. It answered every
 * request instantly and wrongly. A founder's vault deployed correctly and the server could not see
 * the receipt; the deploy hung with no error anywhere and nothing able to say why.
 *
 * The money property this guards: a settlement's nonce comes from the node's account state, so
 * broadcasting real USDC through a node ten hours behind is how a payout gets stuck, replaced, or
 * sent twice. Never sign against a chain we cannot show is current.
 */
const NOW = 1_760_000_000;

describe("judgeHeadAge", () => {
  it("a head seconds old is current", () => {
    expect(judgeHeadAge(14_605_000, NOW - 4, NOW)).toMatchObject({ fresh: true, reason: "current", headAgeSeconds: 4 });
  });

  it("THE MEASURED OUTAGE: a ten-hour-old head is stale, however healthy the node claims to be", () => {
    const v = judgeHeadAge(14_594_173, NOW - 37_800, NOW);
    expect(v).toMatchObject({ fresh: false, reason: "stale", blockNumber: 14_594_173 });
    expect(freshnessHoldReason(v)).toContain("10h");
  });

  it("an unreadable node is a VERDICT, not an exception — callers must decide the same way", () => {
    expect(judgeHeadAge(null, null, NOW)).toMatchObject({ fresh: false, reason: "unreadable" });
    expect(freshnessHoldReason(judgeHeadAge(null, null, NOW))).toContain("nothing was sent");
  });

  it("holds exactly at the boundary and passes just inside it", () => {
    expect(judgeHeadAge(1, NOW - MAX_HEAD_AGE_SECONDS, NOW).fresh).toBe(true);
    expect(judgeHeadAge(1, NOW - MAX_HEAD_AGE_SECONDS - 1, NOW).fresh).toBe(false);
  });

  it("a head slightly in the FUTURE is current — clock skew is not evidence of staleness", () => {
    expect(judgeHeadAge(1, NOW + 3, NOW)).toMatchObject({ fresh: true, headAgeSeconds: 0 });
  });

  it("normal jitter never trips it — a full minute behind is still current", () => {
    expect(judgeHeadAge(1, NOW - 60, NOW).fresh).toBe(true);
  });

  it("the hold sentence blames OUR node, never the tester's work", () => {
    const msg = freshnessHoldReason(judgeHeadAge(1, NOW - 37_800, NOW));
    expect(msg).toMatch(/our view of the network/i);
    expect(msg).not.toMatch(/evidence|submission|your work|tester/i);
  });
});
