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
  status: "queued" | "fetching" | "analyzing" | "mapping" | "generating_missions" | "reviewing" | "ready" | "needs_input" | "failed" | "superseded";
  productUrl: string;
  goal: string;
  totalBudgetBase: string;
  tokenDecimals: number;
  pagesInspected: number;
  repoFilesInspected: number;
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

export const usd = (base: string | number) => `$${(Number(base) / 1e6).toFixed(2)}`;
export const shortHash = (h: string) => (h && h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h);
