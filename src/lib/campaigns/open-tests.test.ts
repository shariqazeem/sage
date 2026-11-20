import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { MarketplaceRow } from "./marketplace";
import { openTests } from "./open-tests";

/** Earn and Home invite people to try products: only testing work is listed, counted from the board's own rows. */

const row = (campaignId: string, remainingSlots: number): MarketplaceRow =>
  ({ key: `${campaignId}:${remainingSlots}`, campaignId, remainingSlots } as unknown as MarketplaceRow);

const kinds: Record<string, "testing" | "gig" | "grant"> = { t1: "testing", t2: "testing", g1: "gig", r1: "grant" };

describe("openTests", () => {
  it("keeps testing work only, and counts its places and tests", () => {
    const out = openTests([row("t1", 3), row("t1", 2), row("g1", 5), row("t2", 1), row("r1", 4)], (id) => kinds[id] ?? null);
    expect(out.rows.map((r) => r.campaignId)).toEqual(["t1", "t1", "t2"]);
    expect(out.places).toBe(6);
    expect(out.tests).toBe(2);
  });

  it("drops a campaign it can't find", () => {
    expect(openTests([row("gone", 3)], () => null)).toEqual({ rows: [], places: 0, tests: 0 });
  });
});
