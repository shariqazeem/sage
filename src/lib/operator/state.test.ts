import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { seedV2Campaign } from "@/lib/campaigns/campaign-v2.fixture";
import { observe } from "./state";

/**
 * A campaign with no slot left is not running. The founder's own account had three fully-paid
 * campaigns still marked live, and the mandate refused every move with "3 campaigns are already
 * running" — a concurrency ceiling spent on work that could not take a single further submission.
 */
describe("observe — a campaign with no slot left is not running", () => {
  it("live with an open slot; ended once every slot is paid", () => {
    const f = seedV2Campaign({
      founder: `0x${"c".repeat(40)}`,
      missions: [{ missionKey: "load", rewardBase: BigInt(500_000), maxCompletions: BigInt(1) }],
      vaultAddress: `0x${"d".repeat(40)}`,
    });
    const before = observe(f.campaign, 1_800_000_000);
    expect(before.status).toBe("live");
    expect(before.unclaimedBase).toBe(500_000);

    db.update(submissions)
      .set({ status: "paid", payoutTx: `0x${"e".repeat(64)}` })
      .where(eq(submissions.id, f.submission.id))
      .run();
    const after = observe(f.campaign, 1_800_000_000);
    expect(after.status).toBe("ended");
    expect(after.paid).toBe(1);
    expect(after.unclaimedBase).toBe(0);
  });
});
