import { NextResponse } from "next/server";

import { getFounderAddress } from "@/lib/auth/founder";
import { listInspectionJobs } from "@/lib/db/inspection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * THE SIGNED-IN FOUNDER'S OWN INSPECTIONS, FROM THE SERVER.
 *
 * "Your inspections" was read from localStorage, which made it two things it should not be: tied
 * to a BROWSER rather than to a person, and blind to the server's own record. A founder who
 * inspected on a laptop and came back on a phone saw nothing, though every job was sitting in the
 * database under their wallet; and a second wallet signing in on a shared browser saw the first
 * one's product URLs.
 *
 * Keyed by the founder, so it follows the wallet and stops at its edge.
 */
export async function GET(): Promise<NextResponse> {
  const founder = await getFounderAddress();
  if (!founder) return NextResponse.json({ ok: true, jobs: [] });

  const jobs = listInspectionJobs(founder).slice(0, 12).map((j) => ({
    id: j.id,
    productUrl: j.productUrl,
    status: j.status,
    createdAt: j.createdAt,
  }));
  return NextResponse.json({ ok: true, jobs });
}
