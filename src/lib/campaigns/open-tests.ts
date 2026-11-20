import "server-only";
import { getCampaign } from "@/lib/db/campaigns";
import { marketplace, type MarketplaceRow } from "./marketplace";

/**
 * OPEN TESTS (relaunch, 20 Nov 2026). Earn and Home invite people to try new products, so they list only
 * testing work: the board's own rows (`marketplace()`, which already keeps only work that can pay right
 * now), narrowed to campaigns whose kind is `testing`. Gigs, bounties and grants still have their own
 * pages; they are just not what "get paid to try new products" offers.
 */
export type OpenTests = {
  rows: MarketplaceRow[];
  /** places open across those rows, and how many distinct tests they belong to */
  places: number;
  tests: number;
};

export function openTests(rows: readonly MarketplaceRow[] = marketplace().rows, kindOf = (id: string) => getCampaign(id)?.kind ?? null): OpenTests {
  const kinds = new Map<string, string | null>();
  const isTest = (id: string): boolean => {
    if (!kinds.has(id)) kinds.set(id, kindOf(id));
    return kinds.get(id) === "testing";
  };
  const only = rows.filter((r) => isTest(r.campaignId));
  return {
    rows: only,
    places: only.reduce((sum, r) => sum + Math.max(0, r.remainingSlots), 0),
    tests: new Set(only.map((r) => r.campaignId)).size,
  };
}
