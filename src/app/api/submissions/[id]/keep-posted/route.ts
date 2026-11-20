import { NextResponse, type NextRequest } from "next/server";
import { getSessionAddress } from "@/lib/auth/session";
import { getStarknetSessionAddress } from "@/lib/auth/starknet-session";
import { sameFounder } from "@/lib/auth/founder";
import { resolvePrivyContacts } from "@/lib/auth/privy-login";
import { getCampaign, getSubmission } from "@/lib/db/campaigns";
import type { Submission } from "@/lib/db/schema";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getKeepPosted, setKeepPosted, withdrawKeepPosted, type KeepPostedContact } from "@/lib/report/keep-posted";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * KEEP ME POSTED: a tester tells the builder whose product they tried "you may reach me here".
 *
 *   GET   → { keepPosted: { kind, contact, at } | null }
 *   POST  { share: "x" | "email" | "wallet" | "none", privyToken?: string }
 *         → { ok: true, keepPosted: { kind, contact, at } | null }
 *
 * Only the person who made the submission may call either. The contact is never typed in: a wallet
 * is the session's own, and an X handle or email is read from Privy for the caller's verified
 * sign-in (`privyToken`, their Privy access token), which must hold the wallet they are signed in
 * with. "none" withdraws. Saying the same thing twice changes nothing.
 */
const NOT_FOUND = { error: "Submission not found." };

/** The submission, and the signed-in wallet when it is the one that made it. The campaign decides which session counts. */
async function mine(id: string): Promise<{ sub: Submission; wallet: string } | { status: 401 | 404 }> {
  const sub = getSubmission(id);
  const campaign = sub ? getCampaign(sub.campaignId) : null;
  if (!sub || !campaign) return { status: 404 };
  const wallet = campaign.settlementRail === "starknet" ? await getStarknetSessionAddress() : await getSessionAddress();
  if (!wallet) return { status: 401 };
  // someone else's submission answers exactly like one that doesn't exist
  if (!sameFounder(sub.wallet, wallet)) return { status: 404 };
  return { sub, wallet };
}

const shown = (k: KeepPostedContact | null) => (k ? { kind: k.kind, contact: k.contact, at: k.at } : null);
const refuse = (status: 401 | 404) =>
  status === 401 ? NextResponse.json({ error: "Sign in to do this." }, { status }) : NextResponse.json(NOT_FOUND, { status });

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const who = await mine(id);
  if ("status" in who) return refuse(who.status);
  return NextResponse.json({ keepPosted: shown(getKeepPosted(who.sub.id)) });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rl = rateLimit("auth", clientIp(req.headers));
  if (!rl.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const { id } = await ctx.params;
  const who = await mine(id);
  if ("status" in who) return refuse(who.status);
  let body: { share?: unknown; privyToken?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { sub, wallet } = who;

  if (body.share === "none") {
    withdrawKeepPosted(sub.id);
    return NextResponse.json({ ok: true, keepPosted: null });
  }
  if (body.share === "wallet") {
    return NextResponse.json({ ok: true, keepPosted: shown(setKeepPosted({ submissionId: sub.id, campaignId: sub.campaignId, kind: "wallet", contact: wallet })) });
  }
  if (body.share !== "x" && body.share !== "email") {
    return NextResponse.json({ error: 'share must be "x", "email", "wallet" or "none".' }, { status: 400 });
  }

  const token = typeof body.privyToken === "string" ? body.privyToken.trim() : "";
  if (!token) return NextResponse.json({ error: "Your sign-in has no X handle or email to share. You can share your wallet instead.", canShare: ["wallet"] }, { status: 400 });
  const privy = await resolvePrivyContacts(token);
  if (!privy.ok) {
    if (privy.reason === "invalid_token") return NextResponse.json({ error: "That sign-in couldn't be verified. Sign in again, or share your wallet instead." }, { status: 401 });
    return NextResponse.json({ error: "Sage couldn't read your sign-in just now. Try again, or share your wallet instead.", canShare: ["wallet"] }, { status: 503 });
  }
  // the token must be the same person as the session: it holds the wallet they are signed in with
  if (!privy.wallets.some((w) => sameFounder(w, wallet))) {
    return NextResponse.json({ error: "That sign-in is a different account from the one that sent this answer." }, { status: 403 });
  }
  const contact = body.share === "x" ? (privy.x ? `@${privy.x}` : null) : privy.email;
  if (!contact) {
    const canShare = [...(privy.x ? ["x"] : []), ...(privy.email ? ["email"] : []), "wallet"];
    return NextResponse.json({ error: body.share === "x" ? "Your sign-in has no X handle." : "Your sign-in has no email.", canShare }, { status: 400 });
  }
  return NextResponse.json({ ok: true, keepPosted: shown(setKeepPosted({ submissionId: sub.id, campaignId: sub.campaignId, kind: body.share, contact })) });
}
