import { createHash } from "node:crypto";

import { z } from "zod";
import { keccak256, stringToHex, type Hex } from "viem";
import { nanoid } from "nanoid";

import { CHAINS } from "@/lib/deputy/networks";
import { formatLocal, toUsdBase, type RateQuote } from "@/lib/money/currency";
import { siteUrl } from "@/lib/site";
import { releasesOnThirdPartyDecision, THIRD_PARTY_DECISION_REFUSAL } from "./third-party-decision";
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
/**
 * A RECIPIENT MAY BE ON EITHER RAIL.
 *
 * `walletRe` is an EVM address and stays that way — it also types `to` and `logEmitter` on an
 * on-chain_tx contract, which really are EVM-only. But the ALLOWLIST names people, and a Starknet
 * felt is up to 64 hex digits, so "pay my designer, her wallet is 0x04f1…f434" was refused as
 * malformed on the rail Sage just launched. Measured by P-DIRECT, pd-gig-named-recipient,
 * 2026-08-31.
 */
const recipientRe = /^0x[0-9a-fA-F]{1,64}$/;
const hex32Re = /^0x[0-9a-fA-F]{64}$/;
const selectorRe = /^0x[0-9a-fA-F]{8}$/;
const decimalRe = /^[0-9]{1,30}$/;
const hostRe = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * On-chain verification reads EVM logs and calls EVM contracts, so the chain has to be one viem can
 * reach. The registry also holds Starknet — there so that amounts, labels and explorer links are
 * truthful for campaigns settled on it — and accepting it here would compile a milestone whose
 * verification can never run: a contract that looks valid and refuses every submission.
 */
