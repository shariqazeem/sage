import "server-only";

import { nowSeconds } from "@/lib/db/keys";
import { db } from "@/lib/db";
import { programmes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getProgramme, markRoundLive, roundForJob } from "./store";

/**
 * A programme's round 1 is the job the founder launched from the card. When that launch lands, the
 * season starts: round 1 is live, the programme takes the network it launched on, and round 2 is
 * scheduled one period on. Anything else (a one-off job, a round the sweep opened) is left alone.
 */
export function activateRoundOne(jobId: string, campaignId: string, chainId: number, now = nowSeconds()): { id: string; everyDays: number; roundsTotal: number; nextRoundAt: number | null } | null {
  const round = roundForJob(jobId);
  if (!round || round.round !== 1 || round.status === "live") return null;
  const p = getProgramme(round.programmeId);
  if (!p || p.status !== "draft") return null;
  db.update(programmes).set({ chainId, updatedAt: now }).where(eq(programmes.id, p.id)).run();
  markRoundLive(p.id, 1, campaignId, now);
  const after = getProgramme(p.id)!;
  return { id: after.id, everyDays: after.everyDays, roundsTotal: after.roundsTotal, nextRoundAt: after.nextRoundAt };
}
