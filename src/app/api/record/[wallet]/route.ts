import { NextResponse } from "next/server";

import { buildWalletRecord } from "@/lib/campaigns/record";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/record/<wallet> — the Verified Work Record, machine-readable (move 3).
 * The consumable form of /record/<wallet> for programs, funders, or lenders: same composition,
 * every entry carrying its on-chain receipt. Public read; contains only what the public pages
 * already show.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ wallet: string }> }): Promise<NextResponse> {
  const { wallet } = await ctx.params;
  const record = buildWalletRecord(wallet);
  if (!record) return NextResponse.json({ ok: false, error: "not a valid wallet address" }, { status: 400 });
  return NextResponse.json({
    ok: true,
    schema: "sage.work-record.v1",
    generatedAt: Math.floor(Date.now() / 1000),
    recordUrl: `${siteUrl()}/record/${record.wallet}`,
    ...record,
    entries: record.entries.map((e) => ({ ...e, proofUrl: `${siteUrl()}${e.proofPath}` })),
  });
}
