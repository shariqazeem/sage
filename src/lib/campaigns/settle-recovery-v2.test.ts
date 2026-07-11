import { describe, expect, it } from "vitest";
import type { Hash } from "viem";

/**
 * Crash-recovery + integrity for CampaignVault V2, against the REAL in-memory db
 * and a fake adapter. Proves: a crash mid-broadcast resumes by READING the tx
 * (never re-sends); an errored attempt whose intent already settled reconciles from
 * the chain; and — the safety crux — a recovered event that DISAGREES with the
 * durable attempt (wrong reward, wrong recipient) is an integrity error that never
 * marks the submission paid.
 */

import {
  AmbiguousBroadcastError,
  SettlementIntegrityError,
  selectVaultStrategy,
  settleWithRecoveryVia,
} from "./vault-strategy";
import {
  getAttempt,
  markBroadcast,
  markFailed,
  prepareAttempt,
} from "@/lib/db/settlement-attempts";
import {
  V2_OPERATOR,
  makeFakeAdapter,
  outcomeMatching,
  seedV2Campaign,
  type V2Fixture,
} from "./campaign-v2.fixture";

const OP = () => V2_OPERATOR;

/** Compute the deterministic plan for a fixture (a throwaway strategy). */
function planFor(f: V2Fixture) {
  return selectVaultStrategy(f.campaign, f.submission, f.decision, {
    campaignAdapter: makeFakeAdapter(f),
    operatorAddress: OP,
  }).plan();
}

/** Seed a durable attempt row for a V2 plan (models a settle already in flight). */
function seedAttempt(f: V2Fixture, plan: ReturnType<typeof planFor>) {
  prepareAttempt({
    payoutIntentHash: plan.payoutIntentHash,
    decisionDigest: plan.decisionDigest,
    submissionId: plan.submissionId,
    campaignId: plan.campaignId,
    chainId: plan.chainId,
    vaultAddress: plan.vaultAddress,
    recipient: plan.recipient,
    amountBase: plan.amountBase,
    commitmentVersion: 2,
    missionIdHash: plan.missionIdHash,
    vaultKind: "campaign_v2",
  });
}

describe("V2 recovery — resume from persisted state, never a blind re-send", () => {
  it("a crash between broadcast and receipt resumes by READING the tx", async () => {
    const f = seedV2Campaign();
    const plan = planFor(f);
    seedAttempt(f, plan);
    markBroadcast(plan.payoutIntentHash, "0xOLD" as Hash);

    const calls = { requestPayout: 0 };
    const resumeOutcome = outcomeMatching(plan, "0xOLD" as Hash);
    const strategy = selectVaultStrategy(f.campaign, f.submission, f.decision, {
      campaignAdapter: makeFakeAdapter(f, { resumeOutcome, calls }),
      operatorAddress: OP,
    });

    const out = await settleWithRecoveryVia(strategy);

    expect(calls.requestPayout).toBe(0); // resumed, not re-sent
    expect(out.settled).toBe(true);
    expect(out.txHash).toBe("0xOLD");
    expect(getAttempt(plan.payoutIntentHash)?.status).toBe("settled");
  });

  it("an errored attempt whose intent already settled reconciles from the chain", async () => {
    const f = seedV2Campaign();
    const plan = planFor(f);
    seedAttempt(f, plan);
    markFailed(plan.payoutIntentHash, "RPC exploded mid-send");

    const calls = { requestPayout: 0 };
    const strategy = selectVaultStrategy(f.campaign, f.submission, f.decision, {
      campaignAdapter: makeFakeAdapter(f, {
        calls,
        intentUsed: true,
        allOutcomes: [outcomeMatching(plan, "0xFOUND" as Hash)],
      }),
      operatorAddress: OP,
    });

    const out = await settleWithRecoveryVia(strategy);

    expect(calls.requestPayout).toBe(0); // the intent already moved money — never resend
    expect(out.settled).toBe(true);
    expect(out.txHash).toBe("0xFOUND");
    expect(getAttempt(plan.payoutIntentHash)?.status).toBe("settled");
  });

  it("a re-fire after settlement returns the record without re-broadcasting", async () => {
    const f = seedV2Campaign();
    const calls = { requestPayout: 0 };
    const mk = () =>
      selectVaultStrategy(f.campaign, f.submission, f.decision, {
        campaignAdapter: makeFakeAdapter(f, { calls }),
        operatorAddress: OP,
      });
    await settleWithRecoveryVia(mk());
    const again = await settleWithRecoveryVia(mk());
    expect(again.settled).toBe(true);
    expect(calls.requestPayout).toBe(1); // still one broadcast total
  });
});

