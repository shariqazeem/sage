/**
 * The autopay JUDGE POLICY-IDENTITY registry — deterministic pipeline code, never a prompt.
 *
 * An autopay is authorized ONLY when the FULL identity that produced the brief is EXPLICITLY APPROVED. The
 * identity is four parts, all stamped on the brief by callProvider:
 *   · the provider HOST that actually answered (`brief.provider`);
 *   · the ACTUAL canonical model that decided (`brief.model` — not the requested env var);
 *   · the payout PROMPT version (`brief.promptVersion` = PAYOUT_PROMPT_VERSION at decision time);
 *   · the money-path PARSER version (`brief.parserVersion` = PARSER_POLICY_VERSION at decision time).
 *
 * CANDIDATE vs APPROVED are SEPARATE. A combination present in the code / configured for production is a
 * CANDIDATE; it becomes APPROVED only through an intentional change to the registry below, after a clean,
 * CONCLUSIVE live promotion run. A new parser or prompt version therefore starts UNAPPROVED, and an
 * approved identity can never inherit approval across a prompt/parser change. Approval is code, not
 * configuration: no environment variable can bless a combination.
 *
 * The PRODUCTION approved registry is currently EMPTY — no combination has completed a conclusive live
 * promotion (the P-JUDGE / P-ENTAIL runs to date are inconclusive: gateway rate-limited). So today every
 * url-verifiable autopay safely falls to MANUAL REVIEW; deploying an unapproved identity produces review,
 * not a payout. This only ever SUBTRACTS (turns a would-pay into a review) — it cannot cause a wrong pay.
 */
import type { DecisionBrief } from "./brain-core";

/** Bump when the approved registry or its shape changes — recorded on the block journal for audit. */
export const MODEL_POLICY_VERSION = "autopay-policy-v2";

/** The four-part policy identity an autopay is approved against. */
export interface JudgeIdentity {
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  parserVersion: string | null;
}

/**
 * A production APPROVAL record. Beyond the four identity fields, it records the EVIDENCE for the approval
 * so a reviewer can audit WHY a combination may move money: which eval suite promoted it, when/at what
 * release, and a reference to the promotion report. A combination without such a record cannot autopay.
 */
export interface ApprovalRecord extends JudgeIdentity {
  provider: string;
  model: string;
  promptVersion: string;
  parserVersion: string;
  /** eval-suite version/digest that produced the conclusive promotion evidence. */
  evalSuite: string;
  /** approval date or release version. */
  approvedOn: string;
  /** reference to the promotion report / evidence artifact. */
  evidence: string;
}

/** Canonical, comparable key for an identity. Any null component yields a key no approved entry has. */
export function identityKey(id: JudgeIdentity): string {
  return `${id.provider ?? "∅"}|${id.model ?? "∅"}|${id.promptVersion ?? "∅"}|${id.parserVersion ?? "∅"}`;
}

/**
 * CANDIDATE identities — combinations present in the code / configured for production but NOT approved for
 * autopay. Documented for audit; they authorize nothing. A candidate is promoted by adding a matching
 * {@link ApprovalRecord} to PRODUCTION_APPROVED after a clean conclusive run — never automatically.
 */
export const CANDIDATE_IDENTITIES: readonly JudgeIdentity[] = [
  { provider: "api.commonstack.ai", model: "google/gemini-3.1-flash-lite-preview", promptVersion: "payout-v1", parserVersion: "payout-parse-v3" },
  { provider: "api.commonstack.ai", model: "anthropic/claude-haiku-4-5", promptVersion: "payout-v1", parserVersion: "payout-parse-v3" },
];

/**
 * The PRODUCTION approved registry — the ONLY identities that may authorize an autopay. EMPTY: no
 * (provider, model, prompt, parser) combination has completed a conclusive live promotion run and been
 * intentionally registered. payout-parse-v3 (strict money parse + explicit normal-completion termination)
 * is a CANDIDATE only. Registration here is a deliberate code change accompanied by an ApprovalRecord.
 */
const PRODUCTION_APPROVED: readonly ApprovalRecord[] = [
  // (none yet — awaiting a clean, conclusive promotion report; see docs/agentic-v2-plan.md)
];

/** Model-membership helper input: the canonical models that appear as candidates or approvals. Weaker
 *  than the identity gate (model-only) — used for messaging + the audit line, never for a payout. */
export const AUTOPAY_APPROVED_MODELS: ReadonlySet<string> = new Set<string>(
  [...CANDIDATE_IDENTITIES, ...PRODUCTION_APPROVED].map((i) => i.model).filter((m): m is string => !!m),
);

/** The production-approved identity keys. */
const PRODUCTION_APPROVED_KEYS: ReadonlySet<string> = new Set(PRODUCTION_APPROVED.map(identityKey));

/**
 * TEST-ONLY approval overlay. Never populated in production — the only callers are {@link __approveForTest}
 * / {@link __clearTestApprovals}, which no production code invokes. It lets a test inject an approved
 * identity EXPLICITLY instead of relying on a production default, so a test's "this pays" is a deliberate
 * approval it registered, not an accident of the shipped registry.
 */
const TEST_APPROVED = new Set<string>();

/** TEST-ONLY: register an approved identity for the current test (remember to clear it afterEach). */
export function __approveForTest(id: JudgeIdentity): void {
  TEST_APPROVED.add(identityKey(id));
}
/** TEST-ONLY: drop all test approvals (call in afterEach so approvals never leak between tests). */
export function __clearTestApprovals(): void {
  TEST_APPROVED.clear();
}

/** True only for a canonical model that appears in the candidate/approved registry. Weaker check. */
export function isApprovedJudgeModel(model: string | null | undefined): boolean {
  return !!model && AUTOPAY_APPROVED_MODELS.has(model);
}

/** True only when the FULL four-part identity is an EXPLICITLY approved combination (prod registry, or a
 *  test-only injected approval). No environment variable is consulted. */
export function isApprovedJudgeIdentity(id: JudgeIdentity): boolean {
  const k = identityKey(id);
  return PRODUCTION_APPROVED_KEYS.has(k) || TEST_APPROVED.has(k);
}

/** Read the policy identity off a brief (the provenance callProvider stamped). */
export function identityOf(brief: Pick<DecisionBrief, "provider" | "model" | "promptVersion" | "parserVersion">): JudgeIdentity {
  return {
    provider: brief.provider ?? null,
    model: brief.model ?? null,
    promptVersion: brief.promptVersion ?? null,
    parserVersion: brief.parserVersion ?? null,
  };
}

/**
 * The policy-identity gate, applied AFTER the autopilot gate returns pay. `gatePay` is the existing gate's
 * decision (autopilot, pending, engine llm, recommendation pay, confidence, fraud, mainnet). This adds ONE
 * conjunct: the actual judge IDENTITY must be an approved combination. Pure + deterministic; only ever
 * subtracts. `approvedModel` reports the weaker model-membership fact for the audit line.
 */
export function judgeIdentityGate(
  brief: Pick<DecisionBrief, "provider" | "model" | "promptVersion" | "parserVersion">,
  gatePay: boolean,
): { pay: boolean; blocked: "judge_identity_unapproved" | null; approvedIdentity: boolean; approvedModel: boolean } {
  const identity = identityOf(brief);
  const approvedIdentity = isApprovedJudgeIdentity(identity);
  const approvedModel = isApprovedJudgeModel(identity.model);
  if (gatePay && !approvedIdentity) return { pay: false, blocked: "judge_identity_unapproved", approvedIdentity, approvedModel };
  return { pay: gatePay, blocked: null, approvedIdentity, approvedModel };
}
