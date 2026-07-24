import { describe, expect, it } from "vitest";

import { db } from "./index";
import { inspectionJobs } from "./schema";
import { nowSeconds } from "./keys";
import {
  createInspectionJob,
  updateInspectionJob,
  founderGoalDigest,
  requestCommitment,
  RequestIdentityMismatchError,
} from "./inspection";

/**
 * REQUEST-SCOPED intent closure — inspection idempotency is keyed on a server-minted
 * `planningRequestId` (one founder TURN → one job), NOT on content. A later turn with the
 * same url+goal+budget receives a NEW request id and a NEW job; it can never reuse an
 * already-ready plan. Reusing a request id with a different payload fails CLOSED. And the
 * goal digest is EXACT (case/whitespace load-bearing). Real in-memory SQLite.
 *
 * Incident 2026-07-24: a goal-blind, content-scoped key returned the stale READY job
 * `6PciNNBK3f1A` (created 2026-07-18 for a DIFFERENT goal on the same URL + $1.50) and
 * presented its old plan as current + fundable. These tests pin the request-scoped model.
 */

let n = 0;
const uniq = () => `${Date.now() % 1_000_000}-${n++}`;
const founder = () => `clawup:test-${uniq()}`;
const rid = () => `prid:test:${uniq()}`;
const base = (goal: string, over: Partial<Parameters<typeof createInspectionJob>[0]> = {}) => ({
  founderWallet: founder(),
  publicCampaignId: `pub-${n}`,
  productUrl: "https://yara.garden/",
  goal,
  targetUsers: "first-time visitors",
  totalBudgetBase: BigInt(1_500_000), // $1.50
  tokenDecimals: 6,
  planningRequestId: rid(),
  surface: "test",
  ...over,
});

const OLD_GOAL =
  "Does a first-time visitor understand what yara.garden is and find the living, interactive moments rewarding? I want to know which specific scenes or interactions felt alive, which felt broken or confusing, and where a newcomer loses interest.";
const NEW_GOAL = "make users land in yara.garden and go to yara character and talk to her";

describe("founderGoalDigest — EXACT, case- and whitespace-sensitive (v2)", () => {
  it("different goals → different digests", () => {
    expect(founderGoalDigest(OLD_GOAL)).not.toBe(founderGoalDigest(NEW_GOAL));
  });
  it("case is load-bearing: /Room/A ≠ /room/a, YaraDev ≠ yaradev", () => {
    expect(founderGoalDigest("/Room/A")).not.toBe(founderGoalDigest("/room/a"));
    expect(founderGoalDigest("YaraDev")).not.toBe(founderGoalDigest("yaradev"));
    expect(founderGoalDigest("Talk to Yara")).not.toBe(founderGoalDigest("talk to yara"));
  });
  it("internal whitespace is load-bearing (never collapsed)", () => {
    expect(founderGoalDigest("talk   to yara")).not.toBe(founderGoalDigest("talk to yara"));
    expect(founderGoalDigest("a\tb")).not.toBe(founderGoalDigest("a b"));
  });
  it("only storage-safe normalization is applied: boundary trim, CRLF→LF, NFC (no-ops on the digest)", () => {
    expect(founderGoalDigest("  talk to yara  ")).toBe(founderGoalDigest("talk to yara")); // boundary trim
    expect(founderGoalDigest("line1\r\nline2")).toBe(founderGoalDigest("line1\nline2")); // CRLF→LF
    expect(founderGoalDigest("é")).toBe(founderGoalDigest("é")); // NFC: e+combining ́ === é
  });
  it("null / non-string coerces to the empty-goal digest (never throws)", () => {
    expect(founderGoalDigest(null)).toBe(founderGoalDigest(""));
    expect(founderGoalDigest(undefined)).toBe(founderGoalDigest(""));
    expect(founderGoalDigest(42 as unknown)).toBe(founderGoalDigest(""));
  });
});

describe("requestCommitment — versioned, structured, payload-sensitive", () => {
  const g = founderGoalDigest(NEW_GOAL);
  const c = (over: Partial<Parameters<typeof requestCommitment>[0]> = {}) =>
    requestCommitment({
      surface: "telegram",
      actor: "clawup:x",
      planningRequestId: "prid:tg:abc",
      productUrl: "https://yara.garden/",
      repoUrl: null,
      goalDigest: g,
      budgetBase: BigInt(1_500_000),
      tokenDecimals: 6,
      ...over,
    });
  it("identical fields → identical commitment", () => {
    expect(c()).toBe(c());
  });
  it("any changed field → different commitment (goal, budget, url, repo, actor, request id)", () => {
    expect(c()).not.toBe(c({ goalDigest: founderGoalDigest(OLD_GOAL) }));
    expect(c()).not.toBe(c({ budgetBase: BigInt(3_000_000) }));
    expect(c()).not.toBe(c({ productUrl: "https://other.test/" }));
    expect(c()).not.toBe(c({ repoUrl: "https://github.com/a/b" }));
    expect(c()).not.toBe(c({ actor: "clawup:y" }));
    expect(c()).not.toBe(c({ planningRequestId: "prid:tg:zzz" }));
  });
});

