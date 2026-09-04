import { NextResponse, type NextRequest } from "next/server";
import { identityFor, recordIdentityProof } from "@/lib/db/identity";
import { standingOf } from "@/lib/identity/standing";
import { verifyWorldId, worldIdConfig } from "@/lib/identity/worldid";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Is the door open, and does this wallet already have a person behind it? */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet") ?? "";
  const cfg = worldIdConfig();
  if (!/^0x[0-9a-fA-F]{20,64}$/.test(wallet)) {
    return NextResponse.json({ available: cfg !== null, action: cfg?.action ?? null, verified: false });
  }
  const proof = identityFor(wallet);
  const standing = standingOf(wallet);
  return NextResponse.json({
    available: cfg !== null,
    action: cfg?.action ?? null,
    verified: proof !== null,
    level: proof?.level ?? null,
    verifiedAt: proof?.verifiedAt ?? null,
    tier: standing.tier,
    reason: standing.reason,
  });
}

/**
 * Verify a proof and bind it to a wallet.
 *
 * Nothing the browser claims is trusted: the proof goes to the provider and only the nullifier it
 * returns is stored. If that nullifier has been seen on another wallet, the two are linked — the
 * same person cannot become two workers by verifying twice, which is the entire reason this exists.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit("auth", clientIp(req.headers)).ok) {
    return NextResponse.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });
  }
  const cfg = worldIdConfig();
  if (!cfg) return NextResponse.json({ error: "Identity verification isn't switched on here yet." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const wallet = typeof body.wallet === "string" ? body.wallet.trim() : "";
  const payload = body.proof && typeof body.proof === "object" ? (body.proof as Record<string, unknown>) : null;
  if (!/^0x[0-9a-fA-F]{20,64}$/.test(wallet)) return NextResponse.json({ error: "That doesn't look like a wallet address." }, { status: 400 });
  if (!payload) return NextResponse.json({ error: "No proof was sent." }, { status: 400 });

  // Deliberately open to any wallet, including one that has never worked here: verifying BEFORE the
  // first submission is the honest order, and gating it behind a payout would mean a newcomer had to
  // take open work first and only then find out whether the paid tiers were reachable at all.

  const outcome = await verifyWorldId(payload, cfg);
  if (!outcome.ok) return NextResponse.json({ error: outcome.reason }, { status: 400 });

  const { alsoTheirs } = recordIdentityProof({ wallet, provider: "worldid", nullifier: outcome.nullifier, level: outcome.level });
  const standing = standingOf(wallet);
  return NextResponse.json({
    ok: true,
    verified: true,
    level: outcome.level,
    tier: standing.tier,
    reason: standing.reason,
    /** stated plainly rather than hidden: the same person had already verified from these. */
    linkedWallets: alsoTheirs.length,
    message:
      alsoTheirs.length > 0
        ? `Verified — but this person has already verified from ${alsoTheirs.length} other wallet${alsoTheirs.length === 1 ? "" : "s"}, so those wallets and this one now count as one worker.`
        : "Verified. Higher-paid work is open to you now.",
  });
}
