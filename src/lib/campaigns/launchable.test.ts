import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { inspectionJobs } from "@/lib/db/schema";
import { createInspectionJob } from "@/lib/db/inspection";
import { createRevision } from "@/lib/db/plan-revisions";
import { createCampaign } from "@/lib/db/campaigns";
import { listLaunchablePlans } from "./launchable";

/**
 * A PLAN IS NOT A CAMPAIGN — but it must be findable. Measured live 2026-08-27: "launch it" was
 * answered "no campaign by that name, it did not launch" three times while the ready gig plan sat
 * in the database, because the campaigns listing could not see unlaunched plans. This suite pins
 * the definition of "launchable" that both the launch tool's server-side resolution and
 * sage_my_campaigns' readyToLaunch listing share.
 */

const F = "0x00000000000000000000000000000000000000b7";
let n = 0;

function seedJob(opts: {
  goal: string;
  publicCampaignId: string;
  url?: string;
  ready?: boolean;
  withRevision?: boolean;
  founder?: string;
}) {
  const founder = opts.founder ?? F;
  const { job } = createInspectionJob({
    founderWallet: founder,
    publicCampaignId: opts.publicCampaignId,
    productUrl: opts.url ?? "https://sagepays.xyz",
    repoUrl: null,
    goal: opts.goal,
    targetUsers: "",
    totalBudgetBase: BigInt(1_000_000),
    tokenDecimals: 6,
    planningRequestId: `prid:test:launchable-${++n}`,
    surface: "test",
  });
  if (opts.ready !== false) db.update(inspectionJobs).set({ status: "ready" }).where(eq(inspectionJobs.id, job.id)).run();
  if (opts.withRevision !== false) {
    const plan: Record<string, unknown> = {
      publicCampaignId: opts.publicCampaignId,
      status: "draft",
      revision: 1,
      productMapDigest: "0xmap",
      missions: [],
      totalBudgetBase: BigInt(1_000_000),
      allocatedBase: BigInt(1_000_000),
      tokenDecimals: 6,
      campaignIdHash: "0xcamp",
      missionPlanDigest: `0xplan-launchable-${n}`,
      openQuestions: [],
      modelVersion: "m",
      promptVersion: "p",
    };
    createRevision({
      jobId: job.id,
      authorWallet: founder,
      reason: "generated",
      plan: plan as never,
      budgetBase: BigInt(1_000_000),
      validationOk: true,
    });
  }
  return job;
}

describe("listLaunchablePlans — ready + revisioned + not yet live, by name", () => {
  it("lists the unlaunched gig BY ITS TITLE and the testing plan by host; excludes launched, unready, and revisionless", () => {
    seedJob({ goal: "Direct gig campaign: Deliverable proof run", publicCampaignId: "gig-lp1" });
    seedJob({ goal: "first impressions", publicCampaignId: "lp-testing1", url: "https://acme.dev/start" });

    const live = createCampaign({
      title: "already live",
      rewardAmount: 1_000_000,
      vaultAddress: `0x${"7".repeat(40)}`,
      posterWallet: F,
      chainId: 2345,
      status: "live",
    });
    seedJob({ goal: "Direct gig campaign: already live", publicCampaignId: live.id }); // launched — a campaign now
    seedJob({ goal: "not ready yet", publicCampaignId: "lp-unready", ready: false });
    seedJob({ goal: "no revision", publicCampaignId: "lp-norev", withRevision: false });

    const plans = listLaunchablePlans(F);
    const ids = plans.map((p) => p.publicCampaignId);
    expect(ids).toContain("gig-lp1");
    expect(ids).toContain("lp-testing1");
    expect(ids).not.toContain(live.id);
    expect(ids).not.toContain("lp-unready");
    expect(ids).not.toContain("lp-norev");

    // THE fix: the founder's own name for the work is what the listing shows.
    const gig = plans.find((p) => p.publicCampaignId === "gig-lp1")!;
    expect(gig.kind).toBe("gig");
    expect(gig.title).toBe("Deliverable proof run");
    expect(gig.budgetUsd).toBe("1.00");
    expect(gig.inspectionId).toBeTruthy();

    const testing = plans.find((p) => p.publicCampaignId === "lp-testing1")!;
    expect(testing.kind).toBe("testing");
    expect(testing.title).toBe("acme.dev testing plan");
  });

  it("is founder-scoped: another wallet's ready plan never appears", () => {
    const other = "0x00000000000000000000000000000000000000c9";
    seedJob({ goal: "Direct grant campaign: theirs", publicCampaignId: "grant-lp-other", founder: other });
    expect(listLaunchablePlans(F).map((p) => p.publicCampaignId)).not.toContain("grant-lp-other");
    expect(listLaunchablePlans(other).map((p) => p.publicCampaignId)).toContain("grant-lp-other");
  });
});
