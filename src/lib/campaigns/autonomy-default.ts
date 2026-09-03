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
  // The agent decides on every door. What guards an OPEN campaign is not a person but the
  // finalization window: the payout is approved at once and settles after a short window the
  // agent uses to watch the wallet graph (see finalization.ts). `visibility` stays a parameter so
  // the window's length can depend on it.
  void visibility;
  return "autopilot";
}
