import { defaultAutonomyFor } from "@/lib/campaigns/autonomy-default";
import "server-only";

import { getAddress, type Address, type Hex } from "viem";
import { buildDeployBundle } from "@/lib/launch/deploy-plan";
import {
  buildSettings,
  defaultDailyCap,
  loadApprovedPlan,
  DEFAULT_DURATION_SECONDS,
} from "@/lib/launch/deployment-service";
import { getInspectionJob } from "@/lib/db/inspection";
import { attachV2Campaign, type V2MissionSetupInput } from "@/lib/campaigns/v2-setup";
import { attachApprovedPolicyToCampaign } from "@/lib/campaigns/attach-policy";
import { getAgentWallet } from "@/lib/db/agent-wallets";
import { executeSequenceViaPrivy } from "./executor";
import { distillPrivateKey } from "@/lib/deputy/observation-verify";
import { explorationCounts } from "@/lib/launch/field-test";
import { classifyVerifiability } from "@/lib/launch/validate-mission";
import { stateDigest } from "@/lib/launch/observed-facts";
import { parseDirectTitle } from "@/lib/launch/direct-campaign";

/**
 * Deploy a whole campaign ENTIRELY from the agent's chat turn, then record it — the founder never
 * signs in a browser. It builds the EXACT same create → approve → fund → activate bundle the web
 * app uses (`deploy-plan.ts`, unchanged), with `owner = the founder's Privy wallet`, signs +
 * broadcasts each step through Privy inside the mandate, then re-verifies the vault against the
 * plan and atomically attaches the campaign (`attachV2Campaign`, the same path the web app uses —
 * which independently checks the on-chain vault matches the approved plan before persisting).
 *
 * The result is a founder-address-owned, funded, Deputy-operated campaign — on-chain and in the DB
 * identical to a web-app deploy, and now on autopilot so the Deputy pays verified testers itself.
 */

export interface DeployRunResult {
  vault: Address;
  ownerWallet: Address;
  campaignId: string;
  steps: Array<{ step: string; txHash: Hex; explorerUrl: string }>;
}

function campaignTitle(productUrl: string): string {
  try {
    return `Testing campaign · ${new URL(productUrl).host}`;
  } catch {
    return "Sage testing campaign";
  }
}

