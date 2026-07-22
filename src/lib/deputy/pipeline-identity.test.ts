import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PROMPT 02E.2 Part B — the exact live defect, now blocked BEFORE payment.
 *
 * The exercise stored a campaign_v2 under a RANDOM public/DB id whose persisted
 * campaignIdHash still matched the on-chain identity; the old pipeline paid, and only
 * the proof composer (afterwards) caught it. Here the REAL pipeline runs against that
 * exact shape and must HOLD before the LLM, before any CAS, before any durable attempt,
 * and before any signing/broadcast — with zero paid side effects. Only the raw chain
 * transport + evidence fetch + brain are faked; every identity-bearing line is real.
 */

vi.mock("@/lib/deputy/brain", () => ({ verifySubmission: vi.fn() }));
vi.mock("@/lib/x402/verify-evidence", () => ({ verifyEvidence: vi.fn() }));
vi.mock("./notify", () => ({ notifyTelegram: vi.fn() }));
vi.mock("@/lib/telegram/bot", () => ({
  announceCampaignSettled: vi.fn(),
  announceCampaignBlocked: vi.fn(),
}));

import { runDeputyOnSubmission } from "./pipeline";
import { verifySubmission } from "./brain";
import { verifyEvidence } from "@/lib/x402/verify-evidence";
import {
  createCampaign,
  createMission,
  createSubmission,
  getCampaign,
  getDecisionBySubmission,
  getMissionByHash,
  getSubmission,
  insertDecision,
  updateCampaignV2Plan,
} from "@/lib/db/campaigns";
import { computeCampaignPlan, missionIdHash } from "@/lib/campaigns/mission-plan";
import { missionSpecDigest } from "@/lib/campaigns/mission-spec";
import {
  V2_OPERATOR,
  V2_TOKEN,
  agreeingSnapshot,
  makeFakeAdapter,
  payBrief,
  seedV2Campaign,
  type V2Fixture,
} from "@/lib/campaigns/campaign-v2.fixture";
import type { Campaign, Decision, Mission } from "@/lib/db/schema";
import type { DecisionBrief } from "./brain-core";

const PROSE = {
  title: "Load the app",
  objective: "Confirm the app loads for a fresh user",
  instructions: "Open the app in a clean session and confirm it renders",
  targetSurface: "https://app.example.com",
  criteria: ["the app loads"],
  evidenceList: ["a screen recording"],
};

async function getAttemptCount(submissionId: string): Promise<number> {
  const { db } = await import("@/lib/db");
  const { settlementAttempts } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  return db.select().from(settlementAttempts).where(eq(settlementAttempts.submissionId, submissionId)).all().length;
}

/**
 * Seed a campaign_v2 whose PUBLIC id (the DB primary key) does NOT hash to its stored
 * campaignIdHash — but whose stored hashes are internally consistent with (and agree
 * with) the on-chain snapshot. This is the live exercise defect exactly. `hashSourceId`
 * is the id the on-chain identity actually commits to; the DB row id is random.
 */
let seedSeq = 0;
function seedInconsistentV2(opts?: { withDecision?: boolean; hashSourceId?: string }): V2Fixture {
  seedSeq += 1;
  const canonical = opts?.hashSourceId ?? `the-canonical-public-id-${seedSeq}`;
  const vaultAddress = `0x${seedSeq.toString(16).padStart(40, "1")}`;
  const founder = `0x${"b".repeat(40)}`;
  const missionsInput = [{ missionKey: "load", rewardBase: BigInt(500_000), maxCompletions: BigInt(4) }];

  // createCampaign mints a RANDOM nanoid id — the "public id" that will NOT match.
  const created = createCampaign({
    title: "inconsistent V2",
    rewardAmount: 500_000,
    vaultAddress,
    posterWallet: founder,
    chainId: 59902,
    ownerIsSage: false,
    status: "live",
    autonomy: "autopilot",
    autopilotThreshold: 0.85,
    settlementToken: V2_TOKEN,
  });

  // Store the CANONICAL hashes (derived from `canonical`, not from created.id).
  const plan = computeCampaignPlan(canonical, missionsInput);
  updateCampaignV2Plan(created.id, {
    vaultKind: "campaign_v2",
    campaignIdHash: plan.campaignIdHash,
    missionPlanDigest: plan.missionPlanDigest,
    commitmentVersion: 2,
  });

  const mid = missionIdHash(canonical, "load");
  const spec = missionSpecDigest({
    campaignIdHash: plan.campaignIdHash,
    missionIdHash: mid,
    ...PROSE,
    evidenceRequirements: PROSE.evidenceList,
    rewardBase: BigInt(500_000),
    maxCompletions: BigInt(4),
  });
  createMission({
    campaignId: created.id,
    missionKey: "load",
    missionIdHash: mid,
    ...PROSE,
    evidenceList: PROSE.evidenceList,
    rewardAmount: 500_000,
    maxCompletions: 4,
    status: "active",
    displayOrder: 0,
    specDigest: spec,
    // url-verifiable so this test exercises the IDENTITY gate, not the P16 observation valve.
    verifiabilityClass: "url-verifiable",
    lockedAt: 1,
  });

  const r = createSubmission({
    campaignId: created.id,
    wallet: `0x${"d".repeat(40)}`,
    evidenceUrl: "https://app.example.com",
    missionIdHash: mid,
    missionSpecDigest: spec,
  });
  if (!r.ok) throw new Error("seedInconsistentV2 submission failed");

  if (opts?.withDecision) {
    insertDecision({
      submissionId: r.submission.id,
      campaignId: created.id,
      engine: "llm",
      model: "google/gemini-3.1-flash-lite-preview",
      brief: payBrief(),
      contentSha256: "a".repeat(64),
      evidenceOk: true,
      latencyMs: 1000,
      costUsd: 0.0003,
      x402PaymentTx: null,
      commitmentVersion: 2,
      missionIdHash: mid,
      vaultKind: "campaign_v2",
    });
  }

  const mission = getMissionByHash(created.id, mid) as Mission;
  return {
    campaign: getCampaign(created.id) as Campaign,
    missions: [mission],
    mission,
    submission: r.submission,
    decision: (getDecisionBySubmission(r.submission.id) as Decision) ?? (null as unknown as Decision),
  };
}

