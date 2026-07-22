import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DecisionBrief } from "./brain-core";

/**
 * THE full integration proof for CampaignVault V2: the REAL decision pipeline
 * (gate → dedup → agreement pre-flight → CAS → settle → strategy → adapter) runs
 * end-to-end against the REAL in-memory db, with the chain TRANSPORT injected (a
 * fake CampaignVault adapter). It proves an UNKNOWN tester wallet is paid the exact
 * mission reward through `requestPayout` with NO recipient allowlisting — and that
 * V1 still goes through vendor approval, so the two paths are genuinely different.
 *
 * Only the raw chain adapter + unrelated side-effect peripherals are faked; every
 * safety-bearing line (strategy selection, DecisionCommitmentV2, the DB↔chain
 * agreement gate, the durable attempt, the integrity check) is the real code.
 */

// ensureVendorApproved MUST NEVER be reached on the V2 path — spy it to throw.
vi.mock("@/lib/deputy/signer", () => ({
  ensureVendorApproved: vi.fn(async () => {
    throw new Error("ensureVendorApproved must never be called for a V2 payout");
  }),
  submitRequestSpend: vi.fn(),
  awaitSpendOutcome: vi.fn(),
  operatorAddress: vi.fn(() => "0x7704E5BEe00Ef085dde85EEB0c49ae12d9F9BC35"),
  sendVaultWrite: vi.fn(),
}));
vi.mock("@/lib/deputy/chain", () => ({
  getVaultState: vi.fn(async () => ({
    status: "active",
    budget: 100,
    spent: 0,
    remaining: 100,
    perTxCap: 100,
    velocityCap: 100,
  })),
  isVendorApproved: vi.fn(async () => true),
  isIntentUsed: vi.fn(async () => false),
  findSettleTxByIntent: vi.fn(async () => null),
  publicClient: vi.fn(),
}));
vi.mock("@/lib/campaigns/reconcile", () => ({ reconcileVendorEvents: vi.fn(async () => null) }));
// chargeOperatorFee is REAL here (DB-only, idempotent by settleTx) so the exactly-once
// fee assertion is genuine; the actual x402 payment happens later in the sweep.
vi.mock("@/lib/telegram/bot", () => ({
  announceCampaignSettled: vi.fn(),
  announceCampaignBlocked: vi.fn(),
}));
vi.mock("./notify", () => ({ notifyTelegram: vi.fn() }));
vi.mock("./agent-log", () => ({ newCorrelationId: () => "cid_v2", agentLog: vi.fn() }));
vi.mock("./decisions", () => ({ ensureDecision: vi.fn() }));

import { runDeputyOnSubmission } from "./pipeline";
import { ensureDecision } from "./decisions";
import { ensureVendorApproved } from "@/lib/deputy/signer";
import { getSubmission } from "@/lib/db/campaigns";
import { getAttempt } from "@/lib/db/settlement-attempts";
import {
  V2_OPERATOR,
  agreeingSnapshot,
  makeFakeAdapter,
  seedV2Campaign,
} from "@/lib/campaigns/campaign-v2.fixture";
import { createCampaign, createSubmission, insertDecision } from "@/lib/db/campaigns";
import type { Campaign } from "@/lib/db/schema";

function payBriefFor(): DecisionBrief {
  return {
    engine: "llm",
    model: "google/gemini-3.1-flash-lite-preview",
    provider: "api.commonstack.ai",
    criteria: [{ criterion: "the app loads", met: true, confidence: 0.97, quote: "it loads fine" }],
    fraudSignals: [],
    recommendation: "pay",
    reasonCode: "all_criteria_met",
    confidence: 0.97,
    summary: "genuine tester work",
    evidenceOk: true,
    contentSha256: "a".repeat(64),
    latencyMs: 1200,
    costUsd: 0.0003,
    x402PaymentTx: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureDecision).mockResolvedValue(payBriefFor());
});

