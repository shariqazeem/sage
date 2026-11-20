import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { inspectionJobs } from "@/lib/db/schema";
import { createInspectionJob } from "@/lib/db/inspection";
import { OWN_WALLETS } from "@/lib/campaigns/settled-ledger";
import { dailyTestLimit, testsStartedSince, webTestsPerDay } from "./daily-cap";

/** A fair share of Sage's day: a few new tests per person per 24 hours, counted in any spelling. */

const PERSON = "0xAbCdEf0000000000000000000000000000000001";
const NOW = 1_795_000_000;
let n = 0;

function started(founder: string, at: number) {
  const { job } = createInspectionJob({
    founderWallet: founder,
    publicCampaignId: `launch-cap-${++n}`,
    productUrl: `https://example${n}.com`,
    goal: "",
    targetUsers: "",
    totalBudgetBase: BigInt(20_000_000),
    tokenDecimals: 6,
    planningRequestId: `req-cap-${n}`,
  });
  db.update(inspectionJobs).set({ createdAt: at }).where(eq(inspectionJobs.id, job.id)).run();
}

beforeEach(() => {
  db.delete(inspectionJobs).run();
});

describe("dailyTestLimit", () => {
  it("defaults to five a day and reads WEB_INSPECTION_DAILY_CAP", () => {
    expect(webTestsPerDay({})).toBe(5);
    expect(webTestsPerDay({ WEB_INSPECTION_DAILY_CAP: "8" })).toBe(8);
    expect(webTestsPerDay({ WEB_INSPECTION_DAILY_CAP: "0" })).toBe(5);
  });

  it("counts a person's tests in the last 24 hours, whatever the address's case", () => {
    started(PERSON, NOW - 3600);
    started(PERSON.toLowerCase(), NOW - 7200);
    started(PERSON, NOW - 90_000); // older than a day
    expect(testsStartedSince(PERSON, NOW - 86_400)).toBe(2);
  });

  it("refuses the sixth new test in a day, in plain words", () => {
    for (let i = 0; i < 5; i++) started(PERSON, NOW - 60 * i);
    const r = dailyTestLimit(PERSON, NOW, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/5 tests in the last day/);
    expect(dailyTestLimit(PERSON, NOW + 86_400, {})).toEqual({ ok: true });
  });

  it("never limits Sage's own wallets", () => {
    const own = OWN_WALLETS.find((w) => /^0x[0-9a-f]{40}$/.test(w)) as string;
    for (let i = 0; i < 7; i++) started(own, NOW - 60 * i);
    expect(dailyTestLimit(own, NOW, {})).toEqual({ ok: true });
  });
});
