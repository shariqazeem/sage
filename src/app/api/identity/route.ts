import { NextResponse, type NextRequest } from "next/server";
import { getSessionAddress } from "@/lib/auth/session";
import { getStarknetSessionAddress } from "@/lib/auth/starknet-session";
import { identityFor, recordIdentityProof } from "@/lib/db/identity";
import { identityTiersArmed, standingOf } from "@/lib/identity/standing";
import { meetsTier, requiredTier } from "@/lib/identity/tier";
import { identityDoorArmed } from "@/lib/identity/door";
import { isPublicWork } from "@/lib/campaigns/visibility";
import { getCampaign } from "@/lib/db/campaigns";
import { signalMatches, verifyWorldId, worldIdConfig } from "@/lib/identity/worldid";
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
  /**
   * A mission may ask what IT needs, so the board can raise the question at the mission rather than
   * making every tester read a rule. Answered from the same functions the submit door enforces with,
   * so the prompt and the gate can never disagree about who needs to verify.
   */
  const rewardRaw = Number(req.nextUrl.searchParams.get("reward"));
  const rewardBase = Number.isFinite(rewardRaw) && rewardRaw > 0 ? Math.round(rewardRaw) : null;
  const need = rewardBase === null ? null : requiredTier(rewardBase);
  /*
    THE DOOR IS ABOUT THE CAMPAIGN, NOT THE REWARD. `?campaign=` answers the question the board
    actually asks — "does this person need to verify before claiming here" — from the same predicate
    the submit route enforces with, so the prompt and the gate cannot disagree.
  */
  const campaignId = req.nextUrl.searchParams.get("campaign");
  const campaign = campaignId ? getCampaign(campaignId) : null;
  const doorArmed = identityDoorArmed() && cfg !== null;
  const requiresPersonhood = doorArmed && campaign !== null && isPublicWork(campaign) && proof === null;
  return NextResponse.json({
    available: cfg !== null,
    action: cfg?.action ?? null,
    verified: proof !== null,
    level: proof?.level ?? null,
    verifiedAt: proof?.verifiedAt ?? null,
    tier: standing.tier,
    reason: standing.reason,
    armed: identityTiersArmed(),
    doorArmed,
    requiresPersonhood,
    requiresStanding: !doorArmed && need !== null && need !== "newcomer" && identityTiersArmed(),
    meets: need === null ? true : meetsTier(standing.tier, need),
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
  const payload = body.proof && typeof body.proof === "object" ? (body.proof as Record<string, unknown>) : null;
  if (!payload) return NextResponse.json({ error: "No proof was sent." }, { status: 400 });

  /**
   * THE WALLET COMES FROM THE SESSION, NEVER FROM THE REQUEST.
   *
   * This route first read `body.wallet`, which meant anyone could bind a personhood proof to an
   * address they do not control — including someone else's. A proof of personhood that is not also
   * a proof of wallet control states nothing useful: the pair is the claim.
   *
   * The submit door already had this right (`getSessionAddress`, plus an EIP-712 claim bound to the
   * mission), so identity was the one place held to a weaker standard than the money path beside it.
   * Signing in is how a person shows the wallet is theirs; the proof is how they show they are one
   * person. Neither alone is worth recording.
   */
  const wallet = (await getSessionAddress()) ?? (await getStarknetSessionAddress());
  if (!wallet) {
    return NextResponse.json(
      { error: "Sign in with the wallet you get paid at first — a proof is only worth recording against a wallet you control." },
      { status: 401 },
    );
  }

  // Deliberately open to any signed-in wallet, including one that has never worked here: verifying
  // BEFORE the first submission is the honest order, and gating it behind a payout would mean a
  // newcomer had to take open work first and only then learn whether the paid tiers were reachable.

  // The proof must be ABOUT this wallet, not merely valid. See signalMatches for why an unbound
  // proof is a denial-of-service against the honest worker rather than a sybil bypass.
  if (!(await signalMatches(payload, wallet))) {
    return NextResponse.json(
      { error: "That proof was made for a different wallet. Verify from the wallet you are signed in with." },
      { status: 400 },
    );
  }

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
