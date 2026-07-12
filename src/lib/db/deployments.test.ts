import { describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import { db } from "./index";
import { nowSeconds } from "./keys";
import { inspectionJobs, planRevisions } from "./schema";
import {
  createDeployment,
  getActiveDeploymentForRevision,
  recordClaim,
  markPreflightReady,
  recordStepBroadcast,
  confirmStep,
  beginAttach,
  markLive,
  markFailed,
  getDeployment,
  type CreateDeploymentInput,
} from "./deployments";

/**
 * These run against a REAL in-memory SQLite (vitest sets SAGE_DB_PATH=":memory:"), so the
 * FKs, the atomic compare-and-set transitions, and write-once tx columns are proven by the
 * actual engine. Each test seeds a distinct job + approved revision so it is independent.
 */

const FOUNDER = `0x${"a".repeat(40)}`;
const PREDICTED = `0x${"b".repeat(40)}`;

function seedRevision(): { jobId: string; revisionId: string } {
  const now = nowSeconds();
  const jobId = nanoid(12);
  db.insert(inspectionJobs)
    .values({
      id: jobId, founderWallet: FOUNDER, idempotencyKey: nanoid(20), status: "ready",
      publicCampaignId: `pub-${jobId}`, productUrl: "https://x.example", goal: "g", targetUsers: "u",
      totalBudgetBase: 100_000, tokenDecimals: 6, createdAt: now, updatedAt: now,
    })
    .run();
  const revisionId = nanoid(14);
  db.insert(planRevisions)
    .values({
      id: revisionId, jobId, revisionNumber: 1, authorWallet: FOUNDER, reason: "generated",
      planJson: {}, budgetBase: 100_000, validationOk: true,
      campaignIdHash: `0x${"c".repeat(64)}`, missionPlanDigest: `0x${"d".repeat(64)}`,
      approvedAt: now, approverWallet: FOUNDER, createdAt: now,
    })
    .run();
  return { jobId, revisionId };
}

function input(over: Partial<CreateDeploymentInput> = {}): CreateDeploymentInput {
  const { jobId, revisionId } = seedRevision();
  return {
    jobId, revisionId, revisionNumber: 1, founderWallet: FOUNDER, chainId: 59902,
    settings: { factory: `0x${"f".repeat(40)}` }, campaignIdHash: `0x${"c".repeat(64)}`,
    missionPlanDigest: `0x${"d".repeat(64)}`, calldataDigest: `0x${"e".repeat(64)}`,
    totalBudgetBase: BigInt(100_000), predictedVault: PREDICTED, ...over,
  };
}

describe("deployments — one active per revision (idempotent create)", () => {
  it("returns the existing active deployment instead of creating a second", () => {
    const inp = input();
    const a = createDeployment(inp);
    const b = createDeployment(inp);
    expect(b.id).toBe(a.id);
    expect(getActiveDeploymentForRevision(inp.revisionId)?.id).toBe(a.id);
  });
});

describe("deployments — the happy path advances to live", () => {
  it("claim → preflight → create → approve → fund → activate → attach → live", () => {
    const d = createDeployment(input());
    expect(recordClaim(d.id, { nonce: nanoid(10), signature: "0xsig", founderWallet: FOUNDER }).ok).toBe(true);
    expect(markPreflightReady(d.id).ok).toBe(true);

    const bc = recordStepBroadcast(d.id, "create", "0xcreate");
    expect(bc).toMatchObject({ ok: true, broadcast: true, txHash: "0xcreate" });
    expect(confirmStep(d.id, "create", { deployedVault: PREDICTED }).ok).toBe(true);

    expect(recordStepBroadcast(d.id, "approve", "0xapprove").broadcast).toBe(true);
    expect(confirmStep(d.id, "approve").ok).toBe(true);
    expect(recordStepBroadcast(d.id, "fund", "0xfund").broadcast).toBe(true);
    expect(confirmStep(d.id, "fund").ok).toBe(true);
    expect(recordStepBroadcast(d.id, "activate", "0xactivate").broadcast).toBe(true);
    expect(confirmStep(d.id, "activate").ok).toBe(true);

    expect(beginAttach(d.id).ok).toBe(true);
    const live = markLive(d.id, "campaign-123");
    expect(live.ok).toBe(true);
    expect(getDeployment(d.id)?.state).toBe("live");
    expect(getDeployment(d.id)?.attachedCampaignId).toBe("campaign-123");
  });
});

describe("deployments — no blind resend (write-once tx)", () => {
  it("a second broadcast of the same step returns the recorded hash, does not resend", () => {
    const d = createDeployment(input());
    recordClaim(d.id, { nonce: nanoid(10), signature: "0xsig", founderWallet: FOUNDER });
    markPreflightReady(d.id);
    const first = recordStepBroadcast(d.id, "create", "0xFIRST");
    expect(first.broadcast).toBe(true);
    const second = recordStepBroadcast(d.id, "create", "0xSECOND"); // attempt to resend
    expect(second).toMatchObject({ ok: true, broadcast: false, txHash: "0xFIRST" }); // original kept
    expect(getDeployment(d.id)?.createTx).toBe("0xFIRST");
  });
});

describe("deployments — a mismatched vault never becomes live", () => {
  it("confirming create with a vault ≠ prediction routes to recovery_required", () => {
    const d = createDeployment(input());
    recordClaim(d.id, { nonce: nanoid(10), signature: "0xsig", founderWallet: FOUNDER });
    markPreflightReady(d.id);
    recordStepBroadcast(d.id, "create", "0xcreate");
    const r = confirmStep(d.id, "create", { deployedVault: `0x${"9".repeat(40)}` }); // wrong vault
    expect(r.ok).toBe(false);
    expect(getDeployment(d.id)?.state).toBe("recovery_required");
  });
});

describe("deployments — attachment failure never redeploys", () => {
  it("markFailed after a vault exists is redirected to recovery_required", () => {
    const d = createDeployment(input());
    recordClaim(d.id, { nonce: nanoid(10), signature: "0xsig", founderWallet: FOUNDER });
    markPreflightReady(d.id);
    recordStepBroadcast(d.id, "create", "0xcreate");
    confirmStep(d.id, "create", { deployedVault: PREDICTED });
    // now a vault exists — a "failure" must recover, not abandon or redeploy.
    const r = markFailed(d.id, "attach threw");
    expect(r.ok).toBe(true);
    expect(getDeployment(d.id)?.state).toBe("recovery_required");
    expect(getActiveDeploymentForRevision(input({}).revisionId)).toBeNull(); // (different revision) sanity
  });

  it("a pre-vault failure is allowed to reach failed", () => {
    const d = createDeployment(input());
    recordClaim(d.id, { nonce: nanoid(10), signature: "0xsig", founderWallet: FOUNDER });
    const r = markFailed(d.id, "founder abandoned before deploy");
    expect(r.ok).toBe(true);
    expect(getDeployment(d.id)?.state).toBe("failed");
  });
});

describe("deployments — claim binding", () => {
  it("rejects a claim whose wallet is not this deployment's founder", () => {
    const d = createDeployment(input());
    const r = recordClaim(d.id, { nonce: nanoid(10), signature: "0xsig", founderWallet: `0x${"7".repeat(40)}` });
    expect(r.ok).toBe(false);
    expect(getDeployment(d.id)?.state).toBe("prepared");
  });

  it("rejects a nonce already used by another deployment", () => {
    const nonce = nanoid(10);
    const d1 = createDeployment(input());
    expect(recordClaim(d1.id, { nonce, signature: "0xsig", founderWallet: FOUNDER }).ok).toBe(true);
    const d2 = createDeployment(input());
    const r = recordClaim(d2.id, { nonce, signature: "0xsig2", founderWallet: FOUNDER });
    expect(r).toMatchObject({ ok: false });
  });
});

describe("deployments — atomic CAS rejects a stale advance", () => {
  it("cannot advance from a state the row has already left", () => {
    const d = createDeployment(input());
    recordClaim(d.id, { nonce: nanoid(10), signature: "0xsig", founderWallet: FOUNDER });
    markPreflightReady(d.id);
    // simulate a concurrent write that already moved the row forward.
    recordStepBroadcast(d.id, "create", "0xcreate"); // now in `deploying`
    // a second attempt to broadcast create from the (now stale) preflight_ready is refused.
    const stale = recordStepBroadcast(d.id, "create", "0xother");
    expect(stale.broadcast).toBe(false); // write-once + state guard both hold
  });
});
