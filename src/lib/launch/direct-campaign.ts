import { createHash } from "node:crypto";

import { z } from "zod";
import { keccak256, stringToHex, type Hex } from "viem";
import { nanoid } from "nanoid";

import { CHAINS } from "@/lib/deputy/networks";
import { siteUrl } from "@/lib/site";
import type { VerificationContract } from "@/lib/verify/contract";
import { createInspectionJob, updateInspectionJob } from "@/lib/db/inspection";
import { approveRevision, createRevision } from "@/lib/db/plan-revisions";

import { compilePlan } from "./plan";
import { serialize } from "./job";
import { verifyPlanForApproval } from "./approve";
import { checkRevisionPolicyForApproval } from "./approve-policy";
import { mintWebRequestId } from "./planning-request";
import { TANGIBLE_MIN_PER_REWARD_USD, MAX_COMPLETIONS } from "./budget";
import type { BudgetAllocation, CandidateMission, MissionPlanV1 } from "./schemas";
import type { LaunchResult } from "./pipeline";

/**
 * WORK PROOF — the DIRECT campaign compiler (docs/work-proof-design.md §A/§B).
 *
 * A direct campaign is a real inspection job + a real plan revision whose AUTHOR is the operator,
 * not the Mission Brain: milestones (grants) or deliverables (gigs), each carrying an explicit
 * VerificationContract the judge later runs as a deterministic pre-gate. No browsing, no model —
 * everything here is deterministic compilation of validated operator input, and everything
 * downstream (claim → deploy wizard → vault → attach → marketplace → receipts) is the EXISTING
 * machinery running unchanged on the same rows.
 *
 * Economics are OPERATOR-priced (a funder decides tranche sizes), so the total budget is DERIVED:
 * totalBudgetBase = Σ(rewardBase × slots) in 6-decimal base units — the exact-sum invariant holds
 * by construction, and `compilePlan` re-checks it. Floors still bind (the $0.50 tangible floor).
 * `allocateBudget` is deliberately NOT involved: it allocates a testing budget by priority; a
 * grant's tranches are the operator's own stated numbers.
 */

export const DIRECT_PLAN_VERSION = "direct-v1";
export const DIRECT_MODEL_LABEL = "direct/operator";

export const DIRECT_LIMITS = {
  milestonesMax: 12,
  rewardUsdMin: TANGIBLE_MIN_PER_REWARD_USD, // $0.50 — the same tangible floor as testing
  rewardUsdMax: 500,
  totalUsdMax: 5_000,
  slotsMax: Number(MAX_COMPLETIONS), // 50 — the same cap the vault machinery already assumes
  allowlistMax: 100,
} as const;

/* ───────────────────────────────── input schema (operator-authored) ────── */

const walletRe = /^0x[0-9a-fA-F]{40}$/;
const hex32Re = /^0x[0-9a-fA-F]{64}$/;
const selectorRe = /^0x[0-9a-fA-F]{8}$/;
const decimalRe = /^[0-9]{1,30}$/;
const hostRe = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const chainIdKnown = (id: number) => !!CHAINS[id];

/** onchain_tx — at least one shape constraint beyond tester-binding, or the contract would verify
 *  ANY transaction the tester ever sent (too weak to gate money). */
const onchainTxSchema = z
  .object({
    kind: z.literal("onchain_tx"),
    chainId: z.number().int().refine(chainIdKnown, "unknown chain"),
    to: z.string().regex(walletRe).optional(),
    minValueWei: z.string().regex(decimalRe).optional(),
    methodSelector: z.string().regex(selectorRe).optional(),
    logTopic0: z.string().regex(hex32Re).optional(),
    logEmitter: z.string().regex(walletRe).optional(),
  })
  .refine(
    (c) => !!(c.to || c.methodSelector || c.logTopic0 || c.minValueWei),
    "an on-chain tx contract needs at least one of: to, methodSelector, logTopic0, minValueWei",
  );

const onchainStateSchema = z
  .object({
    kind: z.literal("onchain_state"),
    chainId: z.number().int().refine(chainIdKnown, "unknown chain"),
    contract: z.string().regex(walletRe),
    callData: z.string().regex(/^0x[0-9a-fA-F]{8}(?:[0-9a-fA-F]{64})*$/, "selector + 32-byte words"),
    injectTesterArgWord: z.number().int().min(0).max(15).optional(),
    minUint: z.string().regex(decimalRe).optional(),
    expectTesterAddress: z.boolean().optional(),
  })
  .refine((c) => !!(c.minUint || c.expectTesterAddress), "an on-chain state contract needs minUint or expectTesterAddress");

