import { NextResponse, type NextRequest } from "next/server";
import { getAddress } from "viem";
import { getSessionAddress } from "@/lib/auth/session";
import { disburseAdvance } from "@/lib/advance/disburse";
import { offerWithPot, sameWallet, selfServeTerms } from "@/lib/advance/self-serve";
import { approvalFeeWei, metisBalanceOf, potConfig, potReceipt, potSendMetis, POT_CHAIN_ID } from "@/lib/advance/pot";
import { completeFeeTopup, releaseFeeTopup, reserveFeeTopup } from "@/lib/db/advances";
import { explorerTxUrl } from "@/lib/deputy/networks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SELF-SERVE ADVANCE, ON METIS (26 Oct 2026).
 *   GET  → the offer: capacity by the published formula, capped by what the pot holds; the pot's state
 *          (open, or paused in one calm sentence); and where the borrower's one approval stands.
 *   POST { step: "fee" } → the pot covers the METIS fee of the borrower's approval, once per wallet, when
 *          the wallet holds none (a worker paid only in USDC can still approve).
 *   POST { usd? }        → take it: sent straight to the borrower's wallet, once their approval covers it.
 * Only the record's own wallet, signed in, may POST; off unless ADVANCE_SELF_SERVE=1, because it moves money.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await ctx.params;
  const offer = await offerWithPot(wallet);
  if (!offer) return NextResponse.json({ ok: false, error: "no verified work record for that wallet" }, { status: 404 });
  return NextResponse.json({ ok: true, ...offer });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ wallet: string }> }) {
  const terms = selfServeTerms();
  if (!terms.armed) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const { wallet } = await ctx.params;
  if (!sameWallet(await getSessionAddress(), wallet)) {
    return NextResponse.json({ ok: false, error: "Sign in with the wallet this record belongs to: an advance can only be taken by its owner." }, { status: 403 });
  }
  let body: { usd?: unknown; step?: unknown } = {};
  try { body = (await req.json()) as { usd?: unknown; step?: unknown }; } catch { /* an empty body takes the whole offer */ }

  const offer = await offerWithPot(wallet);
  if (!offer) return NextResponse.json({ ok: false, error: "no verified work record for that wallet" }, { status: 404 });
  if (offer.active) return NextResponse.json({ ok: false, error: "You already have an advance outstanding. It repays from your next verified payouts; a second one opens after that." }, { status: 409 });
  if (!offer.pot.open) return NextResponse.json({ ok: false, error: offer.pot.message }, { status: 503 });
  if (offer.offerUsd < 0.1) return NextResponse.json({ ok: false, error: "Nothing to advance yet: capacity is published arithmetic on verified inflow, and yours is below $0.10." }, { status: 409 });

  if (body.step === "fee") return coverApprovalFee(wallet, offer.approval?.needsFee ?? false);

  const usd = body.usd === undefined ? offer.offerUsd : Number(body.usd);
  if (!Number.isFinite(usd) || usd < 0.1) return NextResponse.json({ ok: false, error: "That amount is below $0.10." }, { status: 409 });
  if (usd > offer.offerUsd + 1e-9) return NextResponse.json({ ok: false, error: `$${usd.toFixed(2)} is above what is on offer right now ($${offer.offerUsd.toFixed(2)}).` }, { status: 409 });

  const r = await disburseAdvance({ wallet, usd, multiple: terms.multiple, waterfallBps: terms.waterfallBps });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  if ("dryRun" in r && r.dryRun) return NextResponse.json({ ok: false, error: "unexpected dry run" }, { status: 500 });
  return NextResponse.json({ ok: true, advanceId: r.advanceId, disburseTx: r.disburseTx, explorerUrl: r.explorerUrl, confirming: !!r.confirming, usd, waterfallBps: terms.waterfallBps });
}

/** Once per wallet, and only when the wallet cannot pay its own approval: the lender's cost, not a subsidy. */
async function coverApprovalFee(wallet: string, needsFee: boolean) {
  const owner = getAddress(wallet);
  if (!needsFee) return NextResponse.json({ ok: true, covered: false, reason: "The wallet can already pay its approval's fee." });
  const cfg = potConfig();
  if (!cfg.ok) return NextResponse.json({ ok: false, error: "Advances are paused while the lending pot is set up." }, { status: 503 });
  const fee = await approvalFeeWei();
  if ((await metisBalanceOf(owner)) >= fee) return NextResponse.json({ ok: true, covered: false, reason: "The wallet can already pay its approval's fee." });
  // Reserved before the send: a second request racing this one is refused here, not after both have sent.
  if (!reserveFeeTopup({ wallet: owner, chainId: POT_CHAIN_ID, amountWei: fee })) {
    return NextResponse.json({ ok: false, error: "The pot already covered this wallet's approval fee once." }, { status: 409 });
  }
  let hash;
  try {
    hash = await potSendMetis(cfg.pot, owner, fee);
  } catch (e) {
    releaseFeeTopup(owner);
    return NextResponse.json({ ok: false, error: `The fee could not be sent (${(e instanceof Error ? e.message : String(e)).slice(0, 120)}). Try again in a minute.` }, { status: 502 });
  }
  completeFeeTopup(owner, hash);
  await potReceipt(hash).catch(() => "unknown");
  return NextResponse.json({ ok: true, covered: true, tx: hash, explorerUrl: explorerTxUrl(POT_CHAIN_ID, hash) });
}
