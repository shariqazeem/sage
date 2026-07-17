import "server-only";

import { startInspection } from "@/lib/launch/start";
import { getInspectionJob, clarifyInspectionForRetry } from "@/lib/db/inspection";
import { jobToView } from "@/lib/launch/job";
import {
  getCampaign,
  listSubmissions,
  getDecisionBySubmission,
  getSubmission,
} from "@/lib/db/campaigns";
import { v2Economics } from "@/lib/campaigns/v2-economics";
import { briefFromRow } from "@/lib/deputy/decisions";
import { submissionState } from "@/lib/agent-api/views";
import { reward, networkLabel, short } from "@/lib/format";
import { explorerTxUrl } from "@/lib/deputy/networks";
import { composeProof, isFoundProof } from "@/lib/deputy/proof";
import { siteUrl } from "@/lib/site";

/**
 * The five Sage Agent operations, extracted transport-agnostic so the REST routes
 * (`/api/agent/*`) AND the MCP server (`/mcp`) run the SAME verified logic — one source of
 * truth, no drift. Each returns a plain result: `{ ok: true, ... }` on success or
 * `{ ok: false, error, status }` on failure (the caller maps `status` to an HTTP code or an
 * MCP error). NONE of these deploy, fund, sign, or settle — read + inspection-start only.
 *
 * `opStartInspection` intentionally does NOT schedule the background job; the caller runs
 * `after(() => runInspectionJob(inspectionId))` when `created` (only a request handler may
 * call `after()`), keeping this module free of request-context coupling.
 */

export interface OpErr {
  ok: false;
  error: string;
  /** HTTP status the REST transport should use; MCP treats any as a tool error. */
  status: number;
}
export type OpResult<T> = ({ ok: true } & T) | OpErr;

export interface StartInspectionBody {
  productUrl: unknown;
  repoUrl?: unknown;
  goal: unknown;
  targetUsers: unknown;
  budgetUsd: unknown;
}

export interface StartInspectionOk {
  inspectionId: string;
  created: boolean;
  statusUrl: string;
  approvalUrl: string;
  note: string;
}

/** Normalize a caller-supplied idempotency ref into a safe founder-namespace slug. Empty or
 *  junk input collapses to "shared" — identical to the web route's behavior. */
function slugRef(s: unknown): string {
  return typeof s === "string"
    ? s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "shared"
    : "shared";
}

/** Start a real, SSRF-guarded, idempotent inspection on a founder's behalf. Prepares a plan
 *  only. `clientRef` (e.g. the founder's chat id) namespaces idempotency; junk → "shared". */
export function opStartInspection(
  body: StartInspectionBody,
  clientRef: unknown,
): OpResult<StartInspectionOk> {
  const result = startInspection({
    productUrl: body.productUrl,
    repoUrl: body.repoUrl,
    goal: body.goal,
    targetUsers: body.targetUsers,
    budgetUsd: body.budgetUsd,
    founder: `clawup:${slugRef(clientRef)}`,
  });
  if (!result.ok) return { ok: false, error: result.error, status: 400 };

  const base = siteUrl();
  return {
    ok: true,
    inspectionId: result.job.id,
    created: result.created,
    statusUrl: `${base}/api/agent/inspections/${result.job.id}`,
    approvalUrl: `${base}/launch/${result.job.id}`,
    note: "Poll statusUrl until stage is 'ready'. Then give the founder approvalUrl — only their own wallet can approve, edit, and fund the campaign in the Sage web app.",
  };
}

export interface InspectionView {
  inspectionId: string;
  stage: string;
  ready: boolean;
  productUrl: string;
  pagesInspected: number;
  needsInput: string[] | null;
  failure: string | null;
  plan: {
    missionCount: number;
    /** the budget in whole USDC (human-readable) — always prefer this over the base-unit field. */
    budgetUsd: number | null;
    totalBudgetBase: string | null;
    missions: Array<{
      title: string;
      objective: string;
      /** the reward in whole USDC (human-readable). */
      rewardUsd: number | null;
      rewardBase: string;
      maxCompletions: string;
    }>;
  } | null;
  approvalUrl: string;
  approvalNote: string | null;
  /** field-test artifacts, present only when Sage actually browsed the product in a real browser. */
  fieldTest: { pages: number; screenshots: number } | null;
}