const artifactUrlSchema = z.object({
  kind: z.literal("artifact_url"),
  /**
   * MAY BE EMPTY — "any page you publish that visibly carries your wallet". MEASURED by P-DIRECT
   * 2026-08-28: the flagship grant ("fund my cousin's shop… when the shop page is published")
   * cannot name a host, because the shop has no domain yet — requiring one made the MSME case
   * inexpressible. The MARKER is the authorship binding that matters (only the submitter can put
   * their own wallet on a page); the host list is an operator preference on top of it. An empty
   * list is honestly weaker, and the verifiability lint says so before the operator funds.
   */
  allowedHosts: z.array(z.string().max(120).regex(hostRe, "bare hostname, e.g. app.example.com")).max(5),
  markerKind: z.enum(["wallet", "handle", "nonce"]),
  mustContain: z.array(z.string().min(2).max(200)).max(5).optional(),
});

const publicUrlSchema = z.object({
  kind: z.literal("public_url"),
  expectedText: z.array(z.string().min(3).max(300)).min(1).max(5),
});

/** `observation` is STRUCTURALLY absent: a direct campaign has no private corpus (Sage never
 *  browsed), so an observation-judged milestone could never be judged honestly. */
const contractSchema = z.discriminatedUnion("kind", [
  onchainTxSchema,
  onchainStateSchema,
  artifactUrlSchema,
  publicUrlSchema,
]);

const milestoneSchema = z.object({
  title: z.string().min(4).max(120),
  instructions: z.string().min(10).max(2000),
  criteria: z.array(z.string().min(4).max(300)).min(1).max(8),
  evidence: contractSchema,
  /** operator-priced tranche, USD, at most 2 decimals. */
  rewardUsd: z
    .number()
    .positive()
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "at most 2 decimals")
    .refine((v) => v >= DIRECT_LIMITS.rewardUsdMin, `at least $${DIRECT_LIMITS.rewardUsdMin} per completion`)
    .refine((v) => v <= DIRECT_LIMITS.rewardUsdMax, `at most $${DIRECT_LIMITS.rewardUsdMax} per completion`),
  slots: z.number().int().min(1).max(DIRECT_LIMITS.slotsMax),
  effortMinutes: z.number().int().min(1).max(240).optional(),
});

export const directCampaignSchema = z.object({
  kind: z.enum(["grant", "gig"]),
  title: z.string().min(4).max(80),
  /**
   * OPTIONAL context surface. MEASURED by P-DIRECT 2026-08-28: requiring this made the flagship
   * milestone-grant impossible — "fund my cousin's shop $60 in three milestones" names no URL,
   * because a grant is about WORK, not a product, and the model could only fail the schema. When
   * absent the campaign's own board becomes the context surface, which is where the work is in
   * fact defined.
   */
  productUrl: z.string().url().max(400).refine((u) => u.startsWith("https://"), "https only").optional(),
  whyItMatters: z.string().min(10).max(600).optional(),
  milestones: z.array(milestoneSchema).min(1).max(DIRECT_LIMITS.milestonesMax),
  /** optional recipient allowlist — named grantees. Enforced at the submit route (app-level). */
  allowlist: z.array(z.string().regex(walletRe)).min(1).max(DIRECT_LIMITS.allowlistMax).optional(),
});

export type DirectCampaignInput = z.infer<typeof directCampaignSchema>;

/* ───────────────────────────── verifiability lint (Phase 1) ─────────────── */

/** A criterion that only restates the deterministic layer (host + marker), adding nothing the
 *  judge can check. "Page contains your wallet address" is verified before the judge ever runs. */
const isBoilerplateCriterion = (c: string): boolean =>
  /wallet address|contains your wallet|is published|is live|submit the link|on paste\.rs/i.test(c) &&
  c.trim().split(/\s+/).length <= 8;

/**
 * VERIFIABILITY LINT — deterministic, OPERATOR-side steering computed at creation and surfaced
 * BEFORE funding. Not a gate: it's the operator's money and their contract — but they fund knowing
 * exactly how strong each milestone's proof is. Never shown to recipients and never derived from
 * submissions, so it cannot become a key-mining oracle (the NO-ORACLE rule is about the answer
 * key; this is about the question).
 */