const payDecisionBrief: DecisionBrief = {
  ...payBrief(),
  engine: "llm",
  model: "google/gemini-3.1-flash-lite-preview",
  evidenceOk: true,
  contentSha256: "a".repeat(64),
  latencyMs: 1000,
  costUsd: 0.0003,
  x402PaymentTx: null,
  x402Status: "not_required",
  x402Reason: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyEvidence).mockResolvedValue({
    text: "the app loads",
    contentSha256: "a".repeat(64),
    ok: true,
    failReason: undefined,
    x402PaymentTx: null,
    x402Status: "not_required",
    x402Reason: null,
  } as never);
  vi.mocked(verifySubmission).mockResolvedValue(payDecisionBrief);
});

describe("02E.2 — a public-identity mismatch blocks the payout (pre-LLM gate)", () => {
  it("the exact live defect (random public id, matching stored/on-chain hash) HOLDS before the LLM", async () => {
    const f = seedInconsistentV2(); // no pre-existing decision → compute path
    const calls = { requestPayout: 0 };
    const deps = { campaignAdapter: makeFakeAdapter(f, { calls }), operatorAddress: () => V2_OPERATOR };

    const r = await runDeputyOnSubmission(f.submission.id, deps);

    expect(r.action).toBe("held");
    expect(verifySubmission).not.toHaveBeenCalled(); // LLM never invoked
    expect(calls.requestPayout).toBe(0); // no signing / no broadcast
    expect(getSubmission(f.submission.id)?.status).toBe("pending"); // no CAS to settling
    expect(await getAttemptCount(f.submission.id)).toBe(0); // no durable attempt
    // the stored decision (if any) is a heuristic hold that can never auto-pay
    const dec = getDecisionBySubmission(f.submission.id);
    expect(dec?.engine).toBe("heuristic");
  });
});

describe("02E.2 — a public-identity mismatch blocks the payout (pre-broadcast gate)", () => {
  it("even with a PRE-EXISTING pay decision, preflight HOLDS before any CAS/attempt/broadcast", async () => {
    const f = seedInconsistentV2({ withDecision: true }); // decision already stored → skips pre-LLM
    const calls = { requestPayout: 0 };
    const deps = { campaignAdapter: makeFakeAdapter(f, { calls }), operatorAddress: () => V2_OPERATOR };

    const r = await runDeputyOnSubmission(f.submission.id, deps);

    expect(r.action).toBe("held");
    expect(r.reason).toMatch(/identity/i);
    expect(calls.requestPayout).toBe(0);
    expect(getSubmission(f.submission.id)?.status).toBe("pending");
    expect(await getAttemptCount(f.submission.id)).toBe(0);
  });
});

describe("02E.2 — the invariant does not over-block", () => {
  it("a CONSISTENT campaign (public id hashes to its stored identity) still settles", async () => {
    const f = seedV2Campaign(); // id-first construction → consistent identity
    const calls = { requestPayout: 0 };
    const deps = { campaignAdapter: makeFakeAdapter(f, { calls }), operatorAddress: () => V2_OPERATOR };
    // pre-existing pay decision (fixture) → gate passes, identity passes, it settles.
    const r = await runDeputyOnSubmission(f.submission.id, deps);
    expect(r.action).toBe("settled");
    expect(calls.requestPayout).toBe(1);
  });

  it("a wrong on-chain missionPlanDigest (recompute disagrees with chain) HOLDS", async () => {
    const f = seedV2Campaign();
    const calls = { requestPayout: 0 };
    const snapshot = agreeingSnapshot(f, { missionPlanDigest: `0x${"7".repeat(64)}` });
    const deps = { campaignAdapter: makeFakeAdapter(f, { snapshot, calls }), operatorAddress: () => V2_OPERATOR };
    const r = await runDeputyOnSubmission(f.submission.id, deps);
    expect(r.action).toBe("held");
    expect(r.reason).toMatch(/identity|mission_plan/i);
    expect(calls.requestPayout).toBe(0);
  });
});

describe("02E.2 — public ids are immutable through application accessors", () => {
  it("updateMissionDraft cannot change a mission's public key (no accessor mutates it)", async () => {
    const { updateMissionDraft } = await import("@/lib/db/campaigns");
    // the patch type does not permit missionKey; a stray field is ignored by the accessor.
    const f = seedV2Campaign();
    const before = f.mission.missionKey;
    // @ts-expect-error — missionKey is intentionally NOT a permitted draft patch field.
    updateMissionDraft(f.mission.id, { missionKey: "hacked" });
    const after = getMissionByHash(f.campaign.id, f.mission.missionIdHash);
    expect(after?.missionKey).toBe(before);
  });
});
