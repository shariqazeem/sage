import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { campaigns, programmeRounds, programmes } from "@/lib/db/schema";
import { createSubmission, getCampaign } from "@/lib/db/campaigns";
import { getInspectionJob } from "@/lib/db/inspection";
import { directCampaignSchema, type DirectCampaignInput } from "@/lib/launch/direct-campaign";
import { claimSeat, linkFor } from "@/lib/people/seats";
import type { TreasuryLaunch } from "@/lib/treasury/launch";
import { activateRoundOne } from "./activate";
import { GIVE_UP_AFTER_S, liveDeps, openDueRounds, RETRY_EVERY_S, roundSpec, roundTitle, type RoundDeps } from "./rounds";
import { createProgramme, DAY, getProgramme, getRound, listRounds } from "./store";

/**
 * TIME: THE SAME APPROVED JOB, EVERY WEEK, FOR THE SAME PEOPLE (rounds.ts, 6 Nov 2026).
 *
 * These hold the bargain a founder makes once for a whole season. Each round replays the approved spec,
 * never a new amount. The last round closes before the next opens, unless work in it is still moving.
 * A round is opened once, whatever retries and crashes do. One that can't open says why, retries, and is
 * eventually skipped so the schedule moves on.
 */

const FOUNDER = `0x${"f".repeat(40)}`;
let n = 0;

// each case is its own season: the sweep reads every due programme, so one case's must not be another's
beforeEach(() => {
  db.delete(programmeRounds).run();
  db.delete(programmes).run();
});

function spec(over: Partial<DirectCampaignInput> = {}): DirectCampaignInput {
  return directCampaignSchema.parse({
    kind: "gig",
    title: "Write a thread about Metis",
    milestones: [
      {
        title: "Write a thread about Metis",
        instructions: "Post a thread on X about building on Metis, carrying your wallet address.",
        criteria: ["The thread is public", "It carries your submitting wallet address"],
        evidence: { kind: "artifact_url", allowedHosts: [], markerKind: "wallet" },
        rewardUsd: 5,
        slots: 3,
      },
    ],
    visibility: "unlisted",
    ...over,
  });
}

/** A real compiled job (the same compiler the card uses) and a programme around it. */
function programme(over: { rounds?: number; spec?: DirectCampaignInput } = {}) {
  const s = over.spec ?? spec();
  const made = liveDeps.create(s, FOUNDER);
  if (!made.ok) throw new Error(made.error);
  const p = createProgramme({ founderWallet: FOUNDER, chainId: 1088, title: s.title, spec: s as unknown as Record<string, unknown>, roundBudgetBase: BigInt(15_000_000), everyDays: 7, roundsTotal: over.rounds ?? 3, round1JobId: made.jobId, now: 1_000 });
  return { p, round1JobId: made.jobId };
}

/** A campaign row the way a launch records it: its id is the job's public id. */
function recordCampaignFor(jobId: string): string {
  const job = getInspectionJob(jobId)!;
  db.insert(campaigns).values({ id: job.publicCampaignId, title: `round-${++n}`, rewardAmount: 5_000_000, vaultAddress: `0x${"9".repeat(40)}`, posterWallet: `0x${"7".repeat(40)}`, chainId: 1088, status: "live", visibility: "unlisted", createdAt: 1 }).run();
  return job.publicCampaignId;
}

function deps(over: Partial<RoundDeps> = {}) {
  const created: DirectCampaignInput[] = [];
  const launched: string[] = [];
  const closed: string[] = [];
  const told: string[] = [];
  const d: RoundDeps = {
    create: (s, f) => {
      created.push(s);
      return liveDeps.create(s, f);
    },
    launch: async (_f, jobId): Promise<TreasuryLaunch> => {
      launched.push(jobId);
      return { ok: true, campaignId: recordCampaignFor(jobId), vault: `0x${"9".repeat(40)}`, steps: [] };
    },
    close: async (id) => {
      closed.push(id);
      return { ok: true };
    },
    notify: async (t) => {
      told.push(t);
    },
    ...over,
  };
  return { d, created, launched, closed, told };
}

/** Round 1 launched from the card at t0. */
function startedSeason(over: { rounds?: number; spec?: DirectCampaignInput } = {}) {
  const { p, round1JobId } = programme(over);
  const c1 = recordCampaignFor(round1JobId);
  const t0 = 10_000;
  activateRoundOne(round1JobId, c1, 1088, t0);
  return { p: getProgramme(p.id)!, c1, t0 };
}

describe("a round's job is the approved job", () => {
  it("marks the round in the title and keeps every amount", () => {
    const { p } = programme();
    const r3 = roundSpec(p, 3, []);
    expect(r3.title).toBe("Write a thread about Metis (week 3)");
    expect(r3.milestones).toEqual(spec().milestones);
    expect(roundTitle("x".repeat(80), 12, 7).length).toBeLessThanOrEqual(80);
  });

  it("names the link holders on work for the founder's own people, and leaves public work public", () => {
    const { p } = programme();
    expect(roundSpec(p, 2, ["0xabc"]).allowlist).toEqual(["0xabc"]);
    const pub = programme({ spec: spec({ visibility: "listed" }) }).p;
    expect(roundSpec(pub, 2, ["0xabc"]).allowlist).toBeUndefined();
  });
});

