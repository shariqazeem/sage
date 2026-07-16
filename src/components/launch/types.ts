/** Client-side view types for the serialized MissionPlanV1 (bigints as strings). */

export interface MissionView {
  missionKey: string;
  title: string;
  objective: string;
  instructions: string;
  targetSurface: string;
  criteria: string[];
  evidenceRequirements: string[];
  whyItMatters: string;
  verificationMethod: string;
  sources: { kind: string; ref: string }[];
  riskCategory: string;
  priority: string;
  effortMinutes: number;
  rewardBase: string;
  maxCompletions: string;
  missionIdHash: string;
  specDigest: string;
}

export interface PlanView {
  publicCampaignId: string;
  campaignIdHash: string;
  missionPlanDigest: string;
  missions: MissionView[];
  totalBudgetBase: string;
  allocatedBase: string;
  tokenDecimals: number;
  revision: number;
}

export interface JobView {
  id: string;
  status: "queued" | "fetching" | "field_test" | "analyzing" | "mapping" | "generating_missions" | "reviewing" | "ready" | "needs_input" | "failed" | "superseded";
  productUrl: string;
  goal: string;
  totalBudgetBase: string;
  tokenDecimals: number;
  pagesInspected: number;
  repoFilesInspected: number;
  /** whether the Field Test browser stage applies to this run (server flag). */
  fieldTestStage: boolean;
  model: string | null;
  provider: string | null;
  failureReason: string | null;
  result: { map: unknown; questions: string[]; reason: string | null } | null;
  plan: PlanView | null;
  revision: number;
  approval: { approvedAt: number; revision: number; campaignIdHash: string; missionPlanDigest: string } | null;
  createdAt: number;
  updatedAt: number;
}

import { reward as networkReward, isTestnetChain } from "@/lib/format";
import { DEFAULT_CHAIN_ID } from "@/lib/deputy/networks";

/**
 * Reward/budget amounts in the launch flow, network-truthful. The flow deploys on the
 * default network (Metis Sepolia testnet), whose token — test mUSDC — is a REAL on-chain
 * token with NO monetary value, so it renders "N test mUSDC" and NEVER dollars. `base` is
 * token base units (6dp). Delegates to the canonical formatter so testnet/mainnet stays one
 * truth. (Mainnet USDC would render "$N".)
 */
export const reward = (base: string | number, chainId: number = DEFAULT_CHAIN_ID) =>
  networkReward(Number(base), chainId);

/** The token unit label for an already-humanized amount (testnet → "test mUSDC"). */
export const launchToken = (chainId: number = DEFAULT_CHAIN_ID) =>
  isTestnetChain(chainId) ? "test mUSDC" : "USDC";

export const shortHash = (h: string) => (h && h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h);