/** Poll a durable inspection: honest stage, needs-input/failure, and when ready a concise plan. */
export function opGetInspection(id: string): OpResult<InspectionView> {
  const job = getInspectionJob(id);
  if (!job) return { ok: false, error: "Inspection not found.", status: 404 };

  const v = jobToView(job);
  const ready = v.status === "ready";
  const p = v.plan as {
    missions?: Array<{
      title: string;
      objective: string;
      rewardBase: string;
      maxCompletions: string;
    }>;
    totalBudgetBase?: string;
  } | null;
  const toUsd = (base: string | null | undefined): number | null =>
    base != null && base !== "" ? Number(base) / 1_000_000 : null;
  const plan =
    ready && p && Array.isArray(p.missions)
      ? {
          missionCount: p.missions.length,
          budgetUsd: toUsd(p.totalBudgetBase),
          totalBudgetBase: p.totalBudgetBase ?? null,
          missions: p.missions.map((m) => ({
            title: m.title,
            objective: m.objective,
            rewardUsd: toUsd(m.rewardBase),
            rewardBase: m.rewardBase,
            maxCompletions: m.maxCompletions,
          })),
        }
      : null;

  // field-test artifacts ride in the persisted map (result.map.fieldTest); expose a compact count.
  const ft = (job.result as { map?: { fieldTest?: { ran?: boolean; pages?: { screenshot?: string | null }[] } | null } } | null)?.map
    ?.fieldTest ?? null;
  const fieldTest =
    ft && ft.ran && Array.isArray(ft.pages) && ft.pages.length > 0
      ? { pages: ft.pages.length, screenshots: ft.pages.filter((p) => !!p.screenshot).length }
      : null;

  return {
    ok: true,
    inspectionId: v.id,
    stage: v.status,
    ready,
    productUrl: v.productUrl,
    pagesInspected: v.pagesInspected,
    needsInput: v.status === "needs_input" ? (v.result?.questions ?? []) : null,
    failure: v.status === "failed" ? v.failureReason : null,
    plan,
    approvalUrl: `${siteUrl()}/launch/${v.id}`,
    approvalNote: ready
      ? "Send the founder approvalUrl. Only their wallet can approve, edit, and fund the campaign — the agent cannot."
      : null,
    fieldTest,
  };
}

/**
 * The founder ANSWERS a needs_input inspection: fold the answer into the goal + re-plan. The caller
 * schedules `runInspectionJob(inspectionId)` when `replanned` is true (only a request handler may).
 */
export function opAnswerInspection(id: string, answer: string): OpResult<{ inspectionId: string; replanned: boolean; note: string }> {
  const job = getInspectionJob(id);
  if (!job) return { ok: false, error: "Inspection not found.", status: 404 };
  const clean = (answer ?? "").trim();
  if (!clean) return { ok: false, error: "An answer is required.", status: 400 };
  const replanned = clarifyInspectionForRetry(id, clean);
  return {
    ok: true,
    inspectionId: id,
    replanned,
    note: replanned
      ? "Sage folded the answer into the goal and is re-planning; the founder will be messaged when the new plan is ready."
      : "This inspection is not awaiting input right now (it may already be re-planning, ready, or in flight).",
  };
}

export interface CampaignView {
  campaignId: string;
  title: string;
  status: string;
  network: string;
  chainId: number;
  isTestnet: boolean;
  token: string;
  autonomy: string;
  funded: { base: number; human: string };
  paid: { base: number; human: string };
  remaining: { base: number; human: string };
  missions: Array<{
    title: string;
    reward: string;
    paid: number;
    maxCompletions: number;
    remainingSlots: number;
    full: boolean;
  }>;
  submissions: Array<{
    submissionId: string;
    tester: string;
    mission: string;
    state: string;
    confidence: number | null;
    reason: string | null;
    payoutTx: string | null;
    explorerUrl: string | null;
    proofUrl: string | null;
  }>;
  boardUrl: string;
  consoleUrl: string;
}

/** Campaign status + recent tester activity to report: funded/paid/remaining, missions,
 *  submissions with the Deputy's decision truth + payout tx + proof link. Public-safe. */
