import { NextResponse } from "next/server";

import { walletCreditSignals } from "@/lib/campaigns/credit";
import { publicRecord, publicSignals } from "@/lib/campaigns/record-privacy";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/record/<wallet> — the Verified Work Record + Sage Signals, machine-readable.
 *
 * The lender-consumable form: receipt-anchored history plus deterministic credit signals, every
 * formula published and versioned. Public read, no key required.
 *
 * v3 WITHHOLDS AMOUNTS. v2 published every payout in full — an amount per entry and a total, keyed
 * to a wallet, readable by anyone who had the address. For someone whose testing or gig income is
 * a real part of what they live on, that was their income statement posted permanently in public.
 * It was never a decision; it is what a record built from receipts looks like if nobody stops it.
 *
 * What a lender still gets: how many separate jobs were verified and paid, how many DIFFERENT
 * counterparties paid them, over how many months, how recently, what share of their submitted work
 * passed verification — and a transaction hash for every payment, so each one can be confirmed to
 * have happened. That is a credit profile. It is not a published income.
 *
 * Amounts are disclosed by an attestation the worker asks for, scoped to what it states and
 * revocable — unlike a pool viewing key, which reveals everything and cannot be taken back.
 *
 * This is a BREAKING change from v2, deliberately and without a compatibility flag: leaving the
 * old shape reachable would leave the income published, which is the whole thing being fixed.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ wallet: string }> },
): Promise<NextResponse> {
  const { wallet } = await ctx.params;
  const out = walletCreditSignals(wallet);
  if (!out) {
    return NextResponse.json({ ok: false, error: "not a valid wallet address" }, { status: 400 });
  }
  const { record, signals } = out;
  const pub = publicRecord(record);

  return NextResponse.json({
    ok: true,
    schema: "sage.work-record.v3",
    generatedAt: Math.floor(Date.now() / 1000),
    recordUrl: `${siteUrl()}/record/${pub.wallet}`,
    ...pub,
    entries: pub.entries.map((e) => ({ ...e, proofUrl: `${siteUrl()}${e.proofPath}` })),
    signals: publicSignals(signals, record),
    disclosure: {
      /** Why the numbers a lender might expect are not here, said in the response itself. */
      note: "Payout amounts are withheld. Each entry is anchored to a transaction anyone can verify, so the payments are provable without the income being published.",
      /** How to obtain them, when the person they belong to chooses to share them. */
      howToObtainAmounts: `${siteUrl()}/record/${pub.wallet}#disclosure`,
    },
  });
}
