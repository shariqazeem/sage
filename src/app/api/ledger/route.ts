import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { OWN_WALLETS, settledLedger } from "@/lib/campaigns/settled-ledger";
import { chainConfig } from "@/lib/deputy/networks";
import { sageNumbers } from "@/lib/numbers/sage-numbers";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ledger — EVERY PAYOUT ON REAL MONEY, MACHINE-READABLE (7 Nov 2026).
 *
 * The /ledger page as data, so Sage's numbers can be recounted by someone who does not trust Sage:
 * `scripts/recount.mjs` reads this list, opens every transaction on its own network, checks that USDC
 * left the job's vault in exactly the amount listed, and counts again. The numbers here are
 * `sageNumbers()` over the same rows, and Sage's own wallets are published, so a recount leaves out
 * exactly what Sage leaves out.
 *
 * Nothing private is here: every line is already on /ledger and on its receipt. Refusals are counted,
 * never listed with a name (the ledger's rule). Who decided each payout is Sage's record; each receipt
 * shows the decision behind it.
 */
export function GET() {
  const ledger = settledLedger();
  const numbers = sageNumbers(ledger);
  const real = ledger.filter((r) => r.mainnet);
  const ids = [...new Set(real.map((r) => r.campaignId))];
  const vaults = new Map(
    ids.length === 0
      ? []
      : db
          .select({ id: campaigns.id, vault: campaigns.vaultAddress, rail: campaigns.settlementRail })
          .from(campaigns)
          .where(inArray(campaigns.id, ids))
          .all()
          .map((c) => [c.id, c]),
  );
  const site = siteUrl();
  const body = {
    source: `${site}/ledger`,
    generatedAt: Math.floor(Date.now() / 1000),
    definitions: {
      payout: "A settlement on real money to a person. Payouts to Sage's own wallets are counted apart.",
      byAgent: "Sage judged the work and paid it on its own; the rest were released by a person.",
      people: "Wallets one person controls count once, so people can be fewer than wallets.",
      job: "A job that paid at least one person.",
      team: "Whoever funded a job, other than Sage itself.",
      grantCompleted: "A grant with every milestone paid to a person.",
      round: "One week of a weekly job that paid at least one person.",
    },
    numbers,
    ownWallets: [...OWN_WALLETS],
    payouts: real.map((r) => {
      const c = vaults.get(r.campaignId);
      return {
        network: chainConfig(r.chainId).key,
        chainId: r.chainId,
        txHash: r.txHash,
        vault: c?.vault ?? null,
        rail: c?.rail ?? "evm",
        recipient: r.wallet,
        amountBase: r.amountBase,
        job: r.campaignId,
        decidedBy: r.decidedBy,
        ownWallet: r.operator,
        at: r.at,
        receipt: `${site}/proof/${r.txHash}`,
      };
    }),
  };
  return NextResponse.json(body, { headers: { "cache-control": "public, max-age=60, s-maxage=60" } });
}
