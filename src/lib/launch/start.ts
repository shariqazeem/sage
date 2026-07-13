import "server-only";

import {
  validateEvidenceUrl,
  validateRewardUsd,
  validateText,
  validateOptionalText,
} from "@/lib/campaigns/validate";
import { createInspectionJob } from "@/lib/db/inspection";

type InspectionJob = ReturnType<typeof createInspectionJob>["job"];

export interface StartInspectionInput {
  productUrl: unknown;
  repoUrl?: unknown;
  goal: unknown;
  targetUsers: unknown;
  budgetUsd: unknown;
  /** The identity namespace that owns this inspection: a SIWE wallet, "anonymous", or
   *  "clawup:<clientRef>" for an agent-started one. The real owner is established later
   *  when the founder claims the plan at /launch/<id> with their own wallet. */
  founder: string;
}

export type StartInspectionResult =
  | { ok: true; job: InspectionJob; created: boolean }
  | { ok: false; error: string };

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "product";
}
function rand(): string {
  return Math.abs(
    Array.from(Date.now().toString(36)).reduce((a, c) => (a * 33 + c.charCodeAt(0)) | 0, 7),
  )
    .toString(36)
    .slice(0, 6);
}

/**
 * The one canonical way to start a founder-launch inspection: SSRF-guarded input
 * validation → durable, idempotent job creation (same input from the same founder returns
 * the same job). Shared by the web route (POST /api/launch) AND the authenticated Sage
 * Agent API so ClawUp and the web app run the SAME real pipeline. It NEVER deploys, funds,
 * or settles. The caller runs `runInspectionJob(job.id)` inside `after()` when `created`.
 */
export function startInspection(input: StartInspectionInput): StartInspectionResult {
  // SSRF at the door — a private/loopback/non-https product URL is rejected immediately.
  const url = validateEvidenceUrl(input.productUrl);
  if (!url.ok) return { ok: false, error: `Product URL: ${url.error}` };

  const repo = validateOptionalText(input.repoUrl, "Repository URL", 300);
  if (!repo.ok) return { ok: false, error: repo.error };
  if (repo.value && !/^https:\/\/github\.com\//i.test(repo.value)) {
    return { ok: false, error: "Repository must be a public github.com URL." };
  }

  const goal = validateText(input.goal, "Goal", { max: 1200 });
  if (!goal.ok) return { ok: false, error: goal.error };
  const targetUsers = validateText(input.targetUsers, "Target users", { max: 800 });
  if (!targetUsers.ok) return { ok: false, error: targetUsers.error };

  // budget in whole USDC → 6dp base units (capped, floored) via the shared validator.
  const budget = validateRewardUsd(input.budgetUsd);
  if (!budget.ok) return { ok: false, error: `Budget: ${budget.error}` };

  const host = (() => {
    try {
      return new URL(url.value).host;
    } catch {
      return "product";
    }
  })();

  const { job, created } = createInspectionJob({
    founderWallet: input.founder,
    publicCampaignId: `launch-${slug(host)}-${rand()}`,
    productUrl: url.value,
    repoUrl: repo.value || null,
    goal: goal.value,
    targetUsers: targetUsers.value,
    totalBudgetBase: BigInt(budget.value),
    tokenDecimals: 6,
  });
  return { ok: true, job, created };
}
