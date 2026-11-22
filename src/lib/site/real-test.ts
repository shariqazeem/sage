import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { getCampaign, listMissions, listSubmissions } from "@/lib/db/campaigns";
import { openRetestOf } from "@/lib/report";
import { v2Economics } from "@/lib/campaigns/v2-economics";
import { getInspectionJob } from "@/lib/db/inspection";
import { inspectionJobs, type InspectionJob } from "@/lib/db/schema";
import { short } from "@/lib/format";
import { isOwnWallet } from "@/lib/campaigns/settled-ledger";
import { sharingFor } from "@/lib/sharing";
import { framesOf, type RealFrame } from "./real-test-frames";
import { hostOf } from "./when";

/**
 * "A REAL TEST", for the front door: the latest test Sage actually ran in its own browser, with the
 * frames it captured and, when people then tried the product, who was paid.
 *
 * Everything here is a row or a file that exists. If no run qualifies, this returns null and the
 * section is omitted: an invented example would be the first lie a stranger reads.
 *
 * WHICH RUN MAY BE SHOWN TO A STRANGER. A finished run of a public address only: never one where
 * the builder gave Sage a test account (those frames can show a signed-in screen), and never a
 * frame whose file is not on disk. And only with consent: a builder's product reaches Sage's front
 * door when that builder made the test's findings public (`campaign_sharing.findings_public`), or the
 * test is Sage's own. `SAGE_HOME_TEST_ID` pins one run by its id, for when the founder wants a
 * particular product on the front door.
 */
export interface RealTestPerson {
  handle: string;
  state: "paid" | "checking";
  amount: number;
  proofPath: string | null;
}

export interface RealTest {
  inspectionId: string;
  host: string;
  productName: string | null;
  /** unix seconds the run started */
  at: number;
  /** every step Sage took, not only the frames shown */
  steps: number;
  seconds: number | null;
  frames: RealFrame[];
  missions: string[];
  people: RealTestPerson[];
  paid: number;
}

const MIN_FRAMES = 3;
const SCAN = 40;

type StoredResult = {
  map?: { productName?: unknown; fieldTest?: unknown };
  plan?: { missions?: { title?: unknown }[]; campaignKind?: unknown };
};

function onDisk(inspectionId: string, n: number): boolean {
  return existsSync(path.join(process.cwd(), "public", "field-tests", inspectionId, `${n}.png`));
}

/** A funded test with places still open: its frames carry what the judge checks answers against. */
function stillOpen(campaignId: string): boolean {
  const c = campaignId ? getCampaign(campaignId) : null;
  if (!c || c.status !== "live") return false;
  const e = v2Economics(c);
  return !(e.totalCompletions > 0 && e.paidCompletions >= e.totalCompletions);
}

/** A builder's product is shown to strangers only with their yes, or when the test is Sage's own. */
export function consented(job: Pick<InspectionJob, "founderWallet" | "publicCampaignId">): boolean {
  if (isOwnWallet(job.founderWallet)) return true;
  return !!job.publicCampaignId && sharingFor(job.publicCampaignId).findingsPublic;
}

function fromJob(job: InspectionJob, pinned = false): RealTest | null {
  if (job.status !== "ready" || job.testAccountSealed) return null;
  if (!pinned && !consented(job)) return null;
  // NO CORPUS ORACLE: a test still taking answers never shows its frames on the front door, pinned or not, and
  // neither does a finished one while the same builder's later test of that product is open (openRetestOf).
  if (stillOpen(job.publicCampaignId)) return null;
  const tested = job.publicCampaignId ? getCampaign(job.publicCampaignId) : null;
  if (tested && openRetestOf(tested)) return null;
  const host = hostOf(job.productUrl);
  const result = job.result as StoredResult | null;
  if (!host || !result?.map?.fieldTest) return null;
  const run = framesOf(result.map.fieldTest, host, 4);
  if (!run) return null;
  const frames = run.frames.filter((f) => onDisk(job.id, f.file));
  if (frames.length < MIN_FRAMES) return null;

  const campaign = getCampaign(job.publicCampaignId);
  const people: RealTestPerson[] = [];
  if (campaign && !campaign.sandbox) {
    const reward = new Map(listMissions(campaign.id).map((m) => [m.missionIdHash, m.rewardAmount]));
    for (const s of listSubmissions(campaign.id)) {
      if (s.status !== "paid" && s.status !== "pending" && s.status !== "settling" && s.status !== "approved") continue;
      people.push({
        handle: short(s.wallet),
        state: s.status === "paid" ? "paid" : "checking",
        amount: ((s.missionIdHash ? reward.get(s.missionIdHash) : undefined) ?? campaign.rewardAmount) / 1_000_000,
        proofPath: s.status === "paid" && s.payoutTx ? `/proof/${s.payoutTx}` : null,
      });
    }
  }

  return {
    inspectionId: job.id,
    host,
    productName: typeof result.map.productName === "string" ? result.map.productName : null,
    at: job.createdAt,
    steps: run.steps,
    seconds: run.seconds,
    frames: frames.map((f) => ({ ...f, src: `/api/field-tests/${job.id}/${f.file}` })),
    missions: (result.plan?.missions ?? []).map((m) => (typeof m.title === "string" ? m.title : "")).filter(Boolean),
    people: people.slice(0, 6),
    paid: people.filter((p) => p.state === "paid").length,
  };
}

export function realTest(): RealTest | null {
  try {
    const pinned = process.env.SAGE_HOME_TEST_ID?.trim();
    if (pinned) {
      const job = getInspectionJob(pinned);
      const shown = job ? fromJob(job, true) : null;
      if (shown) return shown;
    }
    const jobs = db
      .select()
      .from(inspectionJobs)
      .where(and(eq(inspectionJobs.status, "ready"), isNull(inspectionJobs.testAccountSealed)))
      .orderBy(desc(inspectionJobs.createdAt))
      .limit(SCAN)
      .all();
    let latest: RealTest | null = null;
    for (const job of jobs) {
      const shown = fromJob(job);
      if (!shown) continue;
      // a run that people were then paid for is the whole story; otherwise the latest run
      if (shown.paid > 0) return shown;
      latest ??= shown;
    }
    return latest;
  } catch {
    // the front door still opens when a stored run cannot be read
    return null;
  }
}
