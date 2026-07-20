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
  /** P16 money gate — "observation-based" missions are founder-approved (never auto-paid). */
  verifiabilityClass?: "url-verifiable" | "observation-based";
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
  /** P23 — whether this plan's corpus supports autonomous payouts (shown before the founder funds). */
  corpusReadiness: { observation: boolean; sources: number; autonomous: boolean } | null;
  revision: number;
  approval: { approvedAt: number; revision: number; campaignIdHash: string; missionPlanDigest: string } | null;
  createdAt: number;
  updatedAt: number;
}

import { reward as networkReward, isTestnetChain } from "@/lib/format";
import { GOAT_MAINNET_CHAIN_ID } from "@/lib/deputy/networks";

/**
 * Reward/budget amounts in the launch flow, network-truthful. The launch flow is the real-money
 * GOAT-mainnet product path (the walletless flow always deploys on GOAT; the web flow lists it
 * first), so amounts render as USDC by default and a mainnet plan NEVER shows testnet "test mUSDC".
 * `base` is token base units (6dp). Delegates to the canonical formatter so testnet/mainnet stays
 * one truth; a caller on a real testnet preview passes that chainId explicitly.
 */
export const reward = (base: string | number, chainId: number = GOAT_MAINNET_CHAIN_ID) =>
  networkReward(Number(base), chainId);

/** The token unit label for an already-humanized amount (mainnet → "USDC"; testnet → "test mUSDC"). */
export const launchToken = (chainId: number = GOAT_MAINNET_CHAIN_ID) =>
  isTestnetChain(chainId) ? "test mUSDC" : "USDC";

export const shortHash = (h: string) => (h && h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h);
