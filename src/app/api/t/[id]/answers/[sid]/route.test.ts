import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The builder decides a held answer from the test's page. The door adds no settlement logic: paying is
 * `releaseSubmission`, declining is `rejectSubmission`. These hold who may use it and what it writes.
 */
const h = vi.hoisted(() => ({ me: null as string | null, released: [] as string[], settle: "paid" as "paid" | "throws" | "not-settled" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/founder", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/founder")>()), getFounderAddress: async () => h.me }));
vi.mock("@/lib/campaigns/review-actions", async (orig) => {
  const real = await orig<typeof import("@/lib/campaigns/review-actions")>();
  return {
    ...real,
    // the real release moves money through the frozen settle path; here only the call is watched
    releaseSubmission: async (_campaignId: string, submissionId: string) => {
      h.released.push(submissionId);
      if (h.settle === "throws") throw new Error("rpc down");
      return h.settle === "paid"
        ? { ok: true, settled: true, txHash: "0xfeed", recipient: "0x1", amountBase: 2_000_000, reason: null }
        : { ok: true, settled: false, txHash: null, recipient: null, amountBase: null, reason: "this mission's places are all paid" };
    },
  };
});

import { db } from "@/lib/db";
import { campaigns, decisions, missions as missionsTable } from "@/lib/db/schema";
import { createSubmission, getSubmission, listCampaignEvents, recordEvent } from "@/lib/db/campaigns";
import { POST } from "./route";

const OWNER = `0x${"b".repeat(40)}`;
const STRANGER = `0x${"9".repeat(40)}`;
let n = 0;

function heldAnswer(opts: { judged?: boolean; retry?: boolean } = {}) {
  const id = `ans-${++n}`;
  const mid = `0x${n.toString(16).padStart(64, "5")}`;
  db.insert(campaigns).values({
    id, title: "Held test", rewardAmount: 2_000_000, vaultAddress: `0x${"e".repeat(40)}`, chainId: 1088,
    posterWallet: OWNER, ownerIsSage: false, status: "live", autonomy: "manual", vaultKind: "campaign_v2",
    campaignIdHash: `0x${"c".repeat(64)}`, missionPlanDigest: `0x${"d".repeat(64)}`, commitmentVersion: 2, createdAt: 1000,
  }).run();
  db.insert(missionsTable).values({
    id: `${id}:m`, campaignId: id, missionKey: "m", missionIdHash: mid, title: "Try it", objective: "Try", instructions: "Try it",
    targetSurface: "https://demo.example/app", criteria: [], evidenceList: [], rewardAmount: 2_000_000, maxCompletions: 3, status: "active",
    displayOrder: 0, specDigest: `0x${"f".repeat(64)}`, lockedAt: 1, createdAt: 1, updatedAt: 1,
  }).run();
  const r = createSubmission({ campaignId: id, wallet: `0x${n.toString(16).padStart(40, "1")}`, note: "what I saw", missionIdHash: mid });
  if (!r.ok) throw new Error(r.error);
  if (opts.judged !== false) db.insert(decisions).values({ id: `d-${r.submission.id}`, submissionId: r.submission.id, campaignId: id, engine: "heuristic", brief: { reasonCode: "needs_review" } as never, createdAt: 2 }).run();
  if (opts.retry) recordEvent({ campaignId: id, submissionId: r.submission.id, kind: "autopay_held", detail: "0x1 · Held for the tester to refine — attempt 1 of 3, no action needed yet (observation_retry)" });
  return { id, sid: r.submission.id };
}

const post = (id: string, sid: string, body: unknown) =>
  POST(new NextRequest(`https://sagepays.xyz/api/t/${id}/answers/${sid}`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id, sid }) });

beforeEach(() => {
  h.me = OWNER;
  h.released.length = 0;
  h.settle = "paid";
});

describe("POST /api/t/[id]/answers/[sid]", () => {
  it("is the owner's alone: a stranger is told nothing, and nothing is released", async () => {
    const { id, sid } = heldAnswer();
    h.me = null;
    expect((await post(id, sid, { decision: "pay" })).status).toBe(401);
    h.me = STRANGER;
    expect((await post(id, sid, { decision: "pay" })).status).toBe(404);
    expect((await post(id, sid, { decision: "decline", reason: "not a real try" })).status).toBe(404);
    h.me = OWNER;
    expect((await post("no-such-test", sid, { decision: "pay" })).status).toBe(404);
    expect((await post(id, "no-such-answer", { decision: "pay" })).status).toBe(404);
    // an answer of another test is not found through this one
    const other = heldAnswer();
    expect((await post(id, other.sid, { decision: "pay" })).status).toBe(404);
    expect(h.released).toEqual([]);
    expect(getSubmission(sid)?.status).toBe("pending");
  });

  it("pays through the existing release, and hands back the receipt", async () => {
    const { id, sid } = heldAnswer();
    const res = await post(id, sid, { decision: "pay" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "paid", settled: true, receipt: "/proof/0xfeed", note: null });
    expect(h.released).toEqual([sid]);
  });

  it("says so when the answer is approved but the vault did not pay, in the vault's own words", async () => {
    const { id, sid } = heldAnswer();
    h.settle = "not-settled";
    expect(await (await post(id, sid, { decision: "pay" })).json()).toEqual({ ok: true, status: "approved", settled: false, receipt: null, note: "this mission's places are all paid" });
    const again = heldAnswer();
    h.settle = "throws";
    const body = (await (await post(again.id, again.sid, { decision: "pay" })).json()) as { ok: boolean; settled: boolean; note: string };
    expect(body).toMatchObject({ ok: true, status: "approved", settled: false });
    expect(body.note).toMatch(/tries it again/);
  });

  it("declines with the builder's reason, recorded so the tester reads it as written", async () => {
    const { id, sid } = heldAnswer();
    expect((await post(id, sid, { decision: "decline" })).status).toBe(400);
    expect((await post(id, sid, { decision: "decline", reason: "no" })).status).toBe(400);
    expect(getSubmission(sid)?.status).toBe("pending");
    const res = await post(id, sid, { decision: "decline", reason: "  They tried the\n old version.  " });
    expect(await res.json()).toEqual({ ok: true, status: "declined" });
    expect(getSubmission(sid)).toMatchObject({ status: "rejected", rejectReason: "The builder said: They tried the old version." });
    expect(listCampaignEvents(id).map((e) => e.kind)).toContain("submission_rejected");
    expect(h.released).toEqual([]);
    // decided once
    expect((await post(id, sid, { decision: "pay" })).status).toBe(409);
  });

  it("refuses an answer Sage has not read yet, one the tester may still add to, and an unknown decision", async () => {
    const unread = heldAnswer({ judged: false });
    expect((await post(unread.id, unread.sid, { decision: "pay" })).status).toBe(409);
    const refining = heldAnswer({ retry: true });
    expect((await post(refining.id, refining.sid, { decision: "pay" })).status).toBe(409);
    const ok = heldAnswer();
    expect((await post(ok.id, ok.sid, { decision: "approve-all" })).status).toBe(400);
    expect(h.released).toEqual([]);
  });
});