describe("V2 pipeline — an unknown tester is paid via requestPayout, no allowlisting", () => {
  it("settles the exact mission reward to a wallet that was never allowlisted", async () => {
    const f = seedV2Campaign();
    const calls = { requestPayout: 0 };
    const deps = { campaignAdapter: makeFakeAdapter(f, { calls }), operatorAddress: () => V2_OPERATOR };

    const r = await runDeputyOnSubmission(f.submission.id, deps);

    expect(r.action).toBe("settled");
    expect(calls.requestPayout).toBe(1); // paid via requestPayout ...
    expect(ensureVendorApproved).not.toHaveBeenCalled(); // ... and NEVER allowlisted

    const sub = getSubmission(f.submission.id);
    expect(sub?.status).toBe("paid");

    const attempt = getAttempt(
      // the durable attempt exists, settled, with V2 metadata + the exact reward
      (await getAttemptFor(f.submission.id)) ?? "",
    );
    expect(attempt?.status).toBe("settled");
    expect(attempt?.vaultKind).toBe("campaign_v2");
    expect(attempt?.commitmentVersion).toBe(2);
    expect(attempt?.amountBase).toBe(f.mission.rewardAmount);
    expect(attempt?.recipient.toLowerCase()).toBe(f.submission.wallet.toLowerCase());
  });

  it("an UNAPPROVED judge model with a perfect qualifying brief CANNOT pay → held (judge_model_unapproved)", async () => {
    const f = seedV2Campaign();
    const calls = { requestPayout: 0 };
    // qualifies (pay / 0.97 / clean) but was produced by a model NOT on the autopay allowlist (the
    // fallback deepseek, or an alias) — the deterministic model gate blocks the payout regardless.
    vi.mocked(ensureDecision).mockResolvedValue({ ...payBriefFor(), model: "deepseek/deepseek-v4-flash" });
    const deps = { campaignAdapter: makeFakeAdapter(f, { calls }), operatorAddress: () => V2_OPERATOR };

    const r = await runDeputyOnSubmission(f.submission.id, deps);

    expect(r.action).toBe("held");
    expect(r.reason).toMatch(/judge_model_unapproved/);
    expect(calls.requestPayout).toBe(0); // never broadcast
    expect(getSubmission(f.submission.id)?.status).toBe("pending"); // reviewable, not paid
  });

  it("MISSING model provenance (null) with a qualifying brief also CANNOT pay → held", async () => {
    const f = seedV2Campaign();
    const calls = { requestPayout: 0 };
    vi.mocked(ensureDecision).mockResolvedValue({ ...payBriefFor(), model: null });
    const deps = { campaignAdapter: makeFakeAdapter(f, { calls }), operatorAddress: () => V2_OPERATOR };
    const r = await runDeputyOnSubmission(f.submission.id, deps);
    expect(r.action).toBe("held");
    expect(r.reason).toMatch(/judge_model_unapproved/);
    expect(calls.requestPayout).toBe(0);
  });

  it("re-firing the pipeline settles EXACTLY once (status guard + durable attempt)", async () => {
    const f = seedV2Campaign();
    const calls = { requestPayout: 0 };
    const deps = { campaignAdapter: makeFakeAdapter(f, { calls }), operatorAddress: () => V2_OPERATOR };

    await runDeputyOnSubmission(f.submission.id, deps);
    const second = await runDeputyOnSubmission(f.submission.id, deps);

    expect(calls.requestPayout).toBe(1); // still one broadcast
    expect(second.action).not.toBe("settled"); // already paid → not settled again
    expect(getSubmission(f.submission.id)?.status).toBe("paid");
  });

  it("a DB↔chain agreement mismatch HOLDS before any broadcast", async () => {
    const f = seedV2Campaign();
    const calls = { requestPayout: 0 };
    // the deployed vault reports a different owner than the DB founder.
    const snapshot = agreeingSnapshot(f, { owner: `0x${"9".repeat(40)}` });
    const deps = {
      campaignAdapter: makeFakeAdapter(f, { snapshot, calls }),
      operatorAddress: () => V2_OPERATOR,
    };

    const r = await runDeputyOnSubmission(f.submission.id, deps);

    expect(r.action).toBe("held");
    expect(r.reason).toMatch(/disagrees/i);
    expect(calls.requestPayout).toBe(0); // never broadcast
    expect(getSubmission(f.submission.id)?.status).toBe("pending"); // stays reviewable
  });

  it("the recipient-already-completed courtesy check holds (vault would soft-reject)", async () => {
    const f = seedV2Campaign();
    const calls = { requestPayout: 0 };
    const deps = {
      campaignAdapter: makeFakeAdapter(f, {
        calls,
        readiness: {
          state: "active",
          budgetRemainingBase: 1_000_000_000,
          missionRemaining: 4,
          recipientCompleted: true,
        },
      }),
      operatorAddress: () => V2_OPERATOR,
    };
    const r = await runDeputyOnSubmission(f.submission.id, deps);
    expect(r.action).toBe("held");
    expect(calls.requestPayout).toBe(0);
  });

  it("insufficient 24h velocity HOLDS before any broadcast (Part 5)", async () => {
    const f = seedV2Campaign(); // mission reward 500_000
    const calls = { requestPayout: 0 };
    const deps = {
      campaignAdapter: makeFakeAdapter(f, {
        calls,
        readiness: {
          state: "active",
          budgetRemainingBase: 1_000_000_000,
          missionRemaining: 4,
          recipientCompleted: false,
          velocityCapBase: 1_000_000,
          rollingSpendBase: 700_000, // remaining 300_000 < 500_000 reward
        },
      }),
      operatorAddress: () => V2_OPERATOR,
    };
    const r = await runDeputyOnSubmission(f.submission.id, deps);
    expect(r.action).toBe("held");
    expect(r.reason).toMatch(/velocity/i);
    expect(calls.requestPayout).toBe(0);
  });

  it("velocity exactly at the boundary proceeds", async () => {
    const f = seedV2Campaign();
    const calls = { requestPayout: 0 };
    const deps = {
      campaignAdapter: makeFakeAdapter(f, {
        calls,
        readiness: {
          state: "active",
          budgetRemainingBase: 1_000_000_000,
          missionRemaining: 4,
          recipientCompleted: false,
          velocityCapBase: 1_000_000,
          rollingSpendBase: 500_000, // remaining exactly == 500_000 reward
        },
      }),
      operatorAddress: () => V2_OPERATOR,
    };
    const r = await runDeputyOnSubmission(f.submission.id, deps);
    expect(r.action).toBe("settled");
    expect(calls.requestPayout).toBe(1);
  });
});