describe("the RPC-accepted-but-txHash-not-persisted window (Part 2)", () => {
  /**
   * THE mandatory simulation: the RPC accepts the tx, the app crashes before the
   * hash is persisted, the tx stays pending, recovery reads isIntentUsed==false, and
   * recovery runs MANY times — with ZERO replacement broadcasts — until the original
   * tx settles and is reconciled, paid exactly once.
   */
  it("accepted-but-unpersisted: recovery HOLDS (no resend) until the original settles", async () => {
    const f = seedV2Campaign();
    const plan = planFor(f);
    const calls = { requestPayout: 0, senders: [] as string[] };

    // 1–3. The send is accepted (identity persisted via onPreflight) then the process
    // "crashes" before the hash is written → the attempt is durably `broadcasting`.
    await expect(
      settleWithRecoveryVia(
        selectVaultStrategy(f.campaign, f.submission, f.decision, {
          campaignAdapter: makeFakeAdapter(f, {
            calls,
            throwOnSend: true,
            reservedNonce: 10,
          }),
          operatorAddress: OP,
        }),
      ),
    ).rejects.toThrow();
    expect(getAttempt(plan.payoutIntentHash)?.status).toBe("broadcasting");
    expect(calls.requestPayout).toBe(1); // the one (accepted) send

    // 4–6. Recovery runs MULTIPLE times while the tx is pending. isIntentUsed==false,
    // the reserved nonce is CONSUMED (a tx was accepted) → HOLD, never a resend.
    for (let i = 0; i < 3; i++) {
      await expect(
        settleWithRecoveryVia(
          selectVaultStrategy(f.campaign, f.submission, f.decision, {
            campaignAdapter: makeFakeAdapter(f, {
              calls,
              intentUsed: false,
              allOutcomes: [], // not mined yet
              senderNonce: { pending: 11, latest: 11 }, // nonce 10 consumed → a tx exists
            }),
            operatorAddress: OP,
          }),
        ),
      ).rejects.toBeInstanceOf(AmbiguousBroadcastError);
    }
    expect(calls.requestPayout).toBe(1); // ZERO replacement broadcasts

    // 7–9. The original tx finally settles → recovery reconciles it, paid exactly once.
    const out = await settleWithRecoveryVia(
      selectVaultStrategy(f.campaign, f.submission, f.decision, {
        campaignAdapter: makeFakeAdapter(f, {
          calls,
          allOutcomes: [outcomeMatching(plan, "0xORIGINAL" as Hash)],
        }),
        operatorAddress: OP,
      }),
    );
    expect(out.settled).toBe(true);
    expect(out.txHash).toBe("0xORIGINAL");
    expect(calls.requestPayout).toBe(1); // still ONE broadcast, ever
    expect(getAttempt(plan.payoutIntentHash)?.status).toBe("settled");
  });

  it("a broadcasting crash where the nonce is PROVABLY unused is safe to resend", async () => {
    const f = seedV2Campaign();
    const plan = planFor(f);
    const calls = { requestPayout: 0, senders: [] as string[] };

    await expect(
      settleWithRecoveryVia(
        selectVaultStrategy(f.campaign, f.submission, f.decision, {
          campaignAdapter: makeFakeAdapter(f, { calls, throwOnSend: true, reservedNonce: 10 }),
          operatorAddress: OP,
        }),
      ),
    ).rejects.toThrow();
    expect(getAttempt(plan.payoutIntentHash)?.status).toBe("broadcasting");

    // The reserved nonce 10 is still UNUSED (pending==latest==10) → no tx was accepted
    // → recovery may re-broadcast. This time the send succeeds.
    const out = await settleWithRecoveryVia(
      selectVaultStrategy(f.campaign, f.submission, f.decision, {
        campaignAdapter: makeFakeAdapter(f, {
          calls,
          allOutcomes: [],
          senderNonce: { pending: 10, latest: 10 },
        }),
        operatorAddress: OP,
      }),
    );
    expect(out.settled).toBe(true);
    expect(calls.requestPayout).toBe(2); // the crashed send + one safe resend
  });

  it("a replay rejection with no surfaced settlement HOLDS (never conceals a settlement)", async () => {
    const f = seedV2Campaign();
    const plan = planFor(f);
    seedAttempt(f, plan);
    markFailed(plan.payoutIntentHash, "errored");
    const strategy = selectVaultStrategy(f.campaign, f.submission, f.decision, {
      campaignAdapter: makeFakeAdapter(f, {
        intentUsed: true,
        allOutcomes: [
          outcomeMatching(plan, "0xREJ" as Hash, { status: "rejected", failedCheckIndex: 8 }),
        ],
      }),
      operatorAddress: OP,
    });
    await expect(settleWithRecoveryVia(strategy)).rejects.toThrow();
    expect(getAttempt(plan.payoutIntentHash)?.status).not.toBe("settled");
  });
});

describe("V2 integrity — a mismatched recovered event NEVER marks paid", () => {
  it("a resumed tx whose event pays a different reward is an integrity error", async () => {
    const f = seedV2Campaign();
    const plan = planFor(f);
    seedAttempt(f, plan);
    markBroadcast(plan.payoutIntentHash, "0xOLD" as Hash);

    const strategy = selectVaultStrategy(f.campaign, f.submission, f.decision, {
      campaignAdapter: makeFakeAdapter(f, {
        resumeOutcome: outcomeMatching(plan, "0xOLD" as Hash, {
          amountBase: plan.amountBase + 99_999,
        }),
      }),
      operatorAddress: OP,
    });

    await expect(settleWithRecoveryVia(strategy)).rejects.toBeInstanceOf(SettlementIntegrityError);
    expect(getAttempt(plan.payoutIntentHash)?.status).not.toBe("settled");
  });

  it("a reconciled event paying a different recipient is an integrity error", async () => {
    const f = seedV2Campaign();
    const plan = planFor(f);
    seedAttempt(f, plan);
    markFailed(plan.payoutIntentHash, "errored");

    const strategy = selectVaultStrategy(f.campaign, f.submission, f.decision, {
      campaignAdapter: makeFakeAdapter(f, {
        intentUsed: true,
        allOutcomes: [
          outcomeMatching(plan, "0xFOUND" as Hash, {
            recipient: "0x9999999999999999999999999999999999999999",
          }),
        ],
      }),
      operatorAddress: OP,
    });

    await expect(settleWithRecoveryVia(strategy)).rejects.toBeInstanceOf(SettlementIntegrityError);
    expect(getAttempt(plan.payoutIntentHash)?.status).not.toBe("settled");
  });
});