export function lintDirectCampaign(input: DirectCampaignInput): string[] {
  const notes: string[] = [];
  input.milestones.forEach((m, i) => {
    const label = `Milestone ${i + 1} ("${m.title}")`;
    if (m.evidence.kind === "public_url") {
      const longest = Math.max(...m.evidence.expectedText.map((t) => t.trim().length));
      if (longest < 20) {
        notes.push(
          `${label}: the required text is short and generic — anyone can put it on a page they control. Use a phrase unique to this job, or switch to a wallet-marked artifact or an on-chain check.`,
        );
      } else {
        notes.push(
          `${label}: text-on-a-page proof — the page is the submitter's choice, so the required text must be something that could only exist if the work happened.`,
        );
      }
    }
    if (m.evidence.kind === "artifact_url" && m.evidence.allowedHosts.length === 0) {
      notes.push(
        `${label}: accepts a link on ANY site, as long as the page carries the recipient's own wallet address. That proves who made it, not where it lives — name the domain if the work must appear somewhere specific.`,
      );
    }
    if (m.evidence.kind === "artifact_url" && !m.criteria.some((c) => !isBoilerplateCriterion(c))) {
      notes.push(
        `${label}: every criterion restates the automatic check (host + wallet marker). Sage's judge can only verify what the criteria name — say what must be VISIBLE on the page itself (the translated items, the commands, the image).`,
      );
    }
    if ((m.evidence.kind === "public_url" || m.evidence.kind === "artifact_url") && m.rewardUsd >= 50) {
      notes.push(
        `${label}: pays $${m.rewardUsd} on a fetched-page proof — at this size consider adding an on-chain step, or a named recipient allowlist so only your person can claim it.`,
      );
    }
  });
  return notes;
}

/* ───────────────────────────────── deterministic compilation ───────────── */

const usdToBase = (usd: number): bigint => BigInt(Math.round(usd * 100)) * BigInt(10_000);

function slugify(title: string, index: number, taken: Set<string>): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || `milestone-${index + 1}`;
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  taken.add(key);
  return key;
}

/** Tester-facing evidence requirement — deterministic per contract kind, never model-authored. */
function evidenceRequirement(c: VerificationContract): string {
  switch (c.kind) {
    case "onchain_tx":
      return "The transaction hash (0x…) of the required on-chain action, sent from the same wallet you submit with. A block-explorer link to the transaction also works.";
    case "onchain_state":
      return "Submit from the wallet that performed the action — the resulting on-chain state is read for your wallet directly.";
    case "artifact_url": {
      const marker =
        c.markerKind === "wallet"
          ? "your submitting wallet address"
          : c.markerKind === "handle"
            ? "the handle the operator issued you"
            : "the nonce issued for your submission";
      return `A public link to the artifact you created on ${c.allowedHosts.join(" or ")}. It must visibly contain ${marker}.`;
    }
    case "public_url":
      return "The public URL where the required result is visible.";
    case "observation":
      // unreachable — the schema has no observation arm; kept for exhaustiveness.
      return "A written account of what you did.";
  }
}

function verificationMethod(c: VerificationContract): string {
  switch (c.kind) {
    case "onchain_tx":
      return "Deterministic on-chain verification: the submitted transaction is read from the chain and must match the operator's required shape, sent from the submitting wallet.";
    case "onchain_state":
      return "Deterministic on-chain read: the contract state produced by the action is checked for the submitting wallet.";
    case "artifact_url":
      return "The submitted artifact URL is fetched; it must live on the operator's allowed host and carry the submitter's own marker.";
    case "public_url":
      return "The submitted public URL is fetched and must contain the operator's required text.";
    case "observation":
      return "Judged against Sage's own observations.";
  }
}

function conditionsFor(c: VerificationContract): string[] {
  switch (c.kind) {
    case "onchain_tx":
    case "onchain_state":
      return ["Perform the on-chain action from the SAME wallet you submit with — the check is bound to your wallet."];
    case "artifact_url":
      return ["The artifact must be publicly reachable and carry your own marker."];
    default:
      return [];
  }
}

export type CompileDirectResult =
  | { ok: true; plan: MissionPlanV1; allocation: BudgetAllocation; totalBudgetBase: bigint }
  | { ok: false; error: string };

