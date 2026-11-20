import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { db } from "@/lib/db";
import { xSpend } from "@/lib/db/schema";
import { BUDGET_REACHED, bookSpend, canSpend, spentMicros, utcDay, utcDayStart } from "./budget";
import { xCredentials, xDailyBudgetMicros, xInspectionsDailyCap, xMode, xRepliesOn } from "./config";

/** 20 Nov 2026 23:59:00 UTC, and one minute into the next day. */
const LATE = Date.UTC(2026, 10, 20, 23, 59, 0) / 1000;
const NEXT = Date.UTC(2026, 10, 21, 0, 0, 30) / 1000;

beforeEach(() => {
  db.delete(xSpend).run();
});

describe("the day's meter", () => {
  it("files a moment under its UTC day", () => {
    expect(utcDay(LATE)).toBe("2026-11-20");
    expect(utcDay(NEXT)).toBe("2026-11-21");
    expect(utcDayStart(LATE)).toBe(Date.UTC(2026, 10, 20) / 1000);
  });

  it("adds every charge to its day", () => {
    bookSpend(200_000, LATE);
    bookSpend(15_000, LATE);
    bookSpend(0, LATE);
    expect(spentMicros(LATE)).toBe(215_000);
    expect(db.select().from(xSpend).all()).toMatchObject([{ day: "2026-11-20", costMicros: 215_000, calls: 2 }]);
  });

  it("stops at the ceiling, to the micro-dollar", () => {
    const ceiling = 400_000;
    bookSpend(200_000, LATE);
    expect(canSpend(200_000, LATE, ceiling)).toBe(true);
    expect(canSpend(200_001, LATE, ceiling)).toBe(false);
    bookSpend(200_000, LATE);
    expect(canSpend(15_000, LATE, ceiling)).toBe(false);
  });

  it("resumes on the next UTC day with nothing to reset", () => {
    bookSpend(2_000_000, LATE);
    expect(canSpend(15_000, LATE, 2_000_000)).toBe(false);
    expect(spentMicros(NEXT)).toBe(0);
    expect(canSpend(200_000, NEXT, 2_000_000)).toBe(true);
  });

  it("names the reason the agent records", () => {
    expect(BUDGET_REACHED).toBe("daily X budget reached");
  });
});

describe("the founder's switches", () => {
  const keys = { X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c", X_ACCESS_TOKEN_SECRET: "d" };
  const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

  it("is off unless told otherwise", () => {
    expect(xMode(env({}))).toBe("off");
    expect(xMode(env({ X_AGENT: "yes" }))).toBe("off");
    expect(xMode(env({ X_AGENT: "dry" }))).toBe("dry");
  });

  it("is live only with all four credentials; otherwise live means a dry run", () => {
    expect(xMode(env({ X_AGENT: "live", ...keys }))).toBe("live");
    expect(xMode(env({ X_AGENT: "live", ...keys, X_ACCESS_TOKEN_SECRET: " " }))).toBe("dry");
    expect(xCredentials(env({ X_API_KEY: "a" }))).toBeNull();
  });

  it("defaults to $2 a day, replies off, ten tagged links a day", () => {
    expect(xDailyBudgetMicros(env({}))).toBe(2_000_000);
    expect(xDailyBudgetMicros(env({ X_DAILY_BUDGET_USD: "0.5" }))).toBe(500_000);
    expect(xDailyBudgetMicros(env({ X_DAILY_BUDGET_USD: "lots" }))).toBe(2_000_000);
    expect(xRepliesOn(env({}))).toBe(false);
    expect(xRepliesOn(env({ X_REPLIES: "on" }))).toBe(true);
    expect(xInspectionsDailyCap(env({}))).toBe(10);
    expect(xInspectionsDailyCap(env({ X_INSPECTIONS_DAILY_CAP: "3" }))).toBe(3);
  });
});
