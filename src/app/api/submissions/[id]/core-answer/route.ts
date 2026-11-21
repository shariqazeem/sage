import { NextResponse, type NextRequest } from "next/server";
import { getSessionAddress } from "@/lib/auth/session";
import { getStarknetSessionAddress } from "@/lib/auth/starknet-session";
import { sameFounder } from "@/lib/auth/founder";
import { coreMissionHash, getCoreAnswer, setCoreAnswer } from "@/lib/core-test/answers";
import { isAgain, isReached } from "@/lib/core-test/shape";
import { getCampaign, getSubmission } from "@/lib/db/campaigns";
import type { Submission } from "@/lib/db/schema";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * WHAT A TESTER TAPPED on a test's core mission: how far they got with the product's main action, and
 * whether they would use it again.
 *
 *   GET   → { coreAnswer: { reached, again } | null }
 *   POST  { reached: "first-screen" | "found-start" | "started" | "finished", again: "yes" | "maybe" | "no" }
 *         → { ok: true, coreAnswer: { reached, again } }
 *
 * Only the person who sent the answer may call either, and only for an answer to the core mission.
 * The taps are theirs to change until the answer is decided. Nothing here is judged or paid on: it
 * is what the builder's report counts, beside the same person's own words.
 */
const NOT_FOUND = { error: "Submission not found." };

async function mine(id: string): Promise<{ sub: Submission } | { status: 401 | 404 | 409 }> {
  const sub = getSubmission(id);
  const campaign = sub ? getCampaign(sub.campaignId) : null;
  if (!sub || !campaign) return { status: 404 };
  const wallet = campaign.settlementRail === "starknet" ? await getStarknetSessionAddress() : await getSessionAddress();
  if (!wallet) return { status: 401 };
  // someone else's submission answers exactly like one that doesn't exist
  if (!sameFounder(sub.wallet, wallet)) return { status: 404 };
  const core = coreMissionHash(campaign.id);
  if (!core || !sub.missionIdHash || sub.missionIdHash.toLowerCase() !== core.toLowerCase()) return { status: 409 };
  return { sub };
}

const refuse = (status: 401 | 404 | 409) =>
  status === 401
    ? NextResponse.json({ error: "Sign in to do this." }, { status })
    : status === 409
      ? NextResponse.json({ error: "This answer's mission has nothing to tap." }, { status })
      : NextResponse.json(NOT_FOUND, { status });

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const who = await mine(id);
  if ("status" in who) return refuse(who.status);
  const a = getCoreAnswer(who.sub.id);
  return NextResponse.json({ coreAnswer: a ? { reached: a.reached, again: a.again } : null });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rl = rateLimit("auth", clientIp(req.headers));
  if (!rl.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const { id } = await ctx.params;
  const who = await mine(id);
  if ("status" in who) return refuse(who.status);
  let body: { reached?: unknown; again?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!isReached(body.reached) || !isAgain(body.again)) return NextResponse.json({ error: "Choose how far you got and whether you would use it again." }, { status: 400 });
  // Once an answer is paid or refused, what was tapped with it is part of the record. The FIRST taps
  // are always taken: Sage can decide an answer within seconds, before this request arrives.
  const decided = who.sub.status === "paid" || who.sub.status === "rejected" || who.sub.status === "blocked";
  if (decided && getCoreAnswer(who.sub.id)) {
    return NextResponse.json({ error: "This answer has been decided, so its taps can't change." }, { status: 409 });
  }
  const saved = setCoreAnswer({ submissionId: who.sub.id, campaignId: who.sub.campaignId, reached: body.reached, again: body.again });
  return NextResponse.json({ ok: true, coreAnswer: { reached: saved.reached, again: saved.again } });
}
