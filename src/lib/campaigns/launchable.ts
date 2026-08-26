import { getCampaign } from "@/lib/db/campaigns";
import { listInspectionJobs } from "@/lib/db/inspection";
import { getCurrentRevision } from "@/lib/db/plan-revisions";
import { parseDirectTitle } from "@/lib/launch/direct-campaign";

/**
 * THE FOUNDER'S PLANS THAT ARE READY TO LAUNCH — approved-or-approvable, not yet live.
 *
 * Exists because a plan is NOT a campaign: until it is funded it appears in no campaign listing,
 * so anything that goes looking for it by name in "my campaigns" finds nothing and reads absence
 * as evidence. Measured live 2026-08-27 during the first real gig run: a founder said "launch it
 * with agent wallet" three times; the ready plan sat in the database each time, and the concierge
 * model answered "the gig did not launch — no campaign by that name" WITHOUT ever calling the
 * launch tool, because the campaigns listing it consulted could not see unlaunched plans.
 *
 * The fix is two-sided: the launch tool resolves the plan server-side (agent-wallet-tools), and
 * the campaigns listing itself surfaces these plans by NAME with a pointer at the launch tool —
 * so even the wrong tool tells the truth about the right one.
 */
export interface LaunchablePlan {
  inspectionId: string;
  publicCampaignId: string;
  kind: "testing" | "grant" | "gig";
  /** The campaign title for direct (grant/gig) plans; the product host for testing plans. */
  title: string;
  budgetUsd: string;
  productUrl: string;
  createdAt: number;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Newest first (listInspectionJobs orders by createdAt desc). */
export function listLaunchablePlans(founderWallet: string): LaunchablePlan[] {
  const out: LaunchablePlan[] = [];
  for (const job of listInspectionJobs(founderWallet)) {
    if (job.status !== "ready") continue;
    if (!getCurrentRevision(job.id)) continue;
    if (getCampaign(job.publicCampaignId)) continue; // already live — it IS a campaign now
    const kind = job.publicCampaignId.startsWith("grant-")
      ? "grant"
      : job.publicCampaignId.startsWith("gig-")
        ? "gig"
        : "testing";
    // Direct plans stamp their title into the job goal — parsed by the shared writer/parser pair.
    const title = parseDirectTitle(job.goal) ?? `${hostOf(job.productUrl)} testing plan`;
    out.push({
      inspectionId: job.id,
      publicCampaignId: job.publicCampaignId,
      kind,
      title,
      budgetUsd: (job.totalBudgetBase / 1_000_000).toFixed(2),
      productUrl: job.productUrl,
      createdAt: job.createdAt,
    });
  }
  return out;
}
