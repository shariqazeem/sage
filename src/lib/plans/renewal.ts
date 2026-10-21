import "server-only";
import type { Hash } from "viem";
import { nowSeconds } from "@/lib/db/keys";
import {
  claimRenewal,
  finishRenewal,
  getPlanPayment,
  markRenewalSent,
  setRenewReminded,
  staleChargingRenewals,
  workspacesEndingBetween,
  getRenewal,
} from "@/lib/db/workspaces";
import { db } from "@/lib/db";
import { workspaces, type PlanRenewal, type Workspace } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { telegramChatOf } from "@/lib/db/agent-wallets";
import { sendTelegram } from "@/lib/telegram/bot";
import { founderChain } from "@/lib/auth/founder";
import { getWebTreasuryOn } from "@/lib/treasury/web";
import { accountBalanceBase } from "@/lib/treasury/activity";
import { chainConfig } from "@/lib/deputy/networks";
import { isPlanId, PLANS, type PlanId } from "./catalog";
import { planPriceUsd, usdToBase } from "./billing-math";
import { billingAddress, billingChains, readPlanPayment } from "./billing";
import { applyPlanPayment, quoteWorkspacePlan } from "./apply-payment";
import { payPlanFromBalance, type BalancePayment } from "./pay-from-balance";

/**
 * PLANS THAT RENEW LIKE A CARD (21 Oct 2026, the founder's decision: "auto-renew, on by default").
 *
 * A paid plan renews itself from the owner's Sage balance on Metis, unless they turned renewal off. The
 * owner hears three days before; the charge runs in the plan's last day, so a renewed plan never
 * lapses; a charge that fails (the balance is short, say) is retried at most every six hours for three
 * days after the plan ends, and the owner is told why each time it fails. Turning renewal off keeps
 * the plan until its period ends, then it is Free again. A live job keeps paying its workers whatever
 * happens here: plans gate launches, never payouts.
 *
 * Money safety, in order: a renewal row is CLAIMED before anything moves (one per workspace per period
 * end, by primary key); the payment's hash is written the moment it is sent; and a renewal a crash left
 * mid-charge is finished from the chain, never charged again.
 */
export const REMIND_AHEAD_SECONDS = 3 * 24 * 3600;
export const RENEW_AHEAD_SECONDS = 24 * 3600;
export const RENEW_GRACE_SECONDS = 3 * 24 * 3600;
export const RENEW_RETRY_SECONDS = 6 * 3600;
/** A renewal still `charging` this long after its attempt began was interrupted. */
export const RENEW_STALE_SECONDS = 30 * 60;

export type RenewalAction = { kind: "none"; why: string } | { kind: "remind" } | { kind: "charge" };

/** Pure: what to do about one workspace's renewal right now. */
export function renewalAction(input: {
  plan: string;
  planUntil: number | null;
  autoRenew: boolean;
  remindedFor: number | null;
  /** the renewal already attempted for this period end, if any. */
  attempt: Pick<PlanRenewal, "status" | "lastAttemptAt"> | null;
  now: number;
  prices?: Partial<Record<PlanId, number | null>>;
}): RenewalAction {
  const { planUntil, now } = input;
  if (!isPlanId(input.plan) || input.plan === "free") return { kind: "none", why: "free" };
  const price = input.prices?.[input.plan] !== undefined ? input.prices[input.plan] : planPriceUsd(input.plan);
  if (!price) return { kind: "none", why: "arranged" }; // Programs, or a grant: set up with us, never charged here
  if (planUntil == null) return { kind: "none", why: "no_period" };
  if (now > planUntil + RENEW_GRACE_SECONDS) return { kind: "none", why: "lapsed" };
  const charging = input.autoRenew && planUntil - now <= RENEW_AHEAD_SECONDS;
  if (charging) {
    if (!input.attempt) return { kind: "charge" };
    if (input.attempt.status === "failed" && (input.attempt.lastAttemptAt ?? 0) <= now - RENEW_RETRY_SECONDS) return { kind: "charge" };
    return { kind: "none", why: input.attempt.status === "paid" ? "paid" : "waiting" };
  }
  if (planUntil > now && planUntil - now <= REMIND_AHEAD_SECONDS && input.remindedFor !== planUntil) return { kind: "remind" };
  return { kind: "none", why: "not_due" };
}

/**
 * What the owner reads about the next renewal, on Home, in Settings and at checkout. Null when there is
 * nothing to say (Free, or an arranged plan). Pure, so every surface says the same sentence.
 */
