import "server-only";

import { observationAutopayEnabled } from "@/lib/deputy/observation-judge";
import { mainnetAutopilotEnabled } from "@/lib/env";

/** One mission's lane, as the board/economics already carry it. */
interface LaneMission {
  verifiabilityClass?: "url-verifiable" | "observation-based";
}

/**
 * P23 — does THIS campaign actually pay autonomously right now? The board headline may promise
 * "paid automatically" ONLY when this is true; otherwise it must read honestly ("Sage assesses your
 * work; the founder confirms payouts"). No surface may promise what a flag denies (the P17 standard,
 * applied to the headline). A campaign autopays only when its autonomy mode is autopilot AND every lane
 * present is armed: observation missions need OBSERVATION_AUTOPAY; mainnet url missions need
 * DEPUTY_AUTOPILOT_MAINNET (testnet url autopays regardless). Mixed campaign → the weakest lane governs.
 */
export function campaignAutopays(
  campaign: { autonomy?: string | null },
  missions: LaneMission[],
  isTestnet: boolean,
): boolean {
  if (campaign.autonomy !== "autopilot") return false;
  const hasObservation = missions.some((m) => m.verifiabilityClass === "observation-based");
  const hasUrl = missions.some((m) => m.verifiabilityClass !== "observation-based");
  if (hasObservation && !observationAutopayEnabled()) return false;
  if (hasUrl && !isTestnet && !mainnetAutopilotEnabled()) return false;
  return true;
}