export async function deployCampaignViaPrivy(chatId: string, jobId: string): Promise<DeployRunResult> {
  const wallet = getAgentWallet(chatId);
  if (!wallet) throw new Error("no agent wallet is bound to this chat — onboard first");

  const loaded = loadApprovedPlan(jobId);
  if (!loaded) throw new Error("this inspection has no approved plan to deploy");

  const owner = getAddress(wallet.privyWalletAddress);
  const settingsRes = buildSettings(
    loaded.plan,
    {
      owner, // the Privy wallet OWNS the vault (msg.sender), like the founder's browser wallet does
      guardian: getAddress(wallet.founderAddress), // the founder's real (SIWE) wallet is the guardian
      dailyVelocityCapBase: defaultDailyCap(loaded.plan),
      durationSeconds: DEFAULT_DURATION_SECONDS,
    },
    wallet.chainId,
  );
  if (!settingsRes.ok) throw new Error(`deploy settings invalid: ${settingsRes.errors.join(", ")}`);
  const settings = settingsRes.settings;

  /**
   * THE LAUNCH FEE — opened here, paid by the founder as the bundle's last call.
   *
   * Opening an x402 order (rather than transferring straight to our address) is what puts the
   * payment in the GOAT Flow merchant dashboard with an amount and a payer. `openCampaignFeeOrder`
   * returns null whenever the rail is unconfigured or unreachable, and that path is deliberately
   * silent: our billing being down must never cost a founder their launch, so the bundle simply
   * builds without a fee call, exactly as it did before this existed.
   */
  // Defensive conversion: an absent or unparseable budget means NO fee, never a thrown launch. The
  // deploy is the founder's, and a billing detail must not be able to take it down.
  const budgetBase = (() => {
    try {
      return BigInt(loaded.plan.totalBudgetBase ?? 0);
    } catch {
      return BigInt(0);
    }
  })();
  // No launch fee. Sage earns on what it settles (the flat operator fee over x402) and on advances —
  // a 10% founder-side charge existed here behind an env switch and appeared in no document; it
  // was deleted 2026-09-05 so the business model reads exactly as the ledger shows.
  const bundle = buildDeployBundle(loaded.plan, settings);
  const coreCalls = bundle.calls;
  const results = await executeSequenceViaPrivy(
    wallet.privyWalletId,
    owner,
    coreCalls.map((c) => ({ to: c.to, data: c.data, label: c.step })),
    wallet.chainId,
  );


  // Record the campaign — the SAME atomic attach the web app uses, which re-reads the on-chain
  // vault and fails closed unless it matches the approved plan. Deps `{}` = the real adapter.
  const job = getInspectionJob(jobId);
  // THE PAYOUT GATE'S CONTRACT — byte-for-byte with the web attach route: the grounding shadow's
  // criterion evidence translated into pinned-key source ids. Direct plans have no shadow → empty,
  // exactly like the web.
  const shadowEvidence =
    (
      job?.result as
        | { brain?: { groundingShadow?: { criterionEvidence?: { missionKey: string; criterionIndex: number; stateIds: string[] }[] } } }
        | undefined
    )?.brain?.groundingShadow?.criterionEvidence ?? [];
  const ftForIndex =
    (job?.result as { map?: { fieldTest?: import("@/lib/launch/schemas").FieldTestSummary | null } } | undefined)?.map
      ?.fieldTest ?? null;
  const sourceByStateId = new Map<string, string>();
  (ftForIndex?.states ?? []).forEach((st, i) => sourceByStateId.set(stateDigest(st), `state:${i}`));
  const evidenceByMission = new Map<string, { criterionIndex: number; keySources: string[] }[]>();
  for (const e of shadowEvidence) {
    const keySources = [
      ...new Set(e.stateIds.map((sid) => sourceByStateId.get(sid)).filter((s): s is string => !!s)),
    ];
    const list = evidenceByMission.get(e.missionKey) ?? [];
    list.push({ criterionIndex: e.criterionIndex, keySources });
    evidenceByMission.set(e.missionKey, list);
  }
  const missions: V2MissionSetupInput[] = loaded.plan.missions.map((m) => ({
    criterionEvidence: evidenceByMission.get(m.missionKey),
    missionKey: m.missionKey,
    title: m.title,
    objective: m.objective,
    instructions: m.instructions,
    targetSurface: m.targetSurface,
    criteria: m.criteria,
    evidenceRequirements: m.evidenceRequirements,
    // MEASURED live 2026-08-27, first real Telegram gig launch: this mapping dropped the class AND
    // the operator contract, so v2-setup's safe defaults ("observation-based", null) landed in the
    // DB — the gig's missions rendered as observation work, the submit route stored evidence_url
    // NULL, and the AI worker's real deliverable page could not verify (held at 0%). The web door
    // carried both all along: two doors, different guarantees — the exact divergence class the
    // corpus-pinning fix below documents. An explicit operator contract outranks the prose
    // classifier (same rule as the decision routing); model-authored missions recompute the class
    // exactly like the web route.
    verifiabilityClass: m.verificationContract
      ? "url-verifiable"
      : classifyVerifiability({ objective: m.objective, criteria: m.criteria, evidenceRequirements: m.evidenceRequirements }),
    verificationContract: m.verificationContract,
    rewardBase: BigInt(m.rewardBase),
    maxCompletions: BigInt(m.maxCompletions),
  }));
  /**
   * PIN THE PRIVATE ANSWER KEY — the walletless door was launching campaigns with NO corpus.
   *
   * The web attach route has always distilled the field test into the pinned key the observation
   * judge verifies testers against; this path never did, so a campaign launched from Telegram
   * carried privateCorpusSources = 0 — its observation missions could never clear the judging bar
   * and the marketplace filter (rightly) hid them from the board. The two doors sold the same
   * product with different guarantees, which is exactly the inconsistency the founder told us to
   * kill. Same distiller, same public-string parrot exclusion, same exploration counts, byte for
   * byte with the web route — including the doc-derived sources that make GATED missions judgeable.
   */
  const ftForKey =
    (job?.result as { map?: { fieldTest?: import("@/lib/launch/schemas").FieldTestSummary | null } } | undefined)
      ?.map?.fieldTest ?? null;
  const publicStrings = loaded.plan.missions.flatMap((m) => [
    m.title,
    m.objective,
    m.instructions,
    m.targetSurface,
    ...(m.criteria ?? []),
    ...(m.evidenceRequirements ?? []),
    ...((m as { whyItMatters?: string }).whyItMatters ? [(m as { whyItMatters?: string }).whyItMatters as string] : []),
  ]);
  const privateKey = distillPrivateKey(ftForKey, publicStrings);
  const explored = explorationCounts(ftForKey);

  const attach = await attachV2Campaign(
    {
      publicCampaignId: loaded.plan.publicCampaignId,
      privateCorpus: privateKey.observations,
      privateCorpusDigest: privateKey.digest,
      privateCorpusSources: privateKey.distinctSources,
      exploredScreens: explored.screens,
      exploredElements: explored.elements,
      // A direct campaign is titled by its OPERATOR, not by the product host — without this the
      // live gig recorded "Testing campaign · sagepays.xyz" instead of its own name.
      title: parseDirectTitle(job?.goal) ?? campaignTitle(job?.productUrl ?? ""),
      productUrl: job?.productUrl ?? "",
      chainId: settings.chainId,
      expectedToken: getAddress(settings.token),
      founderAddress: owner,
      operatorAddress: getAddress(settings.operator),
      guardian: getAddress(settings.guardian),
      factoryAddress: getAddress(settings.factory),
      vaultAddress: bundle.predictedVault,
      missions,
      autonomy: defaultAutonomyFor(loaded.plan.visibility),
      // WORK PROOF parity with the web attach — kind + allowlist + visibility ride the approved plan.
      // Without these a Telegram-launched gig recorded kind "testing", and an invite-only campaign
      // deployed OPEN to everyone (which, for visibility, it did until 2026-09-04).
      campaignKind: loaded.plan.campaignKind,
      denomination: loaded.plan.denomination,
      visibility: loaded.plan.visibility,
      allowlist: loaded.plan.allowlist,
    },
    {},
  );
  if (!attach.ok) {
    throw new Error(`the vault deployed + funded, but recording it failed (${attach.stage}): ${attach.errors.join(", ")}`);
  }

  // PARITY with the web deploy (attach/route.ts:159) — the approved revision's VerificationPolicyV2 MUST bind to
  // the new campaign, fail-closed, so a covenant-required (canary/action-replay) plan launched walletlessly gets
  // the SAME frozen/reproduced-permit covenant the SIWE web path enforces. A non-required (legacy) revision is a
  // legitimate no-op. Without this, the campaign row keeps verificationPolicyRequired=false and settlement would
  // silently pay under legacy rules — the exact Telegram↔web divergence this closes.
  const policyAttach = attachApprovedPolicyToCampaign(attach.campaignId, jobId);
  if (!policyAttach.ok) {
    throw new Error(`the vault deployed + funded, but the verification covenant could not attach (${policyAttach.reason}) — retry recording`);
  }

  return {
    vault: bundle.predictedVault,
    ownerWallet: owner,
    campaignId: attach.campaignId,
    // the CORE calls only — the fee runs separately and its outcome lives on the campaign_fees row
    steps: coreCalls.map((c, i) => ({ step: c.step, txHash: results[i].txHash, explorerUrl: results[i].explorerUrl })),
  };
}
