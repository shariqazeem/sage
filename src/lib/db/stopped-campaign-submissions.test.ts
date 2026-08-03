import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_STOPPED_REASON,
  casSubmissionStatus,
  createCampaign,
  createSubmission,
  listPendingAutopilotSubmissionIds,
  resolveStoppedCampaignSubmissions,
  setCampaignStatus,
} from "./campaigns";
import { db } from "./index";
import { submissions } from "./schema";

/**
 * A STOPPED CAMPAIGN MUST NOT STRAND ITS TESTERS.
 *
 * When a founder stops a campaign the vault is revoked on-chain, so nothing on it can ever settle.
 * Before this, the submissions still awaiting judgment were simply left `pending`: the sweep re-ran
 * the whole decision pipeline over them every five minutes forever, the public board counted them as
 * "verifying", and the tester never got an answer. Measured on prod — two rows ~15 days old with
 * `decided_at` null, one of them a genuine own-words account of using the product.
 */

let seq = 0;
const wallet = () => `0x${(++seq).toString(16).padStart(40, "0")}`;

function seed(status = "live") {
  const c = createCampaign({
    title: "stopped-drill",
    rewardAmount: 1_000_000,
    vaultAddress: "0x0000000000000000000000000000000000000001",
    posterWallet: "0x0000000000000000000000000000000000000002",
    autonomy: "autopilot",
  });
  setCampaignStatus(c.id, status as never);
  return c;
}

const add = (campaignId: string, status?: string) => {
  const r = createSubmission({ campaignId, wallet: wallet() });
  if (!r.ok) throw new Error(r.error);
  if (status) db.update(submissions).set({ status }).where(eq(submissions.id, r.submission.id)).run();
  return r.submission.id;
};

const read = (id: string) =>
  db.select().from(submissions).where(eq(submissions.id, id)).get()!;

describe("resolveStoppedCampaignSubmissions", () => {
  it("resolves pending work with a reason that says what actually happened", () => {
    const c = seed();
    const id = add(c.id);
    setCampaignStatus(c.id, "cancelled" as never);

    expect(resolveStoppedCampaignSubmissions(c.id)).toBe(1);
    const row = read(id);
    expect(row.status).toBe("rejected");
    expect(row.rejectReason).toBe(CAMPAIGN_STOPPED_REASON);
    expect(row.decidedAt).toBeTruthy(); // it HAS been decided now — no longer limbo
  });

  it("the reason tells the tester it is not a verdict on their work", () => {
    // This text is what a real person reads after doing real work for nothing. It must not
    // imply the work was judged and found wanting.
    expect(CAMPAIGN_STOPPED_REASON).toMatch(/not a verdict on your work/i);
    expect(CAMPAIGN_STOPPED_REASON).toMatch(/stopped this campaign/i);
  });

  it("resolves approved-but-unsettled work too — a revoked vault cannot pay it either", () => {
    const c = seed();
    const id = add(c.id, "approved");
    expect(resolveStoppedCampaignSubmissions(c.id)).toBe(1);
    expect(read(id).status).toBe("rejected");
  });

  it("NEVER touches a settling row — that one may have a transaction in flight", () => {
    const c = seed();
    const id = add(c.id);
    expect(casSubmissionStatus(id, "pending", "settling")).toBe(true);

    expect(resolveStoppedCampaignSubmissions(c.id)).toBe(0);
    expect(read(id).status).toBe("settling");
  });

  it("never touches already-terminal rows, and is idempotent", () => {
    const c = seed();
    const paid = add(c.id, "paid");
    add(c.id); // one pending

    expect(resolveStoppedCampaignSubmissions(c.id)).toBe(1);
    expect(resolveStoppedCampaignSubmissions(c.id)).toBe(0); // second call is a no-op
    expect(read(paid).status).toBe("paid");
  });

  it("only touches the campaign it was given", () => {
    const stopped = seed();
    const live = seed();
    const a = add(stopped.id);
    const b = add(live.id);

    resolveStoppedCampaignSubmissions(stopped.id);
    expect(read(a).status).toBe("rejected");
    expect(read(b).status).toBe("pending");
  });
});

describe("the sweep stops re-judging work it can never settle", () => {
  it.each(["cancelled", "completed", "closed", "draft"])(
    "a %s campaign's pending rows are not swept",
    (status) => {
      const c = seed();
      const id = add(c.id);
      expect(listPendingAutopilotSubmissionIds()).toContain(id);

      setCampaignStatus(c.id, status as never);
      expect(listPendingAutopilotSubmissionIds()).not.toContain(id);
    },
  );

  it("still sweeps a live campaign's pending rows", () => {
    const c = seed();
    const id = add(c.id);
    expect(listPendingAutopilotSubmissionIds()).toContain(id);
  });
});