export function renewalNotice(input: {
  plan: string;
  planUntil: number | null;
  autoRenew: boolean;
  /** whether there is a Sage balance on the billing network for the renewal to come from. */
  hasBalance: boolean;
  attempt: Pick<PlanRenewal, "status" | "error"> | null;
  balanceUsd: number | null;
  now: number;
}): { tone: "info" | "warn"; text: string } | null {
  if (!isPlanId(input.plan) || input.plan === "free" || input.planUntil == null) return null;
  const price = planPriceUsd(input.plan);
  if (!price) return null;
  const name = PLANS[input.plan].name;
  const day = new Date(input.planUntil * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
  const lapsed = input.planUntil <= input.now;
  if (input.attempt?.status === "failed") {
    return { tone: "warn", text: `${name} didn't renew: ${input.attempt.error ?? "the payment didn't go through"}${lapsed ? " Your live jobs keep paying people; renew to launch more." : ""}` };
  }
  if (lapsed) return null;
  if (!input.autoRenew) return { tone: "info", text: `${name} ends on ${day}. Renewal is off, so it won't be charged again.` };
  if (!input.hasBalance) return { tone: "info", text: `${name} runs until ${day}. Renew it from Settings when you like, or add a Sage balance and it renews itself.` };
  const soon = input.planUntil - input.now <= REMIND_AHEAD_SECONDS;
  if (soon && input.balanceUsd != null && input.balanceUsd < price) {
    return { tone: "warn", text: `${name} renews on ${day} for $${price} from your Sage balance, which holds $${input.balanceUsd.toFixed(2)}. Add funds before then to keep it.` };
  }
  return { tone: "info", text: `${name} renews on ${day} for $${price} from your Sage balance.` };
}

export interface RenewalSummary {
  candidates: number;
  reminded: number;
  charged: number;
  failed: number;
  recovered: number;
}

export interface RenewalDeps {
  pay?: (input: Parameters<typeof payPlanFromBalance>[0], deps: Parameters<typeof payPlanFromBalance>[1]) => Promise<BalancePayment>;
  notify?: (chatId: string, text: string) => Promise<unknown>;
  balanceUsd?: (founder: string, chainId: number) => Promise<number | null>;
  readPayment?: typeof readPlanPayment;
}

const ownerOf = (ws: Workspace): string | null => (founderChain(ws.ownerKey) === "evm" ? ws.ownerKey : null);

async function balanceOn(founder: string, chainId: number): Promise<number | null> {
  const t = getWebTreasuryOn(founder, chainId);
  if (!t) return null;
  try {
    return Number(await accountBalanceBase(t.privyWalletAddress, chainId)) / 1e6;
  } catch {
    return null;
  }
}

/** The sweep's billing step. Never throws; every failure is recorded on its renewal row instead. */
export async function renewDuePlans(now = nowSeconds(), deps: RenewalDeps = {}): Promise<RenewalSummary> {
  const summary: RenewalSummary = { candidates: 0, reminded: 0, charged: 0, failed: 0, recovered: 0 };
  const chainId = billingChains()[0];
  if (!billingAddress() || chainId == null) return summary;
  const notify = deps.notify ?? ((chat: string, text: string) => sendTelegram(chat, text, { html: false }).catch(() => false));

  // 1. A renewal a crash left mid-charge: finish it from the chain, never charge it again.
  for (const r of staleChargingRenewals(now - RENEW_STALE_SECONDS)) {
    summary.recovered += await recoverRenewal(r, now, deps.readPayment ?? readPlanPayment);
  }

  for (const ws of workspacesEndingBetween(now - RENEW_GRACE_SECONDS, now + REMIND_AHEAD_SECONDS)) {
    const founder = ownerOf(ws);
    if (!founder) continue;
    summary.candidates += 1;
    // Renewing needs somewhere to renew FROM: a founder who pays from their own wallet, with no Sage
    // balance on the billing network, is reminded instead of charged.
    const hasBalance = getWebTreasuryOn(founder, chainId) !== null;
    const action = renewalAction({ plan: ws.plan, planUntil: ws.planUntil, autoRenew: ws.autoRenew && hasBalance, remindedFor: ws.renewRemindedFor, attempt: getRenewal(ws.id, ws.planUntil), now });
    if (action.kind === "remind") {
      setRenewReminded(ws.id, ws.planUntil as number);
      const chat = telegramChatOf(founder);
      if (chat) {
        const balanceUsd = hasBalance ? await (deps.balanceUsd ?? balanceOn)(founder, chainId) : null;
        const notice = renewalNotice({ plan: ws.plan, planUntil: ws.planUntil, autoRenew: ws.autoRenew, hasBalance, attempt: null, balanceUsd, now });
        if (notice) await notify(chat, `${notice.text} Manage it at sagepays.xyz/workspace/settings`);
      }
      summary.reminded += 1;
      continue;
    }
    if (action.kind !== "charge" || !isPlanId(ws.plan)) continue;
    const periodEnd = ws.planUntil as number;
    const claimed = claimRenewal({ workspaceId: ws.id, periodEnd, plan: ws.plan, now, retryAfter: RENEW_RETRY_SECONDS });
    if (!claimed) continue;
    const plan = ws.plan;
    let result: BalancePayment;
    try {
      result = await (deps.pay ?? payPlanFromBalance)(
        { founder, plan, chainId, method: "renewal" },
        {
          // Quote THIS workspace, as it is now: the period continues from where it ends.
          quote: () => {
            const fresh = db.select().from(workspaces).where(eq(workspaces.id, ws.id)).get() ?? ws;
            return quoteWorkspacePlan(fresh, plan, now);
          },
          onSent: (txHash: Hash, gasTxHash: Hash | null) => markRenewalSent(ws.id, periodEnd, txHash, gasTxHash, now),
        },
      );
    } catch (e) {
      result = { ok: false, code: "send_failed", status: 500, error: e instanceof Error ? e.message.slice(0, 200) : "The renewal didn't go through." };
    }
    if (result.ok) {
      finishRenewal({ workspaceId: ws.id, periodEnd, status: "paid", txHash: result.txHash, now });
      summary.charged += 1;
      continue;
    }
    if (result.code === "unconfirmed") continue; // sent: the stale-charging recovery applies it from the chain
    const error =
      result.code === "no_account"
        ? `there's no Sage balance on ${chainConfig(chainId).name} to renew from. Open one on your account page, or pay from a wallet.`
        : result.error;
    finishRenewal({ workspaceId: ws.id, periodEnd, status: "failed", error, now });
    summary.failed += 1;
    const chat = telegramChatOf(founder);
    if (chat) await notify(chat, `${PLANS[plan].name} didn't renew: ${error} Manage it at sagepays.xyz/workspace/settings`);
  }
  return summary;
}

/**
 * Finish a renewal that was interrupted mid-charge. With a hash on the row, the money was sent: read the
 * receipt and apply it (or leave it for the next sweep while it isn't readable). Without one, the send
 * never returned, so nothing is known to have moved: it becomes a failed attempt, retried on schedule.
 * Returns 1 when it settled the row either way.
 */
async function recoverRenewal(r: PlanRenewal, now: number, read: typeof readPlanPayment): Promise<number> {
  const ws = db.select().from(workspaces).where(eq(workspaces.id, r.workspaceId)).get();
  const founder = ws ? ownerOf(ws) : null;
  if (!ws || !founder) {
    finishRenewal({ workspaceId: r.workspaceId, periodEnd: r.periodEnd, status: "failed", error: "the workspace's owner can't be paid from a Sage balance.", now });
    return 1;
  }
  if (!r.txHash) {
    finishRenewal({ workspaceId: r.workspaceId, periodEnd: r.periodEnd, status: "failed", error: "the renewal was interrupted before any payment was sent. It will be tried again.", now });
    return 1;
  }
  if (getPlanPayment(r.txHash)) {
    finishRenewal({ workspaceId: r.workspaceId, periodEnd: r.periodEnd, status: "paid", txHash: r.txHash, now });
    return 1;
  }
  const chainId = billingChains()[0];
  const t = chainId == null ? null : getWebTreasuryOn(founder, chainId);
  const price = planPriceUsd(r.plan);
  if (chainId == null || !t || !price) return 0;
  const check = await read({ chainId, txHash: r.txHash as Hash, payers: [t.privyWalletAddress], minBase: usdToBase(price) });
  if (!check.ok) return 0; // not readable yet, or not found: the next sweep looks again; nothing is re-sent
  // The period this renewal continues from is the row's own, unless a later payment already moved the
  // plan past it (the founder paid by hand meanwhile): then this payment extends from there, so a
  // second real payment is never swallowed by the first.
  const moved = (ws.planUntil ?? 0) > r.periodEnd;
  const q = moved ? quoteWorkspacePlan(ws, r.plan, now) : quoteWorkspacePlan({ ...ws, plan: r.plan, planUntil: r.periodEnd }, r.plan, Math.min(now, r.periodEnd));
  if (!q.ok) return 0;
  applyPlanPayment(q, { txHash: r.txHash, chainId, payer: t.privyWalletAddress, amountBase: check.amountBase, method: "renewal" });
  finishRenewal({ workspaceId: r.workspaceId, periodEnd: r.periodEnd, status: "paid", txHash: r.txHash, now });
  return 1;
}
