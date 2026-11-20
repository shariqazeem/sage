import "server-only";

import { sameFounder } from "@/lib/auth/founder";
import { v2Economics } from "@/lib/campaigns/v2-economics";
import { hasMissionPlan } from "@/lib/campaigns/vault-kind";
import { agentWalletAddressesOf } from "@/lib/db/agent-wallets";
import { listCampaigns, listSubmissions } from "@/lib/db/campaigns";
import { listInspectionJobs } from "@/lib/db/inspection";
import type { Campaign, InspectionJob, Submission } from "@/lib/db/schema";
import { short } from "@/lib/format";
import { cardOfCampaign, cardOfInspection, type HomeTest } from "./home-test-card";
import { testPath } from "./test-path";
import { hostOf } from "./when";

/**
 * YOUR TESTS, for Home when you are signed in: everything this person started, newest first, as
 * cards. A test is an inspection while Sage is trying the product, and a campaign once it is
 * funded, so the two lists are joined here: a campaign replaces the inspection it came from, and a
 * product tried several times shows its latest try.
 *
 * Ownership is read the way the Jobs screen reads it: the person's own wallet, plus every account
 * Sage holds for them (`agentWalletAddressesOf`).
 */
export interface HomeTests {
  tests: HomeTest[];
  /** how many more there are than the cards shown */
  more: number;
}

const SHOWN = 12;
type PlanKind = { questions?: unknown; plan?: { campaignKind?: unknown; missions?: unknown[] }; map?: { fieldTest?: { states?: unknown[]; pages?: unknown[] } } };

function lastEvent(subs: Submission[], rewardUsd: number): { event: string | null; at: number | null } {
  let latest: Submission | null = null;
  let latestAt = 0;
  for (const s of subs) {
    const at = s.decidedAt ?? s.createdAt;
    if (at >= latestAt) {
      latest = s;
      latestAt = at;
    }
  }
  if (!latest) return { event: null, at: null };
  const who = short(latest.wallet);
  if (latest.status === "paid") return { event: `Paid $${rewardUsd.toFixed(2)} to ${who}`, at: latestAt };
  if (latest.status === "rejected") return { event: `Not paid: ${who}`, at: latestAt };
  return { event: `${who} answered`, at: latestAt };
}

function ofCampaign(c: Campaign): HomeTest {
  const subs = listSubmissions(c.id);
  const paid = subs.filter((s) => s.status === "paid").length;
  const checking = subs.filter((s) => s.status === "pending" || s.status === "settling" || s.status === "approved").length;
  const econ = hasMissionPlan(c.vaultKind) ? v2Economics(c) : null;
  const total = econ ? econ.totalCompletions : c.maxRecipients;
  const surface = econ?.missions[0]?.targetSurface ?? "";
  const { event, at } = lastEvent(subs, c.rewardAmount / 1_000_000);
  return cardOfCampaign({
    id: c.id,
    href: testPath(c.id),
    host: (c.kind === "testing" ? hostOf(surface) : null) ?? c.title,
    status: c.status,
    total,
    paid,
    checking,
    event,
    at: at ?? c.createdAt,
  });
}

function ofInspection(job: InspectionJob): HomeTest | null {
  const result = job.result as PlanKind | null;
  // a gig or a grant written by hand is a job, not a test of a product: it lives under Jobs
  const kind = result?.plan?.campaignKind;
  if (kind === "gig" || kind === "grant") return null;
  const host = hostOf(job.productUrl);
  if (!host) return null;
  const ft = result?.map?.fieldTest;
  return cardOfInspection({
    id: job.id,
    href: testPath(job.id),
    host,
    status: job.status,
    steps: (ft?.states?.length ?? 0) || (ft?.pages?.length ?? 0),
    missions: result?.plan?.missions?.length ?? 0,
    // Sage's own question, up to its first dash: the card's last line, and the whole of it is on the test
    question: Array.isArray(result?.questions) && typeof result.questions[0] === "string" ? result.questions[0].split(/\s[—-]\s/)[0].replace(/[?.]$/, "") : null,
    at: job.updatedAt,
  });
}

export function homeTests(founder: string): HomeTests {
  const posters = [founder, ...agentWalletAddressesOf(founder)];
  const campaigns = listCampaigns().filter((c) => !c.sandbox && posters.some((p) => sameFounder(c.posterWallet, p)));
  const funded = new Set(campaigns.map((c) => c.id));

  const cards: HomeTest[] = campaigns.map(ofCampaign);
  const seenProduct = new Set<string>();
  for (const job of listInspectionJobs(founder)) {
    if (job.status === "superseded" || funded.has(job.publicCampaignId)) continue;
    // newest first: a product tried again shows its latest try only
    if (seenProduct.has(job.productUrl)) continue;
    seenProduct.add(job.productUrl);
    const card = ofInspection(job);
    if (card) cards.push(card);
  }
  // what needs you first, then what is moving, then the rest; newest first inside each
  const order: Record<HomeTest["state"], number> = { question: 0, ready: 1, trying: 2, live: 2, stopped: 3, done: 4 };
  cards.sort((a, b) => order[a.state] - order[b.state] || b.at - a.at);
  return { tests: cards.slice(0, SHOWN), more: Math.max(0, cards.length - SHOWN) };
}