/**
 * PURE: validated operator input → a canonical, deployment-ready MissionPlanV1 (all identity
 * self-checks included via `compilePlan`). Deterministic — same input, same plan, same digests.
 */
/**
 * The one durable place a direct plan's own title lives before launch is the inspection job's goal,
 * written as "Direct <kind> campaign: <title>". Writer and parser live TOGETHER so the format can
 * never drift apart — the launchable listing and both attach doors parse it back for display.
 */
export function directGoal(kind: "grant" | "gig", title: string): string {
  return `Direct ${kind} campaign: ${title}`;
}
export function parseDirectTitle(goal: string | null | undefined): string | null {
  const m = /^Direct (?:grant|gig) campaign: /.exec(goal ?? "");
  return m ? (goal as string).slice(m[0].length) : null;
}

/** The context surface for a direct campaign: the funder's own URL when they named one, otherwise
 *  the campaign's public board — the honest answer to "where is this work defined?". */
function surfaceFor(input: DirectCampaignInput, publicCampaignId: string): string {
  return input.productUrl ?? `${siteUrl()}/c/${publicCampaignId}`;
}

export function compileDirectCampaign(input: DirectCampaignInput, publicCampaignId: string): CompileDirectResult {
  const taken = new Set<string>();
  const noun = input.kind === "grant" ? "milestone" : "deliverable";

  const candidates: CandidateMission[] = input.milestones.map((m, i) => ({
    missionKey: slugify(m.title, i, taken),
    title: m.title,
    objective: `${input.kind === "grant" ? "Milestone" : "Deliverable"}: ${m.title}`,
    instructions: m.instructions,
    targetSurface: surfaceFor(input, publicCampaignId),
    criteria: m.criteria,
    evidenceRequirements: [evidenceRequirement(m.evidence)],
    whyItMatters:
      input.whyItMatters ??
      `The operator funded this ${noun} directly — payment releases only on verified proof, with a public receipt.`,
    sources: [{ kind: "founder", ref: "goal", observation: `Defined directly by the campaign operator: ${m.title}` }],
    priority: "high",
    riskCategory: "claim_validation",
    effortMinutes: m.effortMinutes ?? 15,
    conditions: conditionsFor(m.evidence),
    rewardWeight: 5,
    maxCompletions: m.slots,
    verificationMethod: verificationMethod(m.evidence),
    confidence: 1,
    assumptions: [],
    disallowed: [],
    // Deterministic/strong contracts ARE externally provable — the honest display class.
    verifiabilityClass: "url-verifiable",
    verificationContract: m.evidence,
  }));

  const allocation: BudgetAllocation = {
    ok: true,
    reason: null,
    missions: input.milestones.map((m, i) => ({
      missionKey: candidates[i].missionKey,
      rewardBase: usdToBase(m.rewardUsd),
      maxCompletions: BigInt(m.slots),
      weight: 5,
      effortMinutes: m.effortMinutes ?? 15,
    })),
    totalBudgetBase: BigInt(0),
    allocatedBase: BigInt(0),
  };
  const total = allocation.missions.reduce((s, a) => s + a.rewardBase * a.maxCompletions, BigInt(0));
  allocation.totalBudgetBase = total;
  allocation.allocatedBase = total;

  if (total > BigInt(DIRECT_LIMITS.totalUsdMax) * BigInt(1_000_000)) {
    return { ok: false, error: `total budget exceeds $${DIRECT_LIMITS.totalUsdMax}` };
  }

  // Deterministic identity digest over the operator's exact input — the direct analogue of the
  // product-map digest (there is no inspected map; the OPERATOR'S definition is the ground truth).
  const inputDigest = createHash("sha256").update(JSON.stringify({ v: DIRECT_PLAN_VERSION, input })).digest("hex");
  const mapDigest: Hex = keccak256(stringToHex(`SAGE_DIRECT_PLAN_V1:${inputDigest}`));

  const compiled = compilePlan({
    publicCampaignId,
    productMapDigest: mapDigest,
    missions: candidates,
    allocation,
    tokenDecimals: 6,
    modelVersion: DIRECT_MODEL_LABEL,
    promptVersion: DIRECT_PLAN_VERSION,
    revision: 1,
  });
  if (!compiled.ok) return { ok: false, error: compiled.error };

  const plan: MissionPlanV1 = {
    ...compiled.plan,
    campaignKind: input.kind,
    ...(input.allowlist ? { allowlist: [...new Set(input.allowlist.map((w) => w.toLowerCase()))] } : {}),
    verifiabilityNote: `Every ${noun} in this campaign is verified against the operator's explicit contract (on-chain state, a transaction, or a public artifact) before any payment — the deterministic check runs first, and a submission that fails it is refused with the reason.`,
  };
  return { ok: true, plan, allocation, totalBudgetBase: total };
}