describe("the season", () => {
  it("starts when round 1 is live, with round 2 one week on", () => {
    const { p, t0 } = startedSeason();
    expect(p.status).toBe("active");
    expect(p.nextRoundAt).toBe(t0 + 7 * DAY);
    expect(getRound(p.id, 1)?.status).toBe("live");
  });

  it("does nothing before a round is due", async () => {
    const { t0 } = startedSeason();
    const { d, launched } = deps();
    await openDueRounds(t0 + 7 * DAY - 1, d);
    expect(launched).toHaveLength(0);
  });

  it("closes last week, opens this week for the same people, and says so", async () => {
    const { p, c1, t0 } = startedSeason();
    const { code } = linkFor({ programmeId: p.id }, FOUNDER, 3);
    const person = `0x${"1".repeat(40)}`;
    claimSeat(code, person, { currentCampaign: () => ({ campaignId: c1, ended: false }) });
    const { d, closed, launched, created, told } = deps();
    const due = t0 + 7 * DAY;
    const sum = await openDueRounds(due, d);
    expect(sum).toMatchObject({ opened: 1, closed: 1 });
    expect(closed).toEqual([c1]);
    expect(launched).toHaveLength(1);
    expect(created[0]!.allowlist).toEqual([person]);
    expect(created[0]!.milestones[0]!.rewardUsd).toBe(5); // the founder's amount, never a new one
    const r2 = getRound(p.id, 2)!;
    expect(r2.status).toBe("live");
    expect(getCampaign(r2.campaignId!)!.allowlist).toEqual([person]);
    expect(getRound(p.id, 1)!.closedAt).toBe(due);
    expect(getProgramme(p.id)!.nextRoundAt).toBe(due + 7 * DAY);
    expect(told[0]).toMatch(/opened "Write a thread about Metis" week 2 of 3/);
  });

  it("waits while work in last week's round is still moving", async () => {
    const { c1, t0 } = startedSeason();
    createSubmission({ campaignId: c1, wallet: `0x${"2".repeat(40)}`, evidenceUrl: "https://x.com/a/status/1" });
    const { d, launched, closed } = deps();
    const sum = await openDueRounds(t0 + 7 * DAY, d);
    expect(sum.waiting).toBe(1);
    expect(launched).toHaveLength(0);
    expect(closed).toHaveLength(0);
  });

  it("a round that can't open says why, retries every 6 hours with the SAME job, then is skipped", async () => {
    const { p, t0 } = startedSeason();
    const launch = vi.fn(async (): Promise<TreasuryLaunch> => ({ ok: false, reason: "insufficientBalance" as never, message: "Your account holds $2.00; this round needs $15.00." }));
    const { d, created, told } = deps({ launch });
    const due = t0 + 7 * DAY;
    await openDueRounds(due, d);
    expect(getRound(p.id, 2)).toMatchObject({ status: "failed", error: "Your account holds $2.00; this round needs $15.00." });
    expect(told[0]).toMatch(/could not open yet/);
    await openDueRounds(due + 60, d); // inside the retry window: nothing
    expect(launch).toHaveBeenCalledTimes(1);
    await openDueRounds(due + RETRY_EVERY_S + 1, d);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(created).toHaveLength(1); // compiled once, launched twice: never two jobs for one round
    expect(told).toHaveLength(1); // told once, not every retry
    await openDueRounds(due + GIVE_UP_AFTER_S + 1, d);
    expect(getRound(p.id, 2)!.status).toBe("skipped");
    expect(getProgramme(p.id)!.nextRoundAt).toBe(due + 7 * DAY);
  });

  it("picks up a round whose vault was recorded before a crash, and never launches it again", async () => {
    const { p, t0 } = startedSeason();
    let crashed = false;
    const { d } = deps({
      launch: async (_f, jobId) => {
        recordCampaignFor(jobId); // the vault landed and was recorded…
        crashed = true;
        throw new Error("process died"); // …and then the process did
      },
    });
    await openDueRounds(t0 + 7 * DAY, d);
    expect(crashed).toBe(true);
    const launch = vi.fn();
    await openDueRounds(t0 + 7 * DAY + RETRY_EVERY_S + 1, { ...d, launch });
    expect(launch).not.toHaveBeenCalled();
    expect(getRound(p.id, 2)!.status).toBe("live");
  });

  it("closes the last round after its week, and the season ends", async () => {
    const { p, t0 } = startedSeason({ rounds: 2 });
    const { d, closed } = deps();
    await openDueRounds(t0 + 7 * DAY, d); // round 2 of 2
    expect(listRounds(p.id).map((r) => r.status)).toEqual(["live", "live"]);
    await openDueRounds(t0 + 14 * DAY, d);
    expect(closed).toHaveLength(2);
    expect(getProgramme(p.id)!.status).toBe("ended");
    expect(getProgramme(p.id)!.nextRoundAt).toBeNull();
  });
});