export const chainIdKnown = (id: number) => !!CHAINS[id]?.evm;

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
    /**
     * The one constraint a founder paying for a DEPLOYMENT can actually state: the other four all
     * name something that already exists, and the contract being paid for does not exist yet. See
     * the field's note in verify/contract.ts — measured on pd-grant-mixed-evidence-kinds, where a
     * two-tranche grant failed to compile at all because its on-chain half was inexpressible.
     */
    deploysContract: z.boolean().optional(),
  })
  .refine(
    (c) => !!(c.to || c.methodSelector || c.logTopic0 || c.minValueWei || c.deploysContract),
    "an on-chain tx contract needs at least one of: to, methodSelector, logTopic0, minValueWei, deploysContract",
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
  minWords: z.number().int().min(20).max(5000).optional(),
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
  /**
   * The amount the FOUNDER SAID, in the campaign's currency — "J$5,000", not its dollar value.
   *
   * The model passes what it heard and never converts: "no model ever computes a money amount" is
   * the invariant this product is built on, and an exchange rate is exactly the kind of arithmetic
   * that looks harmless and mis-sizes someone's grant. Sage converts deterministically from a
   * stamped rate, and the result lands in `rewardUsd` below.
   */
  rewardLocal: z.number().positive().max(10_000_000).optional(),
  /**
   * Optional ONLY so a founder's stated TOTAL can drive an equal split — see
   * `splitTotalUsd` on the campaign, which is the only thing that makes omitting this legal.
   */
  rewardUsd: z
    .optional(z.number()
    .positive()
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "at most 2 decimals")
    .refine((v) => v >= DIRECT_LIMITS.rewardUsdMin, `at least $${DIRECT_LIMITS.rewardUsdMin} per completion`)
    .refine((v) => v <= DIRECT_LIMITS.rewardUsdMax, `at most $${DIRECT_LIMITS.rewardUsdMax} per completion`)),
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
  allowlist: z.array(z.string().regex(recipientRe)).min(1).max(DIRECT_LIMITS.allowlistMax).optional(),
  /** `unlisted` keeps the campaign off every public board; the founder shares its door. */
  visibility: z.enum(["listed", "unlisted"]).optional(),
  /**
   * The currency the founder is THINKING in. Settlement is always USDC — this changes what the
   * numbers are called, never what the vault moves. Absent means USD, which is what every existing
   * campaign is, so this is additive by construction.
   */
  currency: z.string().length(3).optional(),
  /**
   * THE FOUNDER'S STATED TOTAL, when they priced the whole thing instead of each tranche.
   *
   * "half when she publishes her catalogue and half when she posts her first review, $40 total"
   * states everything — and produced no campaign at all. The schema demanded a per-milestone
   * amount, the prompt forbids the model from computing one ("NEVER invent or compute amounts"),
   * and its escape hatch is to ask. So it asked, `missedMoneyAction` saw a reply ending in a
   * question and suppressed the corrective round, and the founder got a question instead of a
   * grant. Measured by P-DIRECT 2026-08-31, the ONLY routing failure in that run.
   *
   * The model still computes nothing: it passes the total the founder said, and Sage divides it
   * in exact base units. Same bargain as `rewardLocal` — the model reports, Sage does the arithmetic.
   */
  splitTotalUsd: z.number().positive().max(DIRECT_LIMITS.totalUsdMax).optional(),
  /**
   * The same stated total, IN THE FOUNDER'S CURRENCY. "J$10,000 in two equal parts" is a whole-
   * grant price exactly like "$40 total" — and capping the verbatim number against the USD limit
   * locked those founders out (measured: pd-grant-currency-tranches, splitTotalUsd 10000 refused
   * as > 5000). The model passes what it heard; Sage converts at the stamped rate, THEN divides.
   * Same bargain as `rewardLocal`, same reason it exists.
   */
  splitTotalLocal: z.number().positive().max(10_000_000).optional(),
}).superRefine((c, ctx) => {
  // Priced means priced — in USD or in the founder's own currency. Counting only rewardUsd made
  // a J$-per-tranche gig read as unpriced and refused, which is the dollar hiding the track's own
  // denominations.
  const priced = c.milestones.filter((m) => m.rewardUsd !== undefined || m.rewardLocal !== undefined).length;
  const all = c.milestones.length;
  if (
    c.milestones.some((m) => m.rewardLocal !== undefined) &&
    (!c.currency || c.currency.toUpperCase() === "USD")
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "rewardLocal needs `currency` — a local amount with no currency is not a price" });
    return;
  }
  if (c.splitTotalUsd !== undefined && c.splitTotalLocal !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "one stated total, in one currency — splitTotalUsd or splitTotalLocal, never both" });
    return;
  }
  if (c.splitTotalLocal !== undefined && (!c.currency || c.currency.toUpperCase() === "USD")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "splitTotalLocal needs `currency` — a local amount with no currency is not a price" });
    return;
  }
  const splitTotal = c.splitTotalUsd ?? c.splitTotalLocal;
  // MIXED IS REFUSED, not guessed. Half-priced milestones plus a total has two readings — is the
  // total the whole grant or only the unpriced part? — and picking one silently mis-sizes someone's
  // money. A founder who priced some tranches can price the rest.
  if (priced > 0 && priced < all) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "price every milestone, or none of them with splitTotalUsd" });
    return;
  }
  if (priced === all) {
    if (splitTotal !== undefined)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a stated total cannot accompany per-milestone amounts" });
    return;
  }
  if (splitTotal === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "each milestone needs rewardUsd, or the campaign needs splitTotalUsd" });
    return;
  }
  // A TRANCHE IS RELEASED ONCE. An equal split across milestones that can each pay several people
  // has no single honest reading, so that combination stays explicit rather than inferred.
  if (c.milestones.some((m) => m.slots !== 1))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "splitTotalUsd only applies when every milestone has exactly 1 slot" });
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
export function lintDirectCampaign(input: DirectCampaignInput, quote: RateQuote | null = null): string[] {
  const notes: string[] = [];
  /*
    A lint is ADVICE — it must never take a caller down. effectiveMilestoneUsd throws its honest
    "no rate" on a locally-priced plan with no quote, and that throw is correct at the money
    boundary (compile refuses loudly on the same condition), but a quote-less LINT caller crashed
    a whole battery row twice before anyone read the note. Advisory function, total by contract:
    the missing rate becomes the first note instead of an exception.
  */
  let effectiveUsd: number[];
  try {
    effectiveUsd = effectiveMilestoneUsd(input, quote);
  } catch (e) {
    return [e instanceof Error ? e.message : String(e)];
  }
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
    const payUsd = effectiveUsd[i];
    if ((m.evidence.kind === "public_url" || m.evidence.kind === "artifact_url") && payUsd >= 50) {
      notes.push(
        `${label}: pays $${payUsd} on a fetched-page proof — at this size consider adding an on-chain step, or a named recipient allowlist so only your person can claim it.`,
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
      // An EMPTY allow-list is "publish anywhere" (verifyArtifactUrl skips the host check), so
      // there is no host to name — joined blind it produced the live copy "the artifact you
      // created on ." and told the worker nothing about where their work may live.
      const where =
        c.allowedHosts.length > 0
          ? ` on ${c.allowedHosts.join(" or ")}`
          : " on any public page that stays: a blog post, a dev.to or Medium article, a GitHub gist or repo, a Notion page, or your own site (temporary paste services and sign-in-only posts don't count)";
      const floor = c.minWords ? ` It needs at least ${c.minWords} words of your own writing.` : "";
      return `A public link to the artifact you created${where}. It must visibly contain ${marker}.${floor}`;
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

/**
 * RESOLVE EVERY MILESTONE TO USD, DETERMINISTICALLY.
 *
 * The founder says "J$5,000 when the catalogue is up" and the model passes exactly that — the
 * amount and the currency, never a conversion, because no model computes a money amount here. Sage
 * converts, once, from a stamped rate, and everything downstream is dollars exactly as before.
 *
 * A campaign in USD, or one whose rate could not be fetched, resolves to `rewardUsd` untouched —
 * so every existing campaign compiles byte-identically and a corridor outage degrades to the
 * currency that always works rather than to a guess.
 */
/**
 * Divide a stated total into exact base-unit shares — the arithmetic the model is forbidden to do.
 *
 * Works in 6-decimal BASE units, never dollars, because $40/3 has no exact dollar answer and any
 * rounding in USD breaks the invariant every other part of this file is built on:
 * Σ(rewardBase × slots) === totalBudgetBase, EXACTLY. The remainder is handed out one base unit at
 * a time to the earliest milestones, so the shares differ by at most 0.000001 USDC and the sum is
 * the total by construction rather than by luck.
 */
export function splitTotalBase(totalBase: bigint, milestones: number): bigint[] {
  if (milestones <= 0) return [];
  const n = BigInt(milestones);
  const each = totalBase / n;
  const remainder = totalBase % n;
  return Array.from({ length: milestones }, (_, i) => (BigInt(i) < remainder ? each + BigInt(1) : each));
}

/**
 * What each milestone will ACTUALLY pay, in dollars, whichever way the founder priced it.
 *
 * One resolver so a gate cannot read a different number than the compiler pays. Every gate here —
 * the $50 fetched-page lint, the exact-sum check, the eval's arithmetic — is written in dollars,
 * and each one that reached for `rewardUsd` directly would silently see 0 for a split grant and
 * wave it through.
 */
/**
 * What each milestone will pay, in BASE UNITS — the only form that can be compared exactly.
 *
 * The dollar version below cannot: a split is computed in 6-decimal base units, so $100 across
 * three tranches is 33333334/33333333/33333333, and rendering that as dollars and re-deriving
 * base from cents loses 10000 base units. P-DIRECT did exactly that and reported BUDGET INVARIANT
 * BROKEN on a plan whose parts summed to the budget perfectly — a lossy CHECK, not lost money, but
 * a check that cannot add up cannot catch a real break either.
 *
 * Anything comparing against `totalBudgetBase` must use this. Dollars are for display and for the
 * gates that are themselves written in dollars.
 */
/**
 * The stated whole-grant total in BASE UNITS, converted when the founder priced locally.
 *
 * `null` when the campaign is per-milestone priced. THROWS when a local total has no usable rate —
 * pricing someone's grant on a missing quote would be inventing an exchange rate, which is the
 * arithmetic the model is forbidden and Sage refuses to guess.
 */
export function splitTotalBaseOf(
  input: Pick<DirectCampaignInput, "splitTotalUsd" | "splitTotalLocal" | "currency">,
  quote: RateQuote | null,
): bigint | null {
  if (input.splitTotalUsd !== undefined) return usdToBase(input.splitTotalUsd);
  if (input.splitTotalLocal === undefined) return null;
  if (!quote || quote.currency.toUpperCase() !== (input.currency ?? "").toUpperCase()) {
    throw new Error(
      `no rate for ${input.currency ?? "?"} — cannot price ${input.splitTotalLocal} ${input.currency ?? ""} without one`,
    );
  }
  return toUsdBase(input.splitTotalLocal, quote);
}

export function effectiveMilestoneBase(
  input: DirectCampaignInput,
  quote: RateQuote | null = null,
): bigint[] {
  const total = splitTotalBaseOf(input, quote);
  if (total !== null) return splitTotalBase(total, input.milestones.length);
  return input.milestones.map((m) => usdToBase(resolveMilestoneUsd(m, quote)));
}

export function effectiveMilestoneUsd(
  input: DirectCampaignInput,
  quote: RateQuote | null = null,
): number[] {
  const total = splitTotalBaseOf(input, quote);
  if (total !== null) {
    return splitTotalBase(total, input.milestones.length).map((b) => Number(b) / 1_000_000);
  }
  // THROUGH THE COMPILER'S OWN RESOLVER, not `m.rewardUsd` directly.
  //
  // Reading the raw field made this function disagree with the compiler for any campaign priced in
  // another currency: the compiler converts `rewardLocal` at the stamped rate, this returned the
  // unconverted number, and a gate comparing the two saw a budget that did not add up. It was
  // written to be the one place that answers "what will this pay" and quietly was not.
  return input.milestones.map((m) => resolveMilestoneUsd(m, quote));
}

export function resolveMilestoneUsd(
  m: { rewardLocal?: number; rewardUsd?: number },
  quote: RateQuote | null,
): number {
  // The FOUNDER'S currency converts first: a milestone priced in J$ with a stamped rate resolves
  // through the rate, whether or not a USD figure also rides the row. Only then fall back to USD;
  // an unpriced milestone (the split path) resolves 0 and every caller checks the split first.
  if (quote && quote.currency !== "USD" && m.rewardLocal !== undefined) {
    const base = toUsdBase(m.rewardLocal, quote);
    return Math.round(Number(base) / 10_000) / 100;
  }
  if (m.rewardUsd === undefined) return 0;
  return m.rewardUsd;
}

export function compileDirectCampaign(
  input: DirectCampaignInput,
  publicCampaignId: string,
  /** The rate stamped at funding. Omitted — or unavailable — means the campaign is priced in USD. */
  quote: RateQuote | null = null,
): CompileDirectResult {
  const taken = new Set<string>();
  const noun = input.kind === "grant" ? "milestone" : "deliverable";

  // A rule the prompt gives the model is not a rule until the compiler holds it: a milestone whose
  // wording releases money on a third party's private decision is refused here, whichever door
  // wrote it — measured on Haiku 4.5 calling the tool for "when the bank approves her loan".
  for (const m of input.milestones) {
    if (releasesOnThirdPartyDecision([m.title, m.instructions, ...m.criteria].join(". "))) {
      return { ok: false, error: `${noun} "${m.title}": ${THIRD_PARTY_DECISION_REFUSAL}` };
    }
  }

  const candidates: CandidateMission[] = input.milestones.map((m, i) => ({
    missionKey: slugify(m.title, i, taken),
    title: m.title,
    // The title became a short derived clause (2026-09-03); the objective must carry the founder's
    // full sentence, or the board says the title twice and the worker never sees the task.
    objective: `${input.kind === "grant" ? "Milestone" : "Deliverable"}: ${m.criteria[0] && m.criteria[0] !== m.title ? m.criteria[0] : m.title}`,
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

  /*
    The founder priced the grant as a whole. The schema has already refused every ambiguous shape
    (mixed pricing, a total alongside per-milestone amounts, multi-slot milestones), so reaching
    here means every milestone is unpriced and the total is the only amount anyone stated.
  */
  const locallyPriced = input.milestones.some((m) => m.rewardLocal !== undefined);
  if (locallyPriced && (!quote || quote.currency.toUpperCase() !== (input.currency ?? "").toUpperCase())) {
    return { ok: false, error: `no rate for ${input.currency ?? "?"} — cannot price amounts stated in ${input.currency ?? "that currency"} without one` };
  }
  let stated: bigint | null;
  try {
    stated = splitTotalBaseOf(input, quote);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const splitShares = stated !== null ? splitTotalBase(stated, input.milestones.length) : null;
  if (splitShares && splitShares.some((b) => b < usdToBase(DIRECT_LIMITS.rewardUsdMin))) {
    const said =
      input.splitTotalLocal !== undefined && input.currency
        ? formatLocal(input.splitTotalLocal, input.currency)
        : `$${input.splitTotalUsd}`;
    return {
      ok: false,
      error: `${said} split across ${input.milestones.length} milestones is under the $${DIRECT_LIMITS.rewardUsdMin} floor each — fund more, or use fewer milestones.`,
    };
  }

  const allocation: BudgetAllocation = {
    ok: true,
    reason: null,
    missions: input.milestones.map((m, i) => ({
      missionKey: candidates[i].missionKey,
      rewardBase: splitShares ? splitShares[i] : usdToBase(resolveMilestoneUsd(m, quote)),
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

  // KEEP WHAT THE FOUNDER TYPED. The quote converted their number into the USD base above; before
  // this the quote was discarded here and every downstream surface could only say the USD.
  const local = quote && quote.currency.toUpperCase() !== "USD" ? quote : null;
  const localTotal = local ? (input.splitTotalLocal ?? null) : null;
  const missionsWithLocal = local
    ? compiled.plan.missions.map((cm, i) => {
        const m = input.milestones[i];
        const perTranche = localTotal !== null ? Math.round((localTotal / input.milestones.length) * 100) / 100 : m?.rewardLocal;
        return perTranche !== undefined ? { ...cm, rewardLocal: perTranche } : cm;
      })
    : compiled.plan.missions;
  const plan: MissionPlanV1 = {
    ...compiled.plan,
    missions: missionsWithLocal,
    ...(local ? { denomination: { currency: local.currency.toUpperCase(), rate: local.rate, source: local.source, asOf: local.asOf, localTotal } } : {}),
    campaignKind: input.kind,
    ...(input.allowlist ? { allowlist: [...new Set(input.allowlist.map((w) => w.toLowerCase()))] } : {}),
    ...(input.visibility ? { visibility: input.visibility } : {}),
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
export function createDirectCampaign(
  input: DirectCampaignInput,
  founderWallet: string,
  /** the stamped rate when the founder priced locally — fetched by the caller, never in the core. */
  quote: RateQuote | null = null,
): CreateDirectResult {
  const publicCampaignId = `${input.kind}-${nanoid(10)}`;
  const compiled = compileDirectCampaign(input, publicCampaignId, quote);
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
    strengthNotes: lintDirectCampaign(input, quote),
  };
}
