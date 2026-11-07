import "server-only";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, events, submissions } from "@/lib/db/schema";
import { CHAINS, chainConfig } from "@/lib/deputy/networks";

/**
 * THE SETTLED LEDGER — one derivation of "money that actually moved", for every surface.
 *
 * Three public surfaces each computed their own version of the settled total and showed three
 * different numbers on the same day (measured 2026-09-01: launch $52.05, explorer $51.60,
 * marketplace $52.60). Each divergence had its own cause — mission-reward lookups instead of
 * settled amounts, a missing chain filter that let testnet rows into a money headline, a rail
 * whose settlements never reached the events journal — and every future surface would have
 * added a fourth. This module is the fix-shape for that whole family: the settlement EVENT is
 * the single source of truth (CLAUDE.md invariant), so every row here is one deduped
 * settlement event, priced by what the vault actually released.
 *
 * Scopes are named, not implied:
 *  - `mainnet` rows are real money (the chain registry decides — the next rail counts the day
 *     it settles);
 *  - `operator` marks payouts to Sage's own wallets, so "paid to testers" surfaces can
 *     exclude dogfood money without re-deriving anything.
 */

/**
 * One spelling per wallet for comparing: lowercase, and a Starknet felt without its leading zeros (the
 * same account is written `0x05db1…` by one wallet app and `0x5db1…` by another). Both sides of every
 * comparison go through this; it is a comparison key, never a spelling to publish.
 */
export function walletKey(wallet: string): string {
  return wallet.trim().toLowerCase().replace(/^0x0+(?=[0-9a-f])/, "0x");
}

/**
 * SAGE'S OWN WALLETS: money that moved, never a person paid and never a team paying.
 *
 * Every public count of people and teams leaves these out, so a number like "700 people" can never
 * include the founder paying themselves. The list is published as written (the recount reads it from
 * /api/ledger), so anyone recounting from the chain leaves out exactly the same wallets. Each entry says
 * why it is ours. Where the evidence is strong but short of proof, the wallet is listed anyway: a public
 * count may only ever under-count.
 */
export const OWN_WALLETS: readonly string[] = [
  // the founder's MetaMask
  "0xdf70f6e8e656e5bb714ff0e8ca176d76f26890e3",
  "0x0def3d4124d0cd1708aeffe6c1bc8182342a44d6",
  // the Demo Day rehearsal seller (a throwaway key of ours, on /stage/shop.html) — real mainnet USDC,
  // but our own: it is money that moved, never a person paid
  "0xeaeee53550dec03bec947e92a0c3c33668fcc21c",
  // 7 Nov 2026, from Sage's own records:
  // the founder's Starknet wallet: linked to their MetaMask by a declared link (control of both proven
  // in two live sessions); it owns the "Sage" workspace and funded Sage's own Starknet test jobs
  "0x5db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048",
  // the seller in the founder's own advance walkthrough (6 Sep 2026): a member of the founder's
  // workspace, joined on the founder's invite, paid by the founder's grant
  "0x4f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434",
  // the founder's account on Arc (the founder confirmed it, 7 Nov 2026), and the email sign-in that owns it
  "0xa9538365a0c71a026b7aaf4306ea3f0c95bb4e03",
  "0x948a583ccd63d396f3a1318355d02fa2cb935c7a",
  // the wallet of Sage's own operator chat on GOAT: Sage's walkthroughs of its own product
  "0x3a60af43c67dd9d552f180d30d9a042948078341",
];

/** The same wallets as comparison keys (`walletKey`). */
export const OPERATOR_WALLETS = new Set(OWN_WALLETS.map(walletKey));

/** Whether a wallet is one of Sage's own, in any spelling. */
export function isOwnWallet(wallet: string | null | undefined): boolean {
  return !!wallet && OPERATOR_WALLETS.has(walletKey(wallet));
}

