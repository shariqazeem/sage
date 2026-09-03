import "server-only";
import { and, eq, gte } from "drizzle-orm";
import { db } from "./index";
import { events } from "./schema";

/**
 * How many autopays this campaign made since `sinceUnix` — the pace-cap's one input. Lives apart
 * from `campaigns.ts` on purpose: the pipeline's tests replace that module with a fixed list of
 * mocked exports, and a guard that needs a new export from it fails every one of them; a guard
 * that reads the journal through its own door does not.
 */
export function countAutopaySettledSince(campaignId: string, sinceUnix: number): number {
  return db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.campaignId, campaignId), eq(events.kind, "autopay_settled"), gte(events.createdAt, sinceUnix)))
    .all().length;
}
