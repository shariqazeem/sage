import { NextResponse } from "next/server";
import { verifyMessage } from "viem";

import { setRecordPrivate } from "@/lib/campaigns/record-preference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/record/<wallet>/privacy — a worker turns payout amounts on or off on their own record.
 *
 * Only the wallet whose income it is may change this, so the choice is signed. Without that, anyone
 * could switch someone else's record public — which for a person who deliberately turned it off
 * would publish their income against their wishes, the exact harm the setting exists to prevent.
 *
 * The signature covers the DIRECTION as well as the wallet and the time, so a signature obtained
 * for one change cannot be replayed to make the opposite one.
 */
export function privacyChallenge(wallet: string, amountsPrivate: boolean, issuedAt: number): string {
  return [
    "Sage record privacy",
    `wallet: ${wallet.toLowerCase()}`,
    `amounts: ${amountsPrivate ? "private" : "public"}`,
    `issued: ${issuedAt}`,
  ].join("\n");
}

const CHALLENGE_MAX_AGE_SEC = 10 * 60;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ wallet: string }> },
): Promise<NextResponse> {
  const { wallet } = await ctx.params;

  let body: { amountsPrivate?: unknown; issuedAt?: unknown; signature?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "expected a JSON body" }, { status: 400 });
  }

  if (typeof body.amountsPrivate !== "boolean") {
    return NextResponse.json({ ok: false, error: "amountsPrivate must be true or false" }, { status: 400 });
  }
  const amountsPrivate = body.amountsPrivate;
  const issuedAt = typeof body.issuedAt === "number" ? body.issuedAt : NaN;
  const signature = typeof body.signature === "string" ? body.signature : "";

  if (!Number.isFinite(issuedAt) || !signature.startsWith("0x")) {
    return NextResponse.json({ ok: false, error: "a signed challenge is required" }, { status: 401 });
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - issuedAt) > CHALLENGE_MAX_AGE_SEC) {
    return NextResponse.json({ ok: false, error: "challenge expired" }, { status: 401 });
  }

  let owns = false;
  try {
    owns = await verifyMessage({
      address: wallet.toLowerCase() as `0x${string}`,
      message: privacyChallenge(wallet, amountsPrivate, issuedAt),
      signature: signature as `0x${string}`,
    });
  } catch {
    owns = false;
  }
  if (!owns) {
    return NextResponse.json(
      { ok: false, error: "only the wallet this record belongs to can change this" },
      { status: 403 },
    );
  }

  setRecordPrivate(wallet, amountsPrivate);
  return NextResponse.json({ ok: true, wallet: wallet.toLowerCase(), amountsPrivate });
}