export interface SettledRow {
  txHash: string;
  amountBase: number;
  /** the paid submission, when the event names one — lets a surface enrich (mission, host). */
  submissionId: string | null;
  /** recipient wallet when the paid submission is known; null for chain-only rows. */
  wallet: string | null;
  campaignId: string;
  chainId: number;
  mainnet: boolean;
  operator: boolean;
  /**
   * WHO DECIDED TO PAY. `agent`: Sage judged the work and paid it on its own (an `autopay_settled`
   * row, or an `autopay_approved` one when open work settled after its watch window). `person`: someone
   * released it by hand (the founder approving held work, or an operator review). Both move money
   * through the same vault under the same limits; only the decision differs.
   */
  decidedBy: "agent" | "person";
  at: number;
}

const SETTLED_KINDS = ["settled", "autopay_settled"] as const;

/** Every settlement, one row per (chain, tx), newest first. */
export function settledLedger(): SettledRow[] {
  const evs = db
    .select({
      campaignId: events.campaignId,
      submissionId: events.submissionId,
      kind: events.kind,
      txHash: events.txHash,
      amount: events.amount,
      at: events.createdAt,
    })
    .from(events)
    .where(and(inArray(events.kind, [...SETTLED_KINDS]), isNotNull(events.txHash)))
    .all();
  if (evs.length === 0) return [];
  // the agent's approvals of open work, which settle after the watch window (finalization.ts)
  const approvedByAgent = new Set(
    db
      .select({ submissionId: events.submissionId })
      .from(events)
      .where(and(eq(events.kind, "autopay_approved"), isNotNull(events.submissionId)))
      .all()
      .map((e) => e.submissionId as string),
  );

  const campaignIds = [...new Set(evs.map((e) => e.campaignId))];
  const campById = new Map(
    db
      .select({ id: campaigns.id, chainId: campaigns.chainId, sandbox: campaigns.sandbox })
      .from(campaigns)
      .where(inArray(campaigns.id, campaignIds))
      .all()
      .map((c) => [c.id, c]),
  );
  const subIds = [...new Set(evs.map((e) => e.submissionId).filter((s): s is string => !!s))];
  const walletBySub = new Map(
    subIds.length === 0
      ? []
      : db
          .select({ id: submissions.id, wallet: submissions.wallet })
          .from(submissions)
          .where(inArray(submissions.id, subIds))
          .all()
          .map((s) => [s.id, s.wallet]),
  );

  const out = new Map<string, SettledRow>();
  const byAgent = new Set<string>();
  for (const e of evs) {
    const c = campById.get(e.campaignId);
    if (!c || c.sandbox) continue;
    const key = `${c.chainId}:${e.txHash}`;
    if (e.kind === "autopay_settled") byAgent.add(key);
    const wallet = e.submissionId ? (walletBySub.get(e.submissionId) ?? null) : null;
    const prev = out.get(key);
    // one payout can surface as both `settled` and `autopay_settled`; keep the richer row.
    if (prev && prev.wallet !== null) continue;
    const submissionId = e.submissionId ?? prev?.submissionId ?? null;
    const recipient = wallet ?? prev?.wallet ?? null;
    out.set(key, {
      txHash: e.txHash as string,
      amountBase: e.amount ?? prev?.amountBase ?? 0,
      submissionId,
      wallet: recipient,
      campaignId: e.campaignId,
      chainId: c.chainId,
      mainnet: chainConfig(c.chainId).isMainnet,
      operator: isOwnWallet(recipient),
      decidedBy: submissionId !== null && approvedByAgent.has(submissionId) ? "agent" : "person",
      at: prev?.at ?? e.at,
    });
  }
  // the decision is read once every event for the payout has been seen: the `settled` row the vault
  // flow journals and the agent's own `autopay_settled` row can arrive in either order
  for (const [key, row] of out) if (byAgent.has(key)) row.decidedBy = "agent";
  return [...out.values()].sort((a, b) => b.at - a.at);
}