/* ───────────────────────────────── persistence (job + revision) ────────── */

export type CreateDirectResult =
  | { ok: true; jobId: string; publicCampaignId: string; revisionId: string; totalBudgetBase: bigint; planUrl: string; strengthNotes: string[] }
  | { ok: false; error: string };

/**
 * Compile FIRST (pure — nothing persisted on invalid input), then persist the direct campaign as a
 * ready inspection job + an approved revision 1 in the exact shapes the deploy flow consumes:
 * `loadApprovedPlan(jobId)` works immediately, so the founder lands on the existing claim → deploy →
 * fund → attach wizard with zero new deployment code. The AUTO-approval is honest: the approver IS
 * the author (the operator wrote every word), recorded through the same verify-then-approve path the
 * human approval button uses — trust nothing stored, recompute every hash.
 */
export function createDirectCampaign(input: DirectCampaignInput, founderWallet: string): CreateDirectResult {
  const publicCampaignId = `${input.kind}-${nanoid(10)}`;
  const compiled = compileDirectCampaign(input, publicCampaignId);
  if (!compiled.ok) return { ok: false, error: compiled.error };
  const { plan, allocation, totalBudgetBase } = compiled;

  const { job } = createInspectionJob({
    founderWallet,
    publicCampaignId,
    productUrl: surfaceFor(input, publicCampaignId),
    repoUrl: null,
    goal: directGoal(input.kind, input.title),
    targetUsers: "",
    totalBudgetBase,
    tokenDecimals: 6,
    planningRequestId: mintWebRequestId(),
    surface: "web",
    actor: founderWallet,
  });

  const result: LaunchResult = {
    stage: "ready",
    reason: null,
    map: null, // no inspection — the operator's definition is the ground truth
    brain: null, // no model authored anything
    allocation,
    plan,
    questions: [],
    trail: [{ stage: "ready", at: Date.now() }],
  };
  const serialized = serialize(result);
  updateInspectionJob(job.id, "ready", {
    result: serialized,
    model: DIRECT_MODEL_LABEL,
    provider: "operator",
    promptVersion: DIRECT_PLAN_VERSION,
    revision: 1,
    outputDigest: createHash("sha256").update(JSON.stringify(serialized)).digest("hex"),
  });

  const revision = createRevision({
    jobId: job.id,
    authorWallet: founderWallet,
    reason: "generated",
    plan,
    budgetBase: totalBudgetBase,
    validationOk: true,
    model: DIRECT_MODEL_LABEL,
    provider: "operator",
  });

  // Verify-then-approve — the SAME checks as the human approval route (recompute every hash, then
  // the revision-policy gate, which passes vacuously here: nothing is action-replay-required).
  const verified = verifyPlanForApproval(plan, {
    approver: founderWallet,
    model: DIRECT_MODEL_LABEL,
    provider: "operator",
    promptVersion: DIRECT_PLAN_VERSION,
  });
  if (!verified.ok) return { ok: false, error: `self-verify failed: ${verified.error}` };
  const policy = checkRevisionPolicyForApproval({
    verificationPolicy: null,
    verificationPolicyDigest: null,
    verificationPolicyRequired: false,
    planMissionPlanDigest: plan.missionPlanDigest,
  });
  if (!policy.ok) return { ok: false, error: `policy gate rejected: ${policy.reason}` };
  const approved = approveRevision(job.id, revision.revisionNumber, founderWallet, verified.approvalRecord);
  if (!approved.ok) return { ok: false, error: `approve failed: ${approved.reason}` };

  return {
    ok: true,
    jobId: job.id,
    publicCampaignId,
    revisionId: revision.id,
    totalBudgetBase,
    planUrl: `/launch/${job.id}`,
    strengthNotes: lintDirectCampaign(input),
  };
}
