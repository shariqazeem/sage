import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentWallets, campaigns, missions, submissions } from "@/lib/db/schema";
import { decidedOnMainnet, isOwnWallet, settledLedger, walletKey, type SettledRow } from "@/lib/campaigns/settled-ledger";
import { clusterKeyOf } from "@/lib/campaigns/wallet-links";
import { roundsOfCampaigns } from "@/lib/programmes/store";

/**
 * SAGE'S NUMBERS, COUNTED ONE WAY (6-7 Nov 2026).
 *
 * The founder's goal reads like "10,000 payouts, 1,000 jobs paid out by the agent, to 700 people". Each
 * of those words is defined here, once, over the settled ledger (one row per settlement on real money,
 * the same rows the ledger page, the home page and every receipt read), so a claim made from these
 * numbers is a claim anyone can recount:
 *
 * - a PAYOUT is a settlement on real money to a person. Sage's own wallets are counted apart
 *   (`ownWallets`), so `payouts + ownWallets.payouts` is every settlement, the ledger's own total.
 * - BY THE AGENT means Sage decided it (`decidedBy`), not a person releasing it by hand.
 * - a PERSON is a cluster: wallets one person controls count once, the job board's own count.
 * - a JOB is a campaign that paid at least one person; a TEAM is whoever funded it, resolved through
 *   a Sage account to the founder who owns it, Sage's own wallets left out.
 * - a GRANT is COMPLETED when every one of its milestones has been paid to a person.
 * - a ROUND is one week of a weekly job that paid at least one person.
 *
 * Nothing here calls a model, and nothing here is a sample.
 */
export interface SageNumbers {
  /** settlements on real money to people. */
  payouts: number;
  /** of those, decided by the agent. */
  byAgent: number;
  paidUsd: number;
  /** different people paid. */
  people: number;
  /** people paid more than once: the same people coming back. */
  paidAgain: number;
  /** jobs that paid at least one person. */
  jobs: number;
  /** jobs in which the agent decided at least one payout to a person. */
  jobsByAgent: number;
  /** who funded those jobs, other than Sage itself. */
  teams: number;
  grants: { completed: number; paying: number };
  /** weeks of weekly jobs that paid at least one person. */
  rounds: number;
  /** settlements to Sage's own wallets: real money that moved, never a person paid. */
  ownWallets: { payouts: number; paidUsd: number };
  /** every settlement on real money: `payouts + ownWallets.payouts`, the ledger's headline. */
  total: { payouts: number; paidUsd: number };
  refused: number;
}

const usdOf = (rows: SettledRow[]) => rows.reduce((s, r) => s + r.amountBase, 0) / 1_000_000;

/** Who funded each job: the founder behind a Sage account, else the wallet that posted it. */
function fundersOf(campaignIds: string[]): Map<string, string> {
  if (campaignIds.length === 0) return new Map();
  const posted = db
    .select({ id: campaigns.id, poster: campaigns.posterWallet })
    .from(campaigns)
    .where(inArray(campaigns.id, campaignIds))
    .all();
  const accounts = new Map(
    db
      .select({ wallet: agentWallets.privyWalletAddress, founder: agentWallets.founderAddress })
      .from(agentWallets)
      .all()
      .filter((a) => !!a.wallet && !!a.founder)
      .map((a) => [walletKey(a.wallet as string), a.founder as string]),
  );
  return new Map(posted.map((c) => [c.id, accounts.get(walletKey(c.poster)) ?? c.poster]));
}

/** Grant jobs among these, and which of them had every milestone paid to a person. */
function grantsOf(rows: SettledRow[]): { completed: number; paying: number } {
  const ids = [...new Set(rows.map((r) => r.campaignId))];
  if (ids.length === 0) return { completed: 0, paying: 0 };
  const grantIds = db
    .select({ id: campaigns.id, kind: campaigns.kind })
    .from(campaigns)
    .where(inArray(campaigns.id, ids))
    .all()
    .filter((c) => c.kind === "grant")
    .map((c) => c.id);
  if (grantIds.length === 0) return { completed: 0, paying: 0 };
  const subIds = rows.filter((r) => grantIds.includes(r.campaignId) && r.submissionId).map((r) => r.submissionId as string);
  const missionOfSub = new Map(
    subIds.length === 0
      ? []
      : db
          .select({ id: submissions.id, hash: submissions.missionIdHash })
          .from(submissions)
          .where(inArray(submissions.id, subIds))
          .all()
          .map((s) => [s.id, s.hash]),
  );
  const paidByMission = new Map<string, number>();
  for (const r of rows) {
    const hash = r.submissionId ? missionOfSub.get(r.submissionId) : null;
    if (hash) paidByMission.set(`${r.campaignId}:${hash}`, (paidByMission.get(`${r.campaignId}:${hash}`) ?? 0) + 1);
  }
  const milestones = db
    .select({ campaignId: missions.campaignId, hash: missions.missionIdHash, max: missions.maxCompletions })
    .from(missions)
    .where(inArray(missions.campaignId, grantIds))
    .all();
  let completed = 0;
  for (const id of grantIds) {
    const own = milestones.filter((m) => m.campaignId === id);
    if (own.length > 0 && own.every((m) => (paidByMission.get(`${id}:${m.hash}`) ?? 0) >= Math.max(1, m.max ?? 1))) completed += 1;
  }
  return { completed, paying: grantIds.length };
}

/** The numbers, read now. Pass the ledger when a caller already holds it, so one page reads it once. */
export function sageNumbers(ledger: SettledRow[] = settledLedger()): SageNumbers {
  const real = ledger.filter((r) => r.mainnet);
  // the job board's own filter for "paid to people" (marketplace.ts `settledSoFar`), so the two can
  // never publish different counts of the same thing
  const toPeople = real.filter((r) => !r.operator && r.amountBase > 0);
  const own = real.filter((r) => r.operator);

  const timesPaid = new Map<string, number>();
  for (const r of toPeople) {
    if (!r.wallet) continue;
    const person = clusterKeyOf(r.wallet);
    timesPaid.set(person, (timesPaid.get(person) ?? 0) + 1);
  }

  const jobIds = [...new Set(toPeople.map((r) => r.campaignId))];
  const funders = fundersOf(jobIds);
  const teams = new Set(
    jobIds
      .map((id) => funders.get(id))
      .filter((f): f is string => !!f && !isOwnWallet(f))
      .map((f) => clusterKeyOf(f)),
  );
  const rounds = new Set(
    roundsOfCampaigns(jobIds)
      .filter((r) => r.campaignId !== null)
      .map((r) => `${r.programmeId}:${r.round}`),
  );

  return {
    payouts: toPeople.length,
    byAgent: toPeople.filter((r) => r.decidedBy === "agent").length,
    paidUsd: usdOf(toPeople),
    people: timesPaid.size,
    paidAgain: [...timesPaid.values()].filter((n) => n > 1).length,
    jobs: jobIds.length,
    jobsByAgent: new Set(toPeople.filter((r) => r.decidedBy === "agent").map((r) => r.campaignId)).size,
    teams: teams.size,
    grants: grantsOf(toPeople),
    rounds: rounds.size,
    ownWallets: { payouts: own.length, paidUsd: usdOf(own) },
    total: { payouts: real.length, paidUsd: usdOf(real) },
    refused: decidedOnMainnet().refused,
  };
}
