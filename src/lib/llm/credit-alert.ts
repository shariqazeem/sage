import "server-only";

import { createHash } from "node:crypto";
import { notifyTelegram } from "@/lib/deputy/notify";
import { fallbackLlm, LANES, resolveLlm, type ResolvedProvider } from "./complete";
import { budgetAlertText, onBudgetTrip } from "./spend";
import { brokenModelList, closedProviders, onCreditChange, onModelHealthChange, postChat, type CreditEvent, type ModelEvent } from "./wire";

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
  offModel?: (() => void) | null;
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
    // a key's own spending quota (CommonStack: "Access key quota exceeded (cap 3)") is raised on the key,
    // not by topping up the account
    const keyQuota = /quota exceeded|\bcap\s*\d/i.test(e.message);
    return [
      "<b>Sage can't reach its model</b>",
      `${e.host} refuses every call: "${e.message}"`,
      "Work is held for review, Post can't draft, and Telegram can't reply until it answers.",
      keyQuota
        ? `Raise this key's spending limit on ${e.host} (and top up the account if it is low), and Sage carries on by itself: held work is re-judged on the next sweep.`
        : `Top up ${e.host} and Sage carries on by itself: held work is re-judged on the next sweep.`,
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
/**
 * A BROKEN MODEL, SAID ONCE (22 Nov 2026). The wire passes over a model that answers 5xx to every call
 * (wire.ts, section 4b). Sage carries on by the fallback where there is one, so this is a note, not an
 * outage: one message when it starts, one when it answers again, at most one per model per OUTAGE_REPEAT_MS.
 */
export function modelAlertText(e: ModelEvent, nowMs: number): string {
  if (e.kind === "broken") {
    return [
      "<b>One of Sage's models is failing every call</b>",
      `${e.model} on ${e.host} answered ${e.status} to five calls in a row.`,
      "Sage passes it over and uses the fallback provider where one is set; work with no fallback keeps its plain version or is held.",
      "Nothing to do if it recovers: Sage probes it and switches back by itself. If it stays down, move its lanes (node scripts/vm/llm-route.mjs status).",
    ].join("\n");
  }
  const mins = Math.max(1, Math.round((nowMs - e.since) / 60_000));
  return ["<b>Sage's model is back</b>", `${e.model} on ${e.host} answers again after about ${mins} min.`].join("\n");
}

function heardModel(e: ModelEvent): void {
  const now = Date.now();
  const id = `model:${e.host}|${e.keyId}|${e.model}`;
  if (e.kind === "broken") {
    const last = state.alerted.get(id);
    if (last !== undefined && now - last < OUTAGE_REPEAT_MS) return;
    state.alerted.set(id, now);
    void state.send(modelAlertText(e, now)).catch(() => undefined);
    return;
  }
  // only someone who was told it broke is told it is back; the entry is kept, so a model that flaps is not
  // announced again inside the repeat window
  if (!state.alerted.has(id)) return;
  void state.send(modelAlertText(e, now)).catch(() => undefined);
}

/**
 * Ask each broken model once, whatever its cooling period says (the sweep calls this each tick). The call's
 * own outcome is what the wire reads: an answer closes the breaker, another 5xx keeps it open. Small on
 * purpose: the failure measured was a 500 at any size, so a few tokens tell as much as a full request.
 */
export async function probeBrokenModels(opts: { fetchImpl?: typeof fetch } = {}): Promise<{ probed: number; recovered: number }> {
  const broken = brokenModelList();
  if (broken.length === 0) return { probed: 0, recovered: 0 };
  let probed = 0;
  let recovered = 0;
  for (const b of broken) {
    // the key is found among what is configured now; a model no lane points at any more is left to expire
    const p = configuredProviders().map((c) => ({ ...c, model: b.model })).find((c) => c.host === b.host && keyIdOf(c.key) === b.keyId);
    if (!p) continue;
    try {
      probed++;
      const res = await postChat(
        p,
        { model: p.model, max_tokens: 512, messages: [{ role: "user", content: "Reply with the single word: ok" }] },
        { timeoutMs: 30_000, priority: "background", lane: "PROBE", fetchImpl: opts.fetchImpl, probe: true },
      );
      if (res.ok) recovered++;
    } catch {
      /* a network failure says nothing either way; the next tick asks again */
    }
  }
  return { probed, recovered };
}

export function armCreditAlerts(send: (text: string) => Promise<void> = notifyTelegram): void {
  state.send = send;
  if (!state.off) state.off = onCreditChange(heard);
  if (!state.offModel) state.offModel = onModelHealthChange(heardModel);
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
        // Sized like real work: a key's spending quota is checked against the most a request could cost, so a
        // few-token probe passes on a key that refuses every real call (21 Nov 2026), and would announce a
        // recovery that isn't one. Billing is per token produced, so a one-word answer still costs next to nothing.
        { model: p.model, max_tokens: 4096, messages: [{ role: "user", content: "Reply with the single word: ok" }] },
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
  state.offModel?.();
  state.offModel = null;
  state.send = notifyTelegram;
  state.alerted.clear();
}

