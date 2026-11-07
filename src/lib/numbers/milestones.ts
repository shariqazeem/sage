import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { milestones } from "@/lib/db/schema";
import { notifyTelegram } from "@/lib/deputy/notify";
import { siteUrl } from "@/lib/site";
import { sageNumbers, type SageNumbers } from "./sage-numbers";

/**
 * MILESTONES (7 Nov 2026): when one of Sage's numbers first reaches a round figure, the operator chat
 * is told once, with a post drafted from the real numbers and the way to recount them.
 *
 * The sweep calls `checkMilestones` every tick. The first call ever records every figure already
 * passed without a message (the `seeded` row), so arriving on a database with history does not fire a
 * burst of stale news; from then on each new figure is announced exactly once (the key is the primary
 * key, and only the call whose insert lands sends the message). Nothing here calls a model.
 */
export type Series = "byAgent" | "people" | "jobsByAgent" | "teams" | "rounds";

export const MILESTONES: Record<Series, readonly number[]> = {
  byAgent: [10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000],
  people: [10, 25, 50, 100, 250, 500, 700, 1_000, 2_500, 5_000, 10_000],
  jobsByAgent: [10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000],
  teams: [1, 5, 10, 25, 50, 100, 250, 500, 1_000],
  rounds: [1, 10, 25, 50, 100, 250, 500, 1_000],
};

const SEEDED = "seeded";

export function seriesValue(n: SageNumbers, series: Series): number {
  return series === "byAgent" ? n.byAgent : series === "people" ? n.people : series === "jobsByAgent" ? n.jobsByAgent : series === "teams" ? n.teams : n.rounds;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The headline of a milestone, in plain words. */
export function milestoneHeadline(series: Series, threshold: number): string {
  const t = threshold.toLocaleString("en-US");
  switch (series) {
    case "byAgent":
      return `${t} payouts decided by Sage`;
    case "people":
      return `${t} people paid`;
    case "jobsByAgent":
      return `${t} jobs paid out by Sage`;
    case "teams":
      return threshold === 1 ? "The first team other than Sage paid people through Sage" : `${t} teams have paid people through Sage`;
    case "rounds":
      return threshold === 1 ? "The first weekly round paid its people" : `${t} weekly rounds paid`;
  }
}

/**
 * A post the founder can use as it is: one idea, real numbers read now, no thread. The link goes in
 * the first reply (the posting rule), and the recount is named so a reader can check the claim.
 */
export function milestoneDraft(series: Series, threshold: number, n: SageNumbers, site = siteUrl()): string {
  const host = site.replace(/^https?:\/\//, "");
  const facts = `${plural(n.byAgent, "payout", "payouts")} decided by the agent, to ${plural(n.people, "person", "people")}, across ${plural(n.jobs, "job", "jobs")}`;
  const lead =
    series === "byAgent"
      ? `Sage has now paid people ${threshold.toLocaleString("en-US")} times on its own decision.`
      : series === "people"
        ? `${threshold.toLocaleString("en-US")} different people have now been paid by Sage for work it checked.`
        : series === "jobsByAgent"
          ? `${threshold.toLocaleString("en-US")} jobs have now been paid out by Sage, each payout decided by the agent.`
          : series === "teams"
            ? threshold === 1
              ? "For the first time, a team other than us paid people through Sage."
              : `${threshold.toLocaleString("en-US")} teams have now paid people through Sage.`
            : threshold === 1
              ? "The first weekly round on Sage just paid its people, and next week's opens on its own."
              : `${threshold.toLocaleString("en-US")} weekly rounds on Sage have now paid their people.`;
  return [
    lead,
    "",
    `${facts}. Every payout names its evidence and has a receipt on chain, and anyone can recount them.`,
    "",
    "Proof of work, for people.",
    "",
    `First reply: ${host}/ledger`,
  ].join("\n");
}

export interface MilestoneResult {
  seeded: number;
  reached: { series: Series; threshold: number; value: number }[];
}

/** Record the figures now passed; announce the new ones. Idempotent: a figure is written and told once. */
export function checkMilestones(
  now: number,
  deps: { numbers?: SageNumbers; notify?: (text: string) => Promise<void> } = {},
): MilestoneResult {
  const n = deps.numbers ?? sageNumbers();
  const notify = deps.notify ?? notifyTelegram;
  const seeding = !db.select({ key: milestones.key }).from(milestones).where(eq(milestones.key, SEEDED)).get();
  const result: MilestoneResult = { seeded: 0, reached: [] };
  for (const series of Object.keys(MILESTONES) as Series[]) {
    const value = seriesValue(n, series);
    for (const threshold of MILESTONES[series]) {
      if (value < threshold) break;
      const wrote = db
        .insert(milestones)
        .values({ key: `${series}:${threshold}`, series, threshold, value, reachedAt: now, announced: !seeding })
        .onConflictDoNothing()
        .run();
      if (wrote.changes !== 1) continue;
      if (seeding) {
        result.seeded += 1;
        continue;
      }
      result.reached.push({ series, threshold, value });
    }
  }
  if (seeding) {
    db.insert(milestones).values({ key: SEEDED, series: SEEDED, threshold: 0, value: 0, reachedAt: now, announced: false }).onConflictDoNothing().run();
  }
  // one message per figure, the largest of a series last, so a jump past two figures reads in order
  for (const m of result.reached) {
    void notify(`<b>Milestone: ${milestoneHeadline(m.series, m.threshold)}</b>\nA post, if you want it:\n\n${milestoneDraft(m.series, m.threshold, n)}`).catch(() => undefined);
  }
  return result;
}

/** Every milestone reached, oldest first, for a page that shows them. */
export function reachedMilestones(): { series: Series; threshold: number; reachedAt: number }[] {
  return db
    .select()
    .from(milestones)
    .all()
    .filter((m) => m.key !== SEEDED)
    .map((m) => ({ series: m.series as Series, threshold: m.threshold, reachedAt: m.reachedAt }))
    .sort((a, b) => a.reachedAt - b.reachedAt);
}
