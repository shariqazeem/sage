import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, inspectionJobs, type InspectionStatus } from "@/lib/db/schema";
import { createInspectionJob, getInspectionJob } from "@/lib/db/inspection";
import { claimGift, holdsGift, makeGift } from "./gift";

/** A plan its owner gives away is taken once, by whoever signs in with the link, and never once it is paid for. */

const GIVER = "0x5555555555555555555555555555555555555555";
const BUILDER = "0x6666666666666666666666666666666666666666";
const LATER = "0x7777777777777777777777777777777777777777";
const NOW = 1_795_000_000;
let n = 0;

function plan(status = "ready", owner = GIVER): { id: string; publicCampaignId: string } {
  const { job } = createInspectionJob({
    founderWallet: owner,
    publicCampaignId: `launch-gift-${++n}`,
    productUrl: `https://acme${n}.example`,
    goal: "",
    targetUsers: "",
    totalBudgetBase: BigInt(20_000_000),
    tokenDecimals: 6,
    planningRequestId: `req-gift-${n}`,
  });
  db.update(inspectionJobs).set({ status: status as InspectionStatus }).where(eq(inspectionJobs.id, job.id)).run();
  return { id: job.id, publicCampaignId: job.publicCampaignId };
}

beforeEach(() => {
  vi.stubEnv("SAGE_SESSION_SECRET", "a-test-secret-of-enough-length");
  db.delete(inspectionJobs).run();
});
afterEach(() => vi.unstubAllEnvs());

describe("giving a test to its builder", () => {
  it("only the owner of a finished plan can make a gift", () => {
    const { id } = plan();
    expect(makeGift(id, BUILDER, NOW)).toEqual({ ok: false, reason: "not_yours" });
    expect(makeGift(plan("running").id, GIVER, NOW)).toEqual({ ok: false, reason: "not_giftable" });
    expect(makeGift(plan("ready", "anonymous").id, GIVER, NOW)).toEqual({ ok: false, reason: "not_yours" });
    const gift = makeGift(id, GIVER, NOW);
    expect(gift.ok).toBe(true);
  });

  it("the link's holder reads the plan as its owner, then takes it once", () => {
    const { id } = plan();
    const gift = makeGift(id, GIVER, NOW);
    if (!gift.ok) throw new Error("no gift");
    const job = getInspectionJob(id)!;
    expect(holdsGift(job, gift.code, NOW + 60)).toBe(true);
    expect(holdsGift(job, "1795000000.0000000000000000000000000000000000000000", NOW + 60)).toBe(false);

    expect(claimGift(id, gift.code, BUILDER, NOW + 120)).toEqual({ ok: true });
    expect(getInspectionJob(id)!.founderWallet.toLowerCase()).toBe(BUILDER);
    // the same link again is nobody's: the plan changed hands, so every copy of the code stopped working
    expect(claimGift(id, gift.code, LATER, NOW + 180)).toEqual({ ok: false, reason: "bad_code" });
    expect(holdsGift(getInspectionJob(id)!, gift.code, NOW + 180)).toBe(false);
    // the builder asking again is fine: it is theirs
    expect(claimGift(id, gift.code, BUILDER, NOW + 200)).toEqual({ ok: true });
  });

  it("an expired link takes nothing", () => {
    const { id } = plan();
    const gift = makeGift(id, GIVER, NOW);
    if (!gift.ok) throw new Error("no gift");
    expect(claimGift(id, gift.code, BUILDER, gift.expires + 1)).toEqual({ ok: false, reason: "bad_code" });
    expect(getInspectionJob(id)!.founderWallet).toBe(GIVER);
  });

  it("a plan that has been paid for is never given, and its link shows nothing", () => {
    const { id, publicCampaignId } = plan();
    const gift = makeGift(id, GIVER, NOW);
    if (!gift.ok) throw new Error("no gift");
    db.insert(campaigns)
      .values({ id: publicCampaignId, title: "Test", rewardAmount: 2_000_000, vaultAddress: "0x0000000000000000000000000000000000000001", posterWallet: GIVER, createdAt: NOW, status: "live" })
      .run();
    try {
      expect(makeGift(id, GIVER, NOW)).toEqual({ ok: false, reason: "launched" });
      expect(holdsGift(getInspectionJob(id)!, gift.code, NOW + 60)).toBe(false);
      expect(claimGift(id, gift.code, BUILDER, NOW + 60)).toEqual({ ok: false, reason: "launched" });
    } finally {
      db.delete(campaigns).where(eq(campaigns.id, publicCampaignId)).run();
    }
  });
});
