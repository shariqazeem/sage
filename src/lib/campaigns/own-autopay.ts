import type { CampaignEvent } from "@/lib/db/schema";
import { decodeDetail } from "@/lib/campaigns/journal";

export type OwnAutopay = { state: "settled" | "held"; reason: string | null };

/**
 * What the autopilot did with ONE submission, read off the campaign journal: settled, or held and why.
 * The first matching event wins (the journal is written newest-first by the reader we get it from).
 *
 * Shared by the worker's /me and the founder's console on purpose. The console used to derive a
 * row's state from the decision brief alone, so a submission the judge approved and the copy gate
 * then HELD ("near-identical artifact to another submission") showed the founder "Verified ·
 * settling" — for as long as it sat there. The hold was recorded, in this event, all along.
 */
export function autopayForSubmission(events: readonly CampaignEvent[], submissionId: string): OwnAutopay | null {
  for (const e of events) {
    if (e.submissionId !== submissionId) continue;
    if (e.kind !== "autopay_settled" && e.kind !== "autopay_held") continue;
    const text = decodeDetail(e.detail).text ?? "";
    const parts = text.split(" · ");
    return {
      state: e.kind === "autopay_settled" ? "settled" : "held",
      reason: e.kind === "autopay_held" ? (parts.length > 1 ? parts.slice(1).join(" · ") : text) : null,
    };
  }
  return null;
}
