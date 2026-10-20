import "server-only";
import { decidedOnMainnet, mainnetSettled, settledLedger } from "@/lib/campaigns/settled-ledger";
import { getCampaign } from "@/lib/db/campaigns";
import { readOutcomes } from "@/lib/outcomes/outcomes";
import type { CorridorReading } from "@/lib/money/public-corridors";
import { ledgerOutcomes, parseLedgerQuery, readLedger } from "./ledger";

/**
 * THE READINGS, FOR THE PAGES THAT ARGUE FROM THEM (20 Oct 2026): /outcomes and /caribbean.
 *
 * Every figure another public surface also shows is read from THAT surface's derivation, never
 * re-derived here: the money and the payout count from `mainnetSettled` (the home page and the
 * ledger), the refusals and their share from `decidedOnMainnet`, the people paid and the wait from
 * the ledger's own outcomes (the job board's numbers), the networks from the ledger's breakdown. Two
 * answers to "how much has Sage paid" is the defect this file exists to prevent.
 *
 * The funders and the payouts priced in a local currency are counted over THOSE SAME settled rows,
 * so "N payouts from M funders" can never name more funders than payouts (the outcomes module counts
 * a wider population of paid submissions, and on a database where the two differ the page once read
 * "1 payout, from 3 funders"). Advances, the currencies Sage can price in and the public corridor
 * costs come from the outcomes module, which owns those derivations.
 */
export interface PublicReadings {
  paidUsd: number;
  payouts: number;
  refused: number;
  refusedSharePct: number;
  people: number;
  /** submit → paid, checking included; null until a payout has a measurable wait. */
  medianWaitSeconds: number | null;
  measuredWaits: number;
  /** networks that have settled at least one payout, primary networks first. */
  networks: { name: string; tier: "primary" | "secondary"; payouts: number; paidUsd: number }[];
  funders: number;
  /** obligations priced in a currency other than USD that have settled. */
  denominated: { payouts: number; usd: number; currencies: string[] };
  advances: { total: number; repaid: number };
  currenciesSupported: number;
  corridors: CorridorReading[];
  corridorSource: { name: string; url: string; fetchedOn: string };
  generatedAtUnix: number;
}

export function publicReadings(): PublicReadings {
  const settled = settledLedger();
  const money = mainnetSettled(settled);
  const decided = decidedOnMainnet();
  // who funded the money that moved, and which of it was priced in a local currency: one campaign
  // lookup per job, over exactly the rows the totals count
  const jobsPaid = new Map<string, ReturnType<typeof getCampaign>>();
  for (const row of settled) if (row.mainnet && !jobsPaid.has(row.campaignId)) jobsPaid.set(row.campaignId, getCampaign(row.campaignId));
  const funders = new Set([...jobsPaid.values()].map((c) => c?.posterWallet?.toLowerCase()).filter((w): w is string => !!w));
  const local = settled.filter((row) => {
    const currency = row.mainnet ? jobsPaid.get(row.campaignId)?.currency : null;
    return !!currency && currency !== "USD";
  });
  const jobs = ledgerOutcomes();
  const ledger = readLedger(parseLedgerQuery({}));
  const o = readOutcomes();
  return {
    paidUsd: money.usdcSettled,
    payouts: money.payouts,
    refused: decided.refused,
    refusedSharePct: decided.sharePct,
    people: jobs.people,
    medianWaitSeconds: jobs.medianWaitSeconds,
    measuredWaits: jobs.measured,
    networks: ledger.networks
      .filter((n) => n.payouts > 0)
      .map((n) => ({ name: n.name, tier: n.tier, payouts: n.payouts, paidUsd: n.paidUsd })),
    funders: funders.size,
    denominated: {
      payouts: local.length,
      usd: local.reduce((sum, row) => sum + row.amountBase, 0) / 1_000_000,
      currencies: [...new Set(local.map((row) => jobsPaid.get(row.campaignId)?.currency as string))],
    },
    advances: { total: o.advancesTotal, repaid: o.advancesRepaid },
    currenciesSupported: o.denominationsSupported,
    corridors: o.publicCorridors,
    corridorSource: o.publicCorridorSource,
    generatedAtUnix: o.generatedAtUnix,
  };
}
