import { describe, expect, it } from "vitest";

import { createInspectionJob, updateInspectionJob, founderGoalDigest, idempotencyKey } from "./inspection";

/**
 * STALE-INTENT closure — the campaign-planning request identity binds the founder's GOAL, so a new
 * instruction (different goal) is a NEW request and can never reuse a prior job. Real in-memory SQLite.
 *
 * Incident 2026-07-24: a goal-blind idempotency key returned the stale READY job `6PciNNBK3f1A`
 * (created 2026-07-18 for a DIFFERENT goal on the same URL + $1.50) and presented its old plan as
 * current + fundable. These tests pin that this can never happen again.
 */

// unique founder per test so the shared in-memory DB never cross-contaminates.
let n = 0;
const founder = () => `clawup:test-${Date.now() % 1_000_000}-${n++}`;
const base = (goal: string, over: Partial<Parameters<typeof createInspectionJob>[0]> = {}) => ({
  founderWallet: founder(),
  publicCampaignId: `pub-${n}`,
  productUrl: "https://yara.garden/",
  goal,
  targetUsers: "first-time visitors",
  totalBudgetBase: BigInt(1_500_000), // $1.50
  tokenDecimals: 6,
  ...over,
});

const OLD_GOAL =
  "Does a first-time visitor understand what yara.garden is and find the living, interactive moments rewarding? I want to know which specific scenes or interactions felt alive, which felt broken or confusing, and where a newcomer loses interest.";
const NEW_GOAL = "make users land in yara.garden and go to yara character and talk to her";

describe("founderGoalDigest — canonical, goal-sensitive", () => {
  it("different goals → different digests", () => {
    expect(founderGoalDigest(OLD_GOAL)).not.toBe(founderGoalDigest(NEW_GOAL));
  });
  it("whitespace / case / NFC variants of the SAME goal → same digest", () => {
    expect(founderGoalDigest("  Talk to Yara  ")).toBe(founderGoalDigest("talk to yara"));
    expect(founderGoalDigest("talk   to\nyara")).toBe(founderGoalDigest("talk to yara"));
  });
  it("null / non-string coerces to the empty-goal digest (never throws)", () => {
    expect(founderGoalDigest(null)).toBe(founderGoalDigest(""));
    expect(founderGoalDigest(undefined)).toBe(founderGoalDigest(""));
    expect(founderGoalDigest(42 as unknown)).toBe(founderGoalDigest(""));
  });
});

describe("idempotencyKey — goal is load-bearing", () => {
  const g = founderGoalDigest;
  it("same url + budget, DIFFERENT goal ⇒ different key", () => {
    const a = idempotencyKey("clawup:x", "https://yara.garden/", BigInt(1_500_000), g(OLD_GOAL));
    const b = idempotencyKey("clawup:x", "https://yara.garden/", BigInt(1_500_000), g(NEW_GOAL));
    expect(a).not.toBe(b);
  });
  it("same url + goal, DIFFERENT budget ⇒ different key", () => {
    const a = idempotencyKey("clawup:x", "https://yara.garden/", BigInt(1_500_000), g(NEW_GOAL));
    const b = idempotencyKey("clawup:x", "https://yara.garden/", BigInt(3_000_000), g(NEW_GOAL));
    expect(a).not.toBe(b);
  });
  it("identical (founder, url, budget, goal) ⇒ same key", () => {
    const a = idempotencyKey("clawup:x", "https://yara.garden/", BigInt(1_500_000), g(NEW_GOAL));
    const b = idempotencyKey("clawup:x", "https://yara.garden/", BigInt(1_500_000), g(NEW_GOAL));
    expect(a).toBe(b);
  });
});

describe("createInspectionJob — request identity binds the goal", () => {
  it("EXACT INCIDENT: a READY job for goal A + a new request for goal B (same URL + $1.50) ⇒ NEW job id", () => {
    const wallet = founder();
    const a = createInspectionJob(base(OLD_GOAL, { founderWallet: wallet }));
    expect(a.created).toBe(true);
    updateInspectionJob(a.job.id, "ready"); // the July-18 job is READY, exactly like 6PciNNBK3f1A

    const b = createInspectionJob(base(NEW_GOAL, { founderWallet: wallet }));
    expect(b.created).toBe(true); // a fresh job is created + will re-plan (created ⇒ run scheduled)
    expect(b.job.id).not.toBe(a.job.id); // the new goal NEVER returns the stale id
    expect(b.job.goal).toBe(NEW_GOAL); // and it carries the CURRENT goal, not the old one
  });

  it("same URL + exact same goal while IN FLIGHT ⇒ same job (idempotent, no duplicate)", () => {
    const wallet = founder();
    const a = createInspectionJob(base(NEW_GOAL, { founderWallet: wallet })); // queued (in flight)
    const b = createInspectionJob(base(NEW_GOAL, { founderWallet: wallet }));
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
  });

  it("same URL + same goal + DIFFERENT budget ⇒ new job", () => {
    const wallet = founder();
    const a = createInspectionJob(base(NEW_GOAL, { founderWallet: wallet, totalBudgetBase: BigInt(1_500_000) }));
    const b = createInspectionJob(base(NEW_GOAL, { founderWallet: wallet, totalBudgetBase: BigInt(3_000_000) }));
    expect(b.job.id).not.toBe(a.job.id);
    expect(b.created).toBe(true);
  });

  it("a completed (ready) job does NOT get reused by a new instruction with a different goal", () => {
    const wallet = founder();
    const a = createInspectionJob(base(NEW_GOAL, { founderWallet: wallet }));
    updateInspectionJob(a.job.id, "ready");
    // a genuinely new instruction (different goal) → new job, never the completed one
    const c = createInspectionJob(base("check the checkout flow works end to end", { founderWallet: wallet }));
    expect(c.job.id).not.toBe(a.job.id);
    expect(c.created).toBe(true);
  });
});