export function opGetCampaign(id: string): OpResult<CampaignView> {
  const campaign = getCampaign(id);
  if (!campaign) return { ok: false, error: "Campaign not found.", status: 404 };
  if (campaign.vaultKind !== "campaign_v2") {
    return { ok: false, error: "Not a mission-board (V2) campaign.", status: 400 };
  }

  const e = v2Economics(campaign);
  const base = siteUrl();
  const titleByHash = new Map(e.missions.map((m) => [m.missionIdHash, m.title]));

  const submissions = listSubmissions(campaign.id)
    .sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt))
    .slice(0, 25)
    .map((s) => {
      const decision = getDecisionBySubmission(s.id);
      const brief = decision ? briefFromRow(decision) : null;
      const state = submissionState(s, brief);
      return {
        submissionId: s.id,
        tester: short(s.wallet),
        mission: titleByHash.get(s.missionIdHash ?? "") ?? "Mission",
        state,
        confidence: brief?.confidence ?? null,
        reason: brief?.reasonCode ?? null,
        payoutTx: state === "paid" ? s.payoutTx : null,
        explorerUrl: state === "paid" && s.payoutTx ? explorerTxUrl(e.chainId, s.payoutTx) : null,
        proofUrl: state === "paid" && s.payoutTx ? `${base}/proof/${s.payoutTx}` : null,
      };
    });

  return {
    ok: true,
    campaignId: campaign.id,
    title: campaign.title,
    status: campaign.status,
    network: networkLabel(e.chainId),
    chainId: e.chainId,
    isTestnet: e.isTestnet,
    token: e.tokenSymbol,
    autonomy: campaign.autonomy,
    funded: { base: e.totalFundedBase, human: reward(e.totalFundedBase, e.chainId) },
    paid: { base: e.paidBase, human: reward(e.paidBase, e.chainId) },
    remaining: { base: e.remainingBase, human: reward(e.remainingBase, e.chainId) },
    missions: e.missions.map((m) => ({
      title: m.title,
      reward: reward(m.rewardBase, e.chainId),
      paid: m.paid,
      maxCompletions: m.maxCompletions,
      remainingSlots: m.remainingSlots,
      full: m.full,
    })),
    submissions,
    boardUrl: `${base}/c/${campaign.id}`,
    consoleUrl: `${base}/campaign/${campaign.id}`,
  };
}

export interface SubmissionView {
  submissionId: string;
  campaignId: string;
  state: string;
  confidence: number | null;
  reason: string | null;
  payoutTx: string | null;
  proofUrl: string | null;
}

/** One submission's status: reviewing/verified/held/paid, confidence, reason, proof once paid. */
export function opGetSubmission(id: string): OpResult<SubmissionView> {
  const sub = getSubmission(id);
  if (!sub) return { ok: false, error: "Submission not found.", status: 404 };

  const decision = getDecisionBySubmission(id);
  const brief = decision ? briefFromRow(decision) : null;
  const state = submissionState(sub, brief);
  const base = siteUrl();

  return {
    ok: true,
    submissionId: id,
    campaignId: sub.campaignId,
    state,
    confidence: brief?.confidence ?? null,
    reason: brief?.reasonCode ?? null,
    payoutTx: state === "paid" ? sub.payoutTx : null,
    proofUrl: state === "paid" && sub.payoutTx ? `${base}/proof/${sub.payoutTx}` : null,
  };
}

export interface ProofView {
  txHash: string;
  state: string;
  settled: boolean;
  verified: boolean;
  outcome: string;
  network: string;
  chainId: number;
  recipient: string;
  explorerUrl: string;
  proofUrl: string;
}

/** The canonical verified-proof summary for a payout tx. `verified` is recomputed on-chain. */
export async function opGetProof(tx: string): Promise<OpResult<ProofView>> {
  const txHash = tx.replace(/\.json$/i, "");
  const proof = await composeProof(txHash);
  if (!isFoundProof(proof)) {
    return { ok: false, error: "Proof not found.", status: 404 };
  }

  const verified = proof.v2?.integrity.verified ?? proof.commitment?.matches ?? false;
  return {
    ok: true,
    txHash,
    state: proof.state,
    settled: proof.settled,
    verified,
    outcome: proof.human.outcome,
    network: proof.human.network,
    chainId: proof.chain.chainId,
    recipient: proof.human.recipient,
    explorerUrl: proof.chain.explorerUrl,
    proofUrl: `${siteUrl()}/proof/${txHash}`,
  };
}
