import { beforeEach, describe, expect, it } from "vitest";
import { seedV2Campaign } from "@/lib/campaigns/campaign-v2.fixture";
import { upsertMandate, listLaunches } from "@/lib/db/operator";
import { chooseWithoutModel } from "./decide";
import { __clearRehearsalCache, forgetRehearsal, rehearse } from "./rehearsal";

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

  it("a full board says WHEN and still shows the move that follows — the founder's own case", async () => {
    // Three live campaigns against the default ceiling of three; small missions so exposure does not bind.
    // The fixture files a campaign under `founder` (the poster), not `wallet` (the tester).
    const owner = `0x${"5".repeat(40)}`;
    const small = [{ missionKey: "load", rewardBase: BigInt(500_000), maxCompletions: BigInt(1) }];
    let founder = owner;
    for (let i = 0; i < 3; i++) {
      const f = seedV2Campaign({ founder: owner, missions: small, vaultAddress: `0x${String(6 + i).repeat(40)}` });
      founder = f.campaign.posterWallet;
    }
    upsertMandate(founder, { productUrl: "https://example-shop.dev", goal: "find where checkout breaks" });
    const r = await rehearse(founder, { choose: async (i) => chooseWithoutModel(i), nowSec: 1_800_000_000 });
    expect(r?.because).toBeNull();
    expect(r?.timing).toMatch(/3 campaigns are already running — the mandate allows 3 at once/);
    expect(r?.budgetBase).toBeGreaterThan(0);
    expect(r?.line).toMatch(/\$\d/);
    expect(listLaunches(founder)).toEqual([]);
  });

  it("a hold that is not about concurrency stays the answer — no move is invented", async () => {
    // One campaign with $15 unclaimed against an imagined $15 treasury: the exposure rule binds, and
    // lifting concurrency cannot help. Buying the same silence twice is what the mandate refuses.
    const big = [{ missionKey: "load", rewardBase: BigInt(5_000_000), maxCompletions: BigInt(3) }];
    const f = seedV2Campaign({ founder: `0x${"7".repeat(40)}`, missions: big, vaultAddress: `0x${"9".repeat(40)}` });
    const founder = f.campaign.posterWallet;
    upsertMandate(founder, { productUrl: "https://example-shop.dev", goal: "find where checkout breaks" });
    const r = await rehearse(founder, { choose: async (i) => chooseWithoutModel(i), nowSec: 1_800_000_000 });
    expect(r?.timing ?? null).toBeNull();
    expect(r?.because).toMatch(/already on the board unclaimed/);
    expect(r?.line).toBe("");
  });

  it("naming the product forgets the cached 'name your product' — the page answers the save at once", async () => {
    const founder = `0x${"8".repeat(40)}`;
    const nowSec = 1_800_000_000;
    const before = await rehearse(founder, { nowSec });
    expect(before?.because).toMatch(/name your product/);
    upsertMandate(founder, { productUrl: "https://example-shop.dev", goal: "find where checkout breaks" });
    // Without forgetting, the ten-minute cache would keep answering the old way.
    forgetRehearsal(founder);
    const after = await rehearse(founder, { choose: async (i) => chooseWithoutModel(i), nowSec });
    expect(after?.because).toBeNull();
    expect(after?.line).toMatch(/\$\d/);
  });

  it("with nothing to decide against it says what is missing instead of inventing a surface", async () => {
    const founder = `0x${"4".repeat(40)}`;
    const r = await rehearse(founder, { choose: async (i) => chooseWithoutModel(i), nowSec: 1_800_000_000 });
    expect(r?.because).toMatch(/name your product/);
    expect(r?.line).toBe("");
  });
});
