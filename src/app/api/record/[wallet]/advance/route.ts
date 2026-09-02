import { NextResponse, type NextRequest } from "next/server";
import { getSessionAddress } from "@/lib/auth/session";
import { getStarknetSessionAddress } from "@/lib/auth/starknet-session";
import { disburseAdvance } from "@/lib/advance/disburse";
import { offerFor, sameWallet, selfServeTerms } from "@/lib/advance/self-serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SELF-SERVE ADVANCE.
 *   GET  → the offer: capacity by the published formula, the operator's max and terms, any active
 *          advance. Derived from the public record; nothing secret in it.
 *   POST → take it. The caller must be signed in AS the record's wallet (either rail); the amount
 *          may not exceed the offer; the pot escrows on Starknet and the claim link comes back ONCE
 *          (bearer cash). Off unless ADVANCE_SELF_SERVE=1 — a money-moving door fails closed.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await ctx.params;
  const offer = offerFor(wallet);
  if (!offer) return NextResponse.json({ ok: false, error: "no verified work record for that wallet" }, { status: 404 });
  return NextResponse.json({ ok: true, ...offer });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ wallet: string }> }) {
  const terms = selfServeTerms();
  if (!terms.armed) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const { wallet } = await ctx.params;
  const [evm, starknet] = await Promise.all([getSessionAddress(), getStarknetSessionAddress()]);
  if (!sameWallet(evm, wallet) && !sameWallet(starknet, wallet)) {
    return NextResponse.json({ ok: false, error: "Sign in with the wallet this record belongs to — an advance can only be taken by its owner." }, { status: 403 });
  }
  const offer = offerFor(wallet);
  if (!offer) return NextResponse.json({ ok: false, error: "no verified work record for that wallet" }, { status: 404 });
  if (offer.active) return NextResponse.json({ ok: false, error: "You already have an advance outstanding — it repays from your next verified payouts; a second one opens after that." }, { status: 409 });
  let body: { usd?: unknown } = {};
  try { body = (await req.json()) as { usd?: unknown }; } catch { /* an empty body takes the whole offer */ }
  const usd = body.usd === undefined ? offer.offerUsd : Number(body.usd);
  if (!Number.isFinite(usd) || usd < 0.1) return NextResponse.json({ ok: false, error: "Nothing to advance yet — capacity is published arithmetic on verified inflow, and yours is below $0.10." }, { status: 409 });
  if (usd > offer.offerUsd + 1e-9) return NextResponse.json({ ok: false, error: `$${usd.toFixed(2)} is above what the formula allows right now ($${offer.offerUsd.toFixed(2)}).` }, { status: 409 });

  const r = await disburseAdvance({ wallet, usd, multiple: terms.multiple, waterfallBps: terms.waterfallBps, cleanupOnFailure: true });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  if ("dryRun" in r && r.dryRun) return NextResponse.json({ ok: false, error: "unexpected dry run" }, { status: 500 });
  return NextResponse.json({ ok: true, advanceId: r.advanceId, disburseTx: r.disburseTx, claimUrl: r.claimUrl, usd, waterfallBps: terms.waterfallBps });
}