describe("createInspectionJob — REQUEST-SCOPED identity", () => {
  it("#1 EXACT INCIDENT: a READY job for goal A + a NEW request for goal B ⇒ NEW job id, current goal", () => {
    const wallet = founder();
    const a = createInspectionJob(base(OLD_GOAL, { founderWallet: wallet, planningRequestId: rid() }));
    expect(a.created).toBe(true);
    updateInspectionJob(a.job.id, "ready"); // the July-18 job is READY, exactly like 6PciNNBK3f1A

    const b = createInspectionJob(base(NEW_GOAL, { founderWallet: wallet, planningRequestId: rid() }));
    expect(b.created).toBe(true);
    expect(b.job.id).not.toBe(a.job.id);
    expect(b.job.goal).toBe(NEW_GOAL);
  });

  it("#2 SAME content in a NEW founder turn (new request id) ⇒ NEW job", () => {
    const wallet = founder();
    const a = createInspectionJob(base(NEW_GOAL, { founderWallet: wallet, planningRequestId: rid() }));
    updateInspectionJob(a.job.id, "ready");
    // byte-for-byte identical url+goal+budget, but a new turn → new request id → a fresh job.
    const b = createInspectionJob(base(NEW_GOAL, { founderWallet: wallet, planningRequestId: rid() }));
    expect(b.created).toBe(true);
    expect(b.job.id).not.toBe(a.job.id);
  });

  it("#3 SAME request id retried while queued ⇒ same job (idempotent)", () => {
    const req = rid();
    const a = createInspectionJob(base(NEW_GOAL, { planningRequestId: req }));
    const b = createInspectionJob(base(NEW_GOAL, { planningRequestId: req, founderWallet: a.job.founderWallet }));
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
  });

  it("#4 SAME request id retried after READY ⇒ same job (never a duplicate re-plan)", () => {
    const req = rid();
    const a = createInspectionJob(base(NEW_GOAL, { planningRequestId: req }));
    updateInspectionJob(a.job.id, "ready");
    const b = createInspectionJob(base(NEW_GOAL, { planningRequestId: req, founderWallet: a.job.founderWallet }));
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
  });

  it("#5 SAME request id with a CHANGED goal ⇒ request_identity_mismatch (fails closed)", () => {
    const req = rid();
    const wallet = founder();
    createInspectionJob(base(NEW_GOAL, { planningRequestId: req, founderWallet: wallet }));
    expect(() => createInspectionJob(base(OLD_GOAL, { planningRequestId: req, founderWallet: wallet }))).toThrow(
      RequestIdentityMismatchError,
    );
  });

  it("#6 SAME request id with a CHANGED budget ⇒ request_identity_mismatch (fails closed)", () => {
    const req = rid();
    const wallet = founder();
    createInspectionJob(base(NEW_GOAL, { planningRequestId: req, founderWallet: wallet }));
    expect(() =>
      createInspectionJob(base(NEW_GOAL, { planningRequestId: req, founderWallet: wallet, totalBudgetBase: BigInt(3_000_000) })),
    ).toThrow(RequestIdentityMismatchError);
  });

  it("#7 SAME goal, DIFFERENT budget, DIFFERENT request id ⇒ new job", () => {
    const wallet = founder();
    const a = createInspectionJob(base(NEW_GOAL, { founderWallet: wallet, planningRequestId: rid() }));
    const b = createInspectionJob(base(NEW_GOAL, { founderWallet: wallet, planningRequestId: rid(), totalBudgetBase: BigInt(3_000_000) }));
    expect(b.job.id).not.toBe(a.job.id);
    expect(b.created).toBe(true);
  });

  it("#9 a LEGACY goal-less row (null request columns, content key) is never returned for a new request", () => {
    // Simulate 6PciNNBK3f1A: a content-keyed, READY, pre-identity row with null planningRequestId.
    const legacyId = "LEGACY6Pci77";
    const now = nowSeconds();
    db.insert(inspectionJobs)
      .values({
        id: legacyId,
        founderWallet: "clawup:legacy",
        idempotencyKey: "legacy-content-hash-deadbeef",
        planningRequestId: null,
        status: "ready",
        publicCampaignId: "legacy-pub",
        productUrl: "https://yara.garden/",
        goal: OLD_GOAL,
        targetUsers: "u",
        totalBudgetBase: 1_500_000,
        tokenDecimals: 6,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const fresh = createInspectionJob(
      base(NEW_GOAL, { founderWallet: "clawup:legacy", planningRequestId: rid() }),
    );
    expect(fresh.created).toBe(true);
    expect(fresh.job.id).not.toBe(legacyId);
    expect(fresh.job.goal).toBe(NEW_GOAL);
  });

  it("#10 a completed NEW-schema job is not silently reused by a later identical turn", () => {
    const wallet = founder();
    const a = createInspectionJob(base(NEW_GOAL, { founderWallet: wallet, planningRequestId: rid() }));
    updateInspectionJob(a.job.id, "ready");
    const c = createInspectionJob(base(NEW_GOAL, { founderWallet: wallet, planningRequestId: rid() }));
    expect(c.job.id).not.toBe(a.job.id);
    expect(c.created).toBe(true);
  });

  it("#18 a FAILED same-request retry resets + re-runs the SAME job (no uncontrolled duplicate)", () => {
    const req = rid();
    const wallet = founder();
    const a = createInspectionJob(base(NEW_GOAL, { planningRequestId: req, founderWallet: wallet }));
    updateInspectionJob(a.job.id, "failed");
    const b = createInspectionJob(base(NEW_GOAL, { planningRequestId: req, founderWallet: wallet }));
    expect(b.created).toBe(true); // reset for a fresh run
    expect(b.job.id).toBe(a.job.id); // same job — not a duplicate
    expect(b.job.status).toBe("queued");
  });

  it("persists the identity provenance columns on a new row", () => {
    const req = rid();
    const r = createInspectionJob(base(NEW_GOAL, { planningRequestId: req }));
    expect(r.job.planningRequestId).toBe(req);
    expect(r.job.idempotencyKey).toBe(req);
    expect(r.job.founderGoalDigest).toBe(founderGoalDigest(NEW_GOAL));
    expect(r.job.requestCommitment).toBeTruthy();
    expect(r.job.plannerVersion).toBeTruthy();
  });
});
