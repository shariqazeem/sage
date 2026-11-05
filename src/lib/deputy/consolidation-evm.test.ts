import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE PAYOUT-FORWARDING WATCH ON METIS.
 *
 * Written for Starknet, where the farm was caught; when Metis became the one network, the strongest
 * identity signal Sage has stopped being read (found 5 Nov 2026). Same rule, EVM logs.
 */
const h = vi.hoisted(() => ({
  paid: [] as { submissionId: string; campaignId: string; wallet: string; chainId: number }[],
  links: [] as [string, string][],
  events: [] as string[],
  submitters: new Set<string>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/campaigns", () => ({
  isKnownSubmitterWallet: (w: string) => h.submitters.has(w.toLowerCase()),
  listRecentPaidStarknetSubmissions: () => [],
  listRecentPaidEvmSubmissions: () => h.paid,
  recordEvent: (e: { kind: string }) => h.events.push(e.kind),
}));
vi.mock("@/lib/campaigns/wallet-links", () => ({ linkWallets: (a: string, b: string) => { h.links.push([a, b]); return { linked: true }; } }));
vi.mock("./notify", () => ({ notifyTelegram: async () => {} }));

import { watchPayoutConsolidationEvm, type EvmLogReader } from "./consolidation";
import { linkedClusterSignal } from "./cluster-signal";

const W = (n: number) => `0x${String(n).repeat(40).slice(0, 40)}`;
const HUB = `0x${"f".repeat(40)}`;

beforeEach(() => {
  h.paid = [];
  h.links = [];
  h.events = [];
  h.submitters = new Set();
});

const reader = (outbound: Record<string, string[]>): EvmLogReader => ({
  head: async () => BigInt(5_000_000),
  transfersFrom: async (_c, _t, from) => (outbound[from.toLowerCase()] ?? []).map((to) => ({ to: to.toLowerCase() })),
});

describe("watchPayoutConsolidationEvm", () => {
  it("links two Metis payouts that meet in one hub wallet", async () => {
    h.paid = [1, 2].map((n) => ({ submissionId: `s${n}`, campaignId: "job", wallet: W(n), chainId: 1088 }));
    const r = await watchPayoutConsolidationEvm({ reader: reader({ [W(1)]: [HUB], [W(2)]: [HUB] }) });
    expect(r).toEqual({ scanned: 2, linked: 2 });
    expect(h.events).toEqual(["wallet_cluster", "wallet_cluster"]);
  });

  it("links a payout forwarded to a wallet that itself submitted", async () => {
    h.paid = [{ submissionId: "s1", campaignId: "job", wallet: W(1), chainId: 1088 }];
    h.submitters.add(HUB);
    const r = await watchPayoutConsolidationEvm({ reader: reader({ [W(1)]: [HUB] }) });
    expect(r.linked).toBe(1);
  });

  it("a worker who keeps their pay, or sends it to one stranger, links nothing", async () => {
    h.paid = [1, 2].map((n) => ({ submissionId: `s${n}`, campaignId: "job", wallet: W(n), chainId: 1088 }));
    const r = await watchPayoutConsolidationEvm({ reader: reader({ [W(1)]: [`0x${"a".repeat(40)}`] }) });
    expect(r.linked).toBe(0);
  });

  it("an unreadable network is never an accusation", async () => {
    h.paid = [1, 2].map((n) => ({ submissionId: `s${n}`, campaignId: "job", wallet: W(n), chainId: 1088 }));
    const r = await watchPayoutConsolidationEvm({ reader: { head: async () => { throw new Error("rpc down"); }, transfersFrom: async () => [] } });
    expect(r).toEqual({ scanned: 0, linked: 0 });
  });
});

describe("linkedClusterSignal — HIGH on EVM as on Starknet", () => {
  const lower = (w: string) => w.toLowerCase();
  it("flags a submitter linked to another submitter of the same job", () => {
    const s = linkedClusterSignal(W(1), [W(1), W(2), W(3)], () => [W(2).toUpperCase().replace("0X", "0x")], lower);
    expect(s?.severity).toBe("high");
    expect(s?.signal).toBe("wallet cluster");
  });
  it("says nothing about a link to someone who never submitted to this job", () => {
    expect(linkedClusterSignal(W(1), [W(1), W(3)], () => [W(2)], lower)).toBeNull();
  });
});
