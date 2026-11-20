import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, submissions } from "@/lib/db/schema";
import { createCampaign, createMission, createSubmission, getSubmission, recordEvent } from "@/lib/db/campaigns";
import { missionIdHash } from "@/lib/campaigns/mission-plan";
import { flagAnswer, flagReason, flagsAllowed } from "./builder-flag";

/**
 * The builder's flag: only the owner, only inside the window, only an answer the agent approved, at most
 * one in five places, and the place reopens rather than the money coming back.
 */

const OWNER = "0x4444444444444444444444444444444444444444";
const STRANGER = "0x7777777777777777777777777777777777777777";
const T0 = 1_795_000_000;
let n = 0;
let w = 0;

function seedTest(places = 10) {
  const c = createCampaign({
    title: `Acme ${++n}`,
    rewardAmount: 2_000_000,
    vaultAddress: `0x${"3".repeat(40)}`,
    posterWallet: OWNER,
    chainId: 1088,
    vaultKind: "campaign_v2",
    criteria: [],
    status: "live",
    visibility: "listed",
  });
  const mid = missionIdHash(c.id, "try");
  createMission({ campaignId: c.id, missionKey: "try", missionIdHash: mid, title: "Try it", rewardAmount: 2_000_000, maxCompletions: places, displayOrder: 0 });
  return { id: c.id, mid };
}

function approvedAnswer(campaignId: string, mid: string, approvedAt = T0) {
  const wallet = `0x${(++w).toString(16).padStart(40, "0")}`;
  const r = createSubmission({ campaignId, wallet, evidenceUrl: null, note: "I signed up and the code email never came.", missionIdHash: mid, missionSpecDigest: null });
  if (!r.ok) throw new Error(r.error);
  db.update(submissions).set({ status: "approved" }).where(eq(submissions.id, r.submission.id)).run();
  recordEvent({ campaignId, submissionId: r.submission.id, kind: "autopay_approved", detail: "approved", createdAt: approvedAt });
  return r.submission.id;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  // the suite runs with no window (vitest.config.ts); the flag lives inside the real one
  vi.stubEnv("AUTOPAY_FINALIZE_MINUTES", "30");
});

describe("flagReason and flagsAllowed", () => {
  it("takes one plain line of 4 to 200 characters", () => {
    expect(flagReason("  restates   the card  ")).toBe("restates the card");
    expect(flagReason("no")).toBeNull();
    expect(flagReason("x".repeat(201))).toBeNull();
    expect(flagReason(42)).toBeNull();
  });

  it("allows one in five places, and at least one", () => {
    expect(flagsAllowed(10)).toBe(2);
    expect(flagsAllowed(3)).toBe(1);
    expect(flagsAllowed(0)).toBe(1);
  });
});

describe("flagAnswer", () => {
  it("revokes an approved answer inside the window, with the builder's words for the tester", () => {
    const t = seedTest();
    const id = approvedAnswer(t.id, t.mid);
    expect(flagAnswer({ submissionId: id, by: OWNER, reason: "It describes a different app", now: T0 + 60 })).toEqual({ ok: true });
    const sub = getSubmission(id);
    expect(sub?.status).toBe("rejected");
    expect(sub?.rejectReason).toBe("The builder said: It describes a different app");
    const kinds = db.select().from(events).where(eq(events.submissionId, id)).all().map((e) => e.kind);
    expect(kinds).toContain("builder_flagged");
  });

  it("is 404 for anyone but the owner, and changes nothing", () => {
    const t = seedTest();
    const id = approvedAnswer(t.id, t.mid);
    expect(flagAnswer({ submissionId: id, by: STRANGER, reason: "not real", now: T0 + 60 })).toMatchObject({ ok: false, status: 404 });
    expect(flagAnswer({ submissionId: id, by: null, reason: "not real", now: T0 + 60 })).toMatchObject({ ok: false, status: 404 });
    expect(getSubmission(id)?.status).toBe("approved");
  });

  it("refuses once the window has passed, and once it is paid", () => {
    const t = seedTest();
    const late = approvedAnswer(t.id, t.mid);
    expect(flagAnswer({ submissionId: late, by: OWNER, reason: "not real", now: T0 + 31 * 60 })).toMatchObject({ ok: false, status: 409 });
    const paid = approvedAnswer(t.id, t.mid);
    db.update(submissions).set({ status: "paid" }).where(eq(submissions.id, paid)).run();
    const r = flagAnswer({ submissionId: paid, by: OWNER, reason: "not real", now: T0 + 60 });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(getSubmission(paid)?.status).toBe("paid");
  });

  it("refuses an answer the builder released by hand", () => {
    const t = seedTest();
    const id = approvedAnswer(t.id, t.mid);
    recordEvent({ campaignId: t.id, submissionId: id, kind: "submission_approved", detail: "released", createdAt: T0 + 10 });
    expect(flagAnswer({ submissionId: id, by: OWNER, reason: "not real", now: T0 + 60 })).toMatchObject({ ok: false, status: 409 });
  });

  it("stops at one in five places", () => {
    const t = seedTest(5); // one flag allowed
    const a = approvedAnswer(t.id, t.mid);
    const b = approvedAnswer(t.id, t.mid);
    expect(flagAnswer({ submissionId: a, by: OWNER, reason: "parrots the card", now: T0 + 60 })).toEqual({ ok: true });
    expect(flagAnswer({ submissionId: b, by: OWNER, reason: "parrots the card", now: T0 + 60 })).toMatchObject({ ok: false, status: 429 });
    expect(getSubmission(b)?.status).toBe("approved");
  });

  it("asks for a reason the tester can read", () => {
    const t = seedTest();
    const id = approvedAnswer(t.id, t.mid);
    expect(flagAnswer({ submissionId: id, by: OWNER, reason: "", now: T0 + 60 })).toMatchObject({ ok: false, status: 400 });
  });
});