describe("exactly-once side effects after recovery (Part 6)", () => {
  it("re-applying settlement never double-counts the settled journal or the fee", async () => {
    const f = seedV2Campaign();
    const calls = { requestPayout: 0 };
    const deps = { campaignAdapter: makeFakeAdapter(f, { calls }), operatorAddress: () => V2_OPERATOR };

    // Settle once through the pipeline.
    const first = await runDeputyOnSubmission(f.submission.id, deps);
    expect(first.action).toBe("settled");

    // Re-apply the downstream effects directly (models a crash + recovery re-run of the
    // side-effect chokepoint): the durable attempt is settled, so no re-broadcast, and
    // each idempotent effect is a no-op the second time.
    const { settleApprovedSubmission } = await import("@/lib/campaigns/settle-flow");
    await settleApprovedSubmission(f.campaign, getSubmission(f.submission.id)!, deps);
    await settleApprovedSubmission(f.campaign, getSubmission(f.submission.id)!, deps);

    expect(calls.requestPayout).toBe(1); // never re-broadcast
    expect(getSubmission(f.submission.id)?.status).toBe("paid");
    expect(await countEvents(f.campaign.id, "settled")).toBe(1);
    expect(await countEvents(f.campaign.id, "autopay_settled")).toBe(1);
    expect(await countFees(f.submission.id)).toBe(1);
  });
});

/** Count journal events of a kind for a campaign (real DB). */
async function countEvents(campaignId: string, kind: string): Promise<number> {
  const { db } = await import("@/lib/db");
  const { events } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const rows = db.select().from(events).where(eq(events.campaignId, campaignId)).all();
  return rows.filter((r) => r.kind === kind).length;
}

/** Count operator-fee rows for a submission (real DB). */
async function countFees(submissionId: string): Promise<number> {
  const { db } = await import("@/lib/db");
  const { fees } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  return db.select().from(fees).where(eq(fees.submissionId, submissionId)).all().length;
}

describe("V1 pipeline — still goes through vendor approval (the paths differ)", () => {
  it("a V1 campaign calls ensureVendorApproved and settles via requestSpend", async () => {
    // A policy_v1 campaign with a matching decision; real settle-core path.
    const campaign = createCampaign({
      title: "v1 legacy",
      rewardAmount: 500_000,
      vaultAddress: `0x${"1".repeat(40)}`,
      posterWallet: `0x${"2".repeat(40)}`,
      chainId: 59902,
      ownerIsSage: true,
      status: "live",
      autonomy: "autopilot",
      autopilotThreshold: 0.85,
    }) as Campaign;
    const sub = createSubmission({ campaignId: campaign.id, wallet: `0x${"a".repeat(40)}` });
    if (!sub.ok) throw new Error("v1 seed failed");
    insertDecision({
      submissionId: sub.submission.id,
      campaignId: campaign.id,
      engine: "llm",
      model: "google/gemini-3.1-flash-lite-preview",
      brief: payBriefFor(),
      contentSha256: "a".repeat(64),
      evidenceOk: true,
      latencyMs: 1000,
      costUsd: 0.0003,
      x402PaymentTx: null,
    });

    // V1 vendor approval + spend succeed (mocked signer).
    const { submitRequestSpend } = await import("@/lib/deputy/signer");
    vi.mocked(ensureVendorApproved).mockResolvedValueOnce({
      approved: true,
      added: false,
      reason: "already_approved",
      txHashes: [],
    });
    vi.mocked(submitRequestSpend).mockImplementation(async (a) => {
      await a.onBroadcast?.("0xV1TX" as `0x${string}`);
      return { txHash: "0xV1TX" as `0x${string}`, settled: true, failedCheckIndex: null, explorerUrl: "x" };
    });

    const r = await runDeputyOnSubmission(sub.submission.id);

    expect(r.action).toBe("settled");
    expect(ensureVendorApproved).toHaveBeenCalledTimes(1); // V1 DOES allowlist
    expect(getSubmission(sub.submission.id)?.status).toBe("paid");
  });
});

/** Resolve the payout intent hash for a submission's durable attempt (test helper). */
async function getAttemptFor(submissionId: string): Promise<string | null> {
  const { db } = await import("@/lib/db");
  const { settlementAttempts } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const row = db
    .select()
    .from(settlementAttempts)
    .where(eq(settlementAttempts.submissionId, submissionId))
    .get();
  return row?.payoutIntentHash ?? null;
}
