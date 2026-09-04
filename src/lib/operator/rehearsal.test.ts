import { beforeEach, describe, expect, it } from "vitest";
import { seedV2Campaign } from "@/lib/campaigns/campaign-v2.fixture";
import { upsertMandate, listLaunches } from "@/lib/db/operator";
import { chooseWithoutModel } from "./decide";
import { __clearRehearsalCache, rehearse } from "./rehearsal";

/**
 * ALIVE AT $0. The operator page rendered nothing for an unfunded founder. A rehearsal is the same
 * decision — same closed surface set, same ceilings, same sizing — against an imagined treasury one
 * probe above the floor, and it records nothing.
 */
describe("rehearse — the move Sage would make", () => {
  beforeEach(() => __clearRehearsalCache());

  it("a founder with a product and no money sees a sized, reasoned move — and no launch row", async () => {
    const f = seedV2Campaign({ wallet: `0x${"3".repeat(40)}` });
    const founder = f.campaign.posterWallet;
    upsertMandate(founder, { productUrl: "https://example-shop.dev", goal: "find where checkout breaks" });
    const r = await rehearse(founder, { choose: async (i) => chooseWithoutModel(i), nowSec: 1_800_000_000 });
    expect(r).not.toBeNull();
    expect(r!.recorded).toBe(false);
    expect(r!.because).toBeNull();
    expect(r!.budgetBase).toBeGreaterThan(0);
    expect(r!.line).toMatch(/\$\d/);
    expect(r!.assumesFundingBase).toBeGreaterThan(r!.budgetBase);
    expect(listLaunches(founder)).toEqual([]);
  });

  it("with nothing to decide against it says what is missing instead of inventing a surface", async () => {
    const founder = `0x${"4".repeat(40)}`;
    const r = await rehearse(founder, { choose: async (i) => chooseWithoutModel(i), nowSec: 1_800_000_000 });
    expect(r?.because).toMatch(/name your product/);
    expect(r?.line).toBe("");
  });
});
