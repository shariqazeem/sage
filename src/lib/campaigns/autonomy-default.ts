import type { CampaignVisibility } from "@/lib/db/schema";

/**
 * WHO DECIDES THE PAYOUT, BY DEFAULT.
 *
 * Members-only work (unlisted, the workspace's own people) autopays: Sage verifies and the vault
 * releases inside its limits. Work opened to the public board defaults to the team deciding: Sage
 * still runs every check — the brief, the deterministic gates, copies, wallet clusters, author-
 * account age, pace — and then a person releases each payout with Sage's assessment beside it.
 * The founder can flip either in the deploy step; this is the starting position, not a cage.
 */
export function defaultAutonomyFor(visibility: CampaignVisibility | null | undefined): "manual" | "autopilot" {
  return visibility === "unlisted" ? "autopilot" : "manual";
}
