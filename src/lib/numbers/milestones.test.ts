import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { db } from "@/lib/db";
import { milestones } from "@/lib/db/schema";
import { checkMilestones, milestoneDraft, milestoneHeadline, reachedMilestones } from "./milestones";
import type { SageNumbers } from "./sage-numbers";

/**
 * MILESTONES (7 Nov 2026): told once, never a burst of stale news, and every draft is built from the
 * real numbers.
 */

const numbers = (over: Partial<SageNumbers> = {}): SageNumbers => ({
  payouts: 0,
  byAgent: 0,
  paidUsd: 0,
  people: 0,
  paidAgain: 0,
  jobs: 0,
  jobsByAgent: 0,
  teams: 0,
  grants: { completed: 0, paying: 0 },
  rounds: 0,
  ownWallets: { payouts: 0, paidUsd: 0 },
  total: { payouts: 0, paidUsd: 0 },
  refused: 0,
  ...over,
});

const told = () => {
  const sent: string[] = [];
  return { sent, notify: async (t: string) => void sent.push(t) };
};

beforeEach(() => {
  db.delete(milestones).run();
});

describe("checkMilestones", () => {
  it("the first run records what was already passed without a word", () => {
    const t = told();
    const r = checkMilestones(1000, { numbers: numbers({ byAgent: 41, people: 22, jobsByAgent: 12 }), notify: t.notify });
    expect(r.reached).toEqual([]);
    // byAgent 10, 25; people 10; jobsByAgent 10
    expect(r.seeded).toBe(4);
    expect(t.sent).toEqual([]);
  });

  it("then each new figure is told once, however many sweeps see it", async () => {
    const t = told();
    checkMilestones(1000, { numbers: numbers({ byAgent: 41 }), notify: t.notify });
    const first = checkMilestones(2000, { numbers: numbers({ byAgent: 52 }), notify: t.notify });
    const again = checkMilestones(3000, { numbers: numbers({ byAgent: 53 }), notify: t.notify });
    await Promise.resolve();
    expect(first.reached).toEqual([{ series: "byAgent", threshold: 50, value: 52 }]);
    expect(again.reached).toEqual([]);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toContain("50 payouts decided by Sage");
  });

  it("a figure first reached after the table arrived is never swallowed by the seeding", async () => {
    const t = told();
    checkMilestones(1000, { numbers: numbers({ byAgent: 41, teams: 0 }), notify: t.notify });
    const r = checkMilestones(2000, { numbers: numbers({ byAgent: 41, teams: 1, people: 9, jobs: 3 }), notify: t.notify });
    await Promise.resolve();
    expect(r.reached).toEqual([{ series: "teams", threshold: 1, value: 1 }]);
    expect(t.sent[0]).toContain("The first team other than Sage paid people through Sage");
  });

  it("a jump past two figures tells both, in order", () => {
    const t = told();
    checkMilestones(1000, { numbers: numbers({ byAgent: 30 }), notify: t.notify });
    const r = checkMilestones(2000, { numbers: numbers({ byAgent: 120 }), notify: t.notify });
    expect(r.reached.map((m) => m.threshold)).toEqual([50, 100]);
    expect(reachedMilestones().filter((m) => m.series === "byAgent").map((m) => m.threshold)).toEqual([10, 25, 50, 100]);
  });
});

describe("the drafted post", () => {
  it("is built from the real numbers, names the recount, and puts the link in the reply", () => {
    const d = milestoneDraft("byAgent", 100, numbers({ byAgent: 104, people: 63, jobs: 40 }), "https://sagepays.xyz");
    expect(d).toContain("Sage has now paid people 100 times on its own decision.");
    expect(d).toContain("104 payouts decided by the agent, to 63 people, across 40 jobs");
    expect(d).toContain("anyone can recount them");
    expect(d).toContain("First reply: sagepays.xyz/ledger");
    expect(d.split("\n")[0]).not.toContain("sagepays.xyz");
  });

  it("never leads with the retired keys or allowance framing", () => {
    for (const series of ["byAgent", "people", "jobsByAgent", "teams", "rounds"] as const) {
      for (const threshold of [1, 100]) {
        const text = `${milestoneHeadline(series, threshold)} ${milestoneDraft(series, threshold, numbers({ byAgent: 1, people: 1, jobs: 1 }))}`;
        expect(text).not.toMatch(/keys|allowance|budget/i);
      }
    }
  });
});
