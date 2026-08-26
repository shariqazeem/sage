import { NextResponse } from "next/server";

import { walletCreditSignals } from "@/lib/campaigns/credit";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/record/<wallet> — the Verified Work Record + SAGE SIGNALS, machine-readable.
 * The lender-consumable form of /record/<wallet> (FC plan #1, the track's CORE "integrate with
 * lenders via APIs" ask): the receipt-anchored history plus deterministic credit signals, every
 * formula published and versioned (`signals.formulaVersion`). Public read; contains only what the
 * public pages already show — Sage states facts it can prove and computes no score.
 * v2 is additive over v1 (the record fields are unchanged; `signals` is new).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ wallet: string }> }): Promise<NextResponse> {
  const { wallet } = await ctx.params;
  const out = walletCreditSignals(wallet);
  if (!out) return NextResponse.json({ ok: false, error: "not a valid wallet address" }, { status: 400 });
  const { record, signals } = out;
  return NextResponse.json({
    ok: true,
    schema: "sage.work-record.v2",
    generatedAt: Math.floor(Date.now() / 1000),
    recordUrl: `${siteUrl()}/record/${record.wallet}`,
    ...record,
    entries: record.entries.map((e) => ({ ...e, proofUrl: `${siteUrl()}${e.proofPath}` })),
    signals,
  });
}
