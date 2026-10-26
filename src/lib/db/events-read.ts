import "server-only";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "./index";
import { events } from "./schema";

/**
 * How many autopays this campaign made since `sinceUnix` — the pace-cap's one input. Lives apart
 * from `campaigns.ts` on purpose: the pipeline's tests replace that module with a fixed list of
 * mocked exports, and a guard that needs a new export from it fails every one of them; a guard
 * that reads the journal through its own door does not.
 *
 * An autopay is DECIDED when the agent approves it, and on open work it settles 30 minutes later
 * (finalization.ts). Counting settlements alone let a farm be approved at any pace inside the window,
 * so both moments count, once per submission: an approval and its later settlement are one autopay.
 */
export function countAutopaysSince(campaignId: string, sinceUnix: number): number {
  const rows = db
    .select({ id: events.id, submissionId: events.submissionId })
    .from(events)
    .where(and(eq(events.campaignId, campaignId), inArray(events.kind, ["autopay_settled", "autopay_approved"]), gte(events.createdAt, sinceUnix)))
    .all();
  return new Set(rows.map((r) => r.submissionId ?? `event:${r.id}`)).size;
}