/** Real money settled — the number a page may headline. */
export function mainnetSettled(rows = settledLedger()): { usdcSettled: number; payouts: number } {
  const m = rows.filter((r) => r.mainnet);
  return {
    usdcSettled: m.reduce((s, r) => s + r.amountBase, 0) / 1_000_000,
    payouts: m.length,
  };
}

/** Real money settled to PEOPLE — operator dogfood excluded. */
export function mainnetSettledToTesters(
  rows = settledLedger(),
): { usdcSettled: number; payouts: number; people: number } {
  const m = rows.filter((r) => r.mainnet && !r.operator);
  return {
    usdcSettled: m.reduce((s, r) => s + r.amountBase, 0) / 1_000_000,
    payouts: m.length,
    people: new Set(m.filter((r) => r.wallet).map((r) => (r.wallet as string).toLowerCase())).size,
  };
}

/**
 * WHO WAS JUDGED, defined once: submissions with the given verdicts on real-money, non-sandbox
 * campaigns. The refusal share counts this population and the public ledger lists it, from this one
 * predicate, so the list under "refused" can never be a second answer to how many were refused.
 */
function judgedOnMainnet(statuses: string[]) {
  const mainnetIds = Object.keys(CHAINS).map(Number).filter((id) => chainConfig(id).isMainnet);
  return and(inArray(campaigns.chainId, mainnetIds), eq(campaigns.sandbox, false), inArray(submissions.status, statuses));
}

/**
 * THE REFUSAL SHARE — one derivation, for every surface.
 *
 * Measured 2026-09-02 on a single judge's walk: the explorer said 43%, the landing and the outcomes
 * page said 44%, the launch page said 50% — three arithmetics over three populations (all rails vs
 * mainnet settlements vs "anything not paid, held included"). The refusal rate is the number the
 * whole capital story leans on, so it is computed here once: judged submissions on real-money,
 * non-sandbox campaigns — paid or refused — and the share of them refused. Held work is not a
 * verdict and is not counted either way.
 */
export function decidedOnMainnet(): { paid: number; refused: number; sharePct: number } {
  const rows = db
    .select({ status: submissions.status, c: sql<number>`count(*)` })
    .from(submissions)
    .innerJoin(campaigns, eq(campaigns.id, submissions.campaignId))
    .where(judgedOnMainnet(["paid", "rejected"]))
    .groupBy(submissions.status)
    .all();
  let paid = 0;
  let refused = 0;
  for (const r of rows) {
    if (r.status === "paid") paid = Number(r.c);
    if (r.status === "rejected") refused = Number(r.c);
  }
  const judged = paid + refused;
  return { paid, refused, sharePct: judged > 0 ? Math.round((refused / judged) * 100) : 0 };
}

/**
 * One refusal behind `decidedOnMainnet().refused`. There is deliberately no wallet and no reason
 * text: refusals are the system's integrity story, told without naming anyone (record.ts), and a
 * public reason written about one person's work is the kind of feedback the no-oracle rule keeps
 * to the person it was written for.
 */
export interface RefusedRow {
  submissionId: string;
  campaignId: string;
  chainId: number;
  /** a transaction only when the refusal produced one. It almost never does: refusing is free. */
  txHash: string | null;
  at: number;
}

/** Every refusal on real money, newest first. Its length is `decidedOnMainnet().refused`, by construction. */
export function refusedOnMainnet(): RefusedRow[] {
  return db
    .select({
      submissionId: submissions.id,
      campaignId: submissions.campaignId,
      chainId: campaigns.chainId,
      txHash: submissions.payoutTx,
      decidedAt: submissions.decidedAt,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .innerJoin(campaigns, eq(campaigns.id, submissions.campaignId))
    .where(judgedOnMainnet(["rejected"]))
    .all()
    .map((r) => ({
      submissionId: r.submissionId,
      campaignId: r.campaignId,
      chainId: r.chainId,
      txHash: r.txHash ?? null,
      at: r.decidedAt ?? r.createdAt,
    }))
    .sort((a, b) => b.at - a.at);
}
