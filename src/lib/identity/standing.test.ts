import { afterEach, describe, expect, it } from "vitest";
import { seedV2Campaign } from "@/lib/campaigns/campaign-v2.fixture";
import { casSubmissionStatus, createSubmission, updateSubmission } from "@/lib/db/campaigns";
import { linkWallets } from "@/lib/campaigns/wallet-links";
import { identityTiersArmed, standingOf } from "./standing";

/** Standing read from a real ledger: payouts, distinct campaigns, and recorded on-chain links. */
const payOn = (campaignId: string, missionIdHash: string, wallet: string, note: string) => {
  const c = createSubmission({ campaignId, wallet, note, missionIdHash });
  if (!c.ok) throw new Error(c.error);
  casSubmissionStatus(c.submission.id, "pending", "settling");
  casSubmissionStatus(c.submission.id, "settling", "paid");
  updateSubmission(c.submission.id, { payoutTx: `0x${"7".repeat(64)}`, decidedAt: 1_800_000_000 });
};

describe("standing on a real ledger", () => {
  afterEach(() => { delete process.env.IDENTITY_TIERS; });

  it("is off unless armed, because a tier gate over an empty board has nowhere to earn the key", () => {
    expect(identityTiersArmed({})).toBe(false);
    expect(identityTiersArmed({ IDENTITY_TIERS: "1" })).toBe(true);
  });

  it("counts payouts across distinct campaigns, and promotes on the second one", () => {
    const w = `0x${"5".repeat(40)}`;
    const a = seedV2Campaign({ wallet: `0x${"6".repeat(40)}` });
    payOn(a.campaign.id, a.mission.missionIdHash, w, "I opened the page and read the whole quickstart carefully, twice.");
    expect(standingOf(w)).toMatchObject({ tier: "newcomer", evidence: { paidCompletions: 1, distinctCampaigns: 1 } });
    const b = seedV2Campaign({ wallet: `0x${"7".repeat(40)}` });
    payOn(b.campaign.id, b.mission.missionIdHash, w, "I read the second product's docs and followed the steps end to end.");
    // the fixture posts both campaigns from one founder, so this is the shared-payer case: two
    // campaigns from the SAME payer still earn standing, but the payer count says so honestly.
    expect(standingOf(w)).toMatchObject({ tier: "established", evidence: { paidCompletions: 2, distinctCampaigns: 2, distinctPayers: 1 } });
  });

  it("a recorded on-chain link flags the wallet however good its record is", () => {
    const w = `0x${"8".repeat(40)}`;
    const a = seedV2Campaign({ wallet: `0x${"9".repeat(40)}` });
    payOn(a.campaign.id, a.mission.missionIdHash, w, "I opened it and worked through the whole flow as asked, carefully.");
    const b = seedV2Campaign({ wallet: `0x${"1".repeat(40)}` });
    payOn(b.campaign.id, b.mission.missionIdHash, w, "A second, different product, worked through end to end and written up.");
    expect(standingOf(w).tier).toBe("established");
    linkWallets(w, `0x${"2".repeat(40)}`);
    expect(standingOf(w).tier).toBe("flagged");
  });
});
