import { NextResponse } from "next/server";
import { attestationChallenge } from "@/lib/verify/attestation-challenge";
import { verifyMessage } from "viem";

import {
  buildAttestation,
  signAttestation,
  DEFAULT_TTL_SECONDS,
} from "@/lib/campaigns/attestation";
import { walletCreditSignals } from "@/lib/campaigns/credit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/record/<wallet>/attest — issue a signed earnings attestation.
 *
 * THIS ENDPOINT IS AUTHENTICATED, AND THAT IS NOT OPTIONAL POLISH.
 *
 * The attestation answers "did this wallet earn at least $X". Left open, that is a BINARY SEARCH
 * ORACLE: ask about $500, then $250, then $375, and in about twenty requests you have reconstructed
 * the exact income the record was redacted to protect. The redaction and an open threshold endpoint
 * cannot both exist — one of them is a lie.
 *
 * It is the same failure this codebase already refuses elsewhere as the no-corpus-oracle rule: a
 * yes/no you can ask repeatedly is a readout, not an answer.
 *
 * So the floor must be signed by the wallet it describes. Only the person whose income it is can
 * ask about it, and the signature covers the FLOOR as well as the wallet — otherwise one signature
 * could be replayed across every floor and the oracle would be back.
 */

/** How stale a signed challenge may be. Short: it only has to survive one round trip. */
const CHALLENGE_MAX_AGE_SEC = 10 * 60;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ wallet: string }> },
): Promise<NextResponse> {
  const { wallet } = await ctx.params;

  let body: { earnedAtLeastUsd?: unknown; issuedAt?: unknown; signature?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "expected a JSON body" }, { status: 400 });
  }

  const floor =
    typeof body.earnedAtLeastUsd === "number" && Number.isFinite(body.earnedAtLeastUsd)
      ? body.earnedAtLeastUsd
      : null;
  const issuedAt = typeof body.issuedAt === "number" ? body.issuedAt : NaN;
  const signature = typeof body.signature === "string" ? body.signature : "";

  if (!Number.isFinite(issuedAt) || !signature.startsWith("0x")) {
    return NextResponse.json(
      { ok: false, error: "a signed challenge is required — see attestationChallenge()" },
      { status: 401 },
    );
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - issuedAt) > CHALLENGE_MAX_AGE_SEC) {
    return NextResponse.json({ ok: false, error: "challenge expired" }, { status: 401 });
  }

  // The signature covers the floor, so it cannot be replayed at a different one.
  let owns = false;
  try {
    owns = await verifyMessage({
      address: wallet.toLowerCase() as `0x${string}`,
      message: attestationChallenge(wallet, floor, issuedAt),
      signature: signature as `0x${string}`,
    });
  } catch {
    owns = false;
  }
  if (!owns) {
    return NextResponse.json(
      { ok: false, error: "only the wallet this record belongs to can request an attestation" },
      { status: 403 },
    );
  }

  const out = walletCreditSignals(wallet);
  if (!out) {
    return NextResponse.json({ ok: false, error: "not a valid wallet address" }, { status: 400 });
  }

  try {
    const unsigned = buildAttestation(out.record, out.signals, {
      earnedAtLeastUsd: floor ?? undefined,
      ttlSeconds: DEFAULT_TTL_SECONDS,
      now,
    });
    return NextResponse.json({ ok: true, attestation: await signAttestation(unsigned) });
  } catch (err) {
    // A refused floor is a 422, not a 500: the request was well formed and Sage declined to
    // make the statement. The message deliberately does not reveal the real figure.
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "could not attest" },
      { status: 422 },
    );
  }
}
