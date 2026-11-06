import "server-only";

import { createHash } from "node:crypto";
import { notifyTelegram } from "@/lib/deputy/notify";
import { fallbackLlm, LANES, resolveLlm, type ResolvedProvider } from "./complete";
import { budgetAlertText, onBudgetTrip } from "./spend";
import { closedProviders, onCreditChange, postChat, type CreditEvent } from "./wire";

/**
 * WHEN SAGE'S MODEL PROVIDER RUNS OUT OF CREDIT, THE OPERATOR HEARS IT FROM SAGE.
 *
 * 5 Nov 2026: CommonStack's balance reached zero between the morning's self-check and 08:38 UTC. Every lane
 * (judge, drafter, concierge, missions, and the fallback, on the same account) was refused, and nothing
 * said so: the next founder to press Post, or worker to submit, would have been the first to find out.
 *
 * The wire (wire.ts, section 4) notices an empty account from the provider's own words. This module:
 * - tells the operator chat once (and again only after OUTAGE_REPEAT_MS, while it lasts);
 * - tells them when it answers again;
 * - lets the sweep ask an empty account, every tick, whether it has been topped up (one tiny call, made
 *   only while an account is known to be empty), so recovery is noticed within minutes of a top-up and
 *   held work is re-judged, rather than waiting on the next stranger to try.
 */

/** While an outage lasts, a reminder at most this often. */
export const OUTAGE_REPEAT_MS = 6 * 3600_000;

interface AlertState {
  /** the wire subscription, once armed (one per process, whichever bundle armed it). */
  off: (() => void) | null;
  /** the daily-budget subscription (spend.ts): each ceiling is announced once per day. */
  offBudget?: (() => void) | null;
  /** where alerts go: the operator chat in production, a list in the suite. */
  send: (text: string) => Promise<void>;
  /** last "out of credit" alert per key id (ms). */
  alerted: Map<string, number>;
}
const g = globalThis as typeof globalThis & { __sageCreditAlert?: AlertState };
const keyIdOf = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 12);
const state: AlertState = (g.__sageCreditAlert ??= { off: null, send: notifyTelegram, alerted: new Map() });

/** The operator's words for each change. Pure, for the suite. */
export function creditAlertText(e: CreditEvent, nowMs: number): string {
  if (e.kind === "closed") {
    return [
      "<b>Sage can't reach its model</b>",
      `${e.host} refuses every call: "${e.message}"`,
      "Work is held for review, Post can't draft, and Telegram can't reply until it answers.",
      `Top up ${e.host} and Sage carries on by itself: held work is re-judged on the next sweep.`,
    ].join("\n");
  }
  const mins = Math.max(1, Math.round((nowMs - e.since) / 60_000));
  return [
    "<b>Sage's model is back</b>",
    `${e.host} answers again after about ${mins} min. Work held while it was out is re-judged now.`,
  ].join("\n");
}

/**
 * Start telling the operator about empty accounts. Idempotent: armed at boot and again by every sweep, so
 * an account that emptied before anything was listening is still reported (the current state is replayed
 * on arming), and a reminder goes out while it lasts.
 */
export function armCreditAlerts(send: (text: string) => Promise<void> = notifyTelegram): void {
  state.send = send;
  if (!state.off) state.off = onCreditChange(heard);
  if (!state.offBudget) state.offBudget = onBudgetTrip((e) => void state.send(budgetAlertText(e)).catch(() => undefined));
  for (const c of closedProviders()) heard({ kind: "closed", ...c });
}

function heard(e: CreditEvent): void {
  const now = Date.now();
  if (e.kind === "closed") {
    const last = state.alerted.get(e.keyId);
    if (last !== undefined && now - last < OUTAGE_REPEAT_MS) return;
    state.alerted.set(e.keyId, now);
    void state.send(creditAlertText(e, now)).catch(() => undefined);
    return;
  }
  // only a recovery the operator was told about is worth a message
  if (!state.alerted.has(e.keyId)) return;
  state.alerted.delete(e.keyId);
  void state.send(creditAlertText(e, now)).catch(() => undefined);
}

/** Is this provider's account currently known to be empty? */
export function isClosed(p: Pick<ResolvedProvider, "host" | "key">): boolean {
  const id = `${p.host}|${keyIdOf(p.key)}`;
  return closedProviders().some((c) => `${c.host}|${c.keyId}` === id);
}

/** Is the payout judge's own account (the PAYOUT lane, else the shared chain) known to be empty? */
export function judgeOutOfCredit(): boolean {
  const p = resolveLlm(undefined, "PAYOUT");
  return p ? isClosed(p) : false;
}

/** Every distinct provider Sage is configured to call: each lane, the shared chain and the fallback. */
export function configuredProviders(): ResolvedProvider[] {
  const all = [resolveLlm(), ...LANES.map((l) => resolveLlm(undefined, l)), fallbackLlm()].filter((p): p is ResolvedProvider => p !== null);
  const seen = new Set<string>();
  return all.filter((p) => {
    const k = `${p.host}|${keyIdOf(p.key)}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

/**
 * Ask each account known to be empty whether it answers now: one request for a few tokens, sent only
 * past the wire's memory window and only for keys currently closed. Never throws. Returns how many keys
 * answered again (the wire fires "reopened" for each, and the alert follows).
 */
export async function probeClosedProviders(opts: { fetchImpl?: typeof fetch } = {}): Promise<{ probed: number; reopened: number }> {
  const closed = closedProviders();
  if (closed.length === 0) return { probed: 0, reopened: 0 };
  const closedIds = new Set(closed.map((c) => `${c.host}|${c.keyId}`));
  const targets = configuredProviders().filter((p) => closedIds.has(`${p.host}|${keyIdOf(p.key)}`));
  let probed = 0;
  let reopened = 0;
  for (const p of targets) {
    try {
      probed++;
      const res = await postChat(
        p,
        // a few tokens, not one: a reasoning model may refuse a budget too small to start in
        { model: p.model, max_tokens: 16, messages: [{ role: "user", content: "ok" }] },
        { timeoutMs: 15_000, priority: "judgment", lane: "PROBE", fetchImpl: opts.fetchImpl },
      );
      if (res.ok) reopened++;
    } catch {
      /* a network failure says nothing about credit; the next tick asks again */
    }
  }
  return { probed, reopened };
}

/** For the sweep's summary and the health line: which accounts are empty, since when. */
export function creditStatus(nowMs = Date.now()): { host: string; since: string; minutes: number; message: string }[] {
  return closedProviders().map((c) => ({
    host: c.host,
    since: new Date(c.since).toISOString(),
    minutes: Math.round((nowMs - c.since) / 60_000),
    message: c.message,
  }));
}

/** Test seam. */
export function resetCreditAlerts(): void {
  state.off?.();
  state.off = null;
  state.offBudget?.();
  state.offBudget = null;
  state.send = notifyTelegram;
  state.alerted.clear();
}

