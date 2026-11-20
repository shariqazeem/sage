import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaignFindings, submissions, type Campaign, type CampaignFindingsRow, type Submission } from "@/lib/db/schema";
import { getCampaign, getDecisionBySubmission, listCampaignEvents, listSubmissions, CAMPAIGN_STOPPED_REASON, SANDBOX_CAMPAIGN_ID } from "@/lib/db/campaigns";
import { nowSeconds } from "@/lib/db/keys";
import { normalizeFounder } from "@/lib/auth/founder";
import { llmCompleteJson, resolveLlm, type LlmComplete } from "@/lib/llm/complete";
import { reasonSentencePublic } from "@/lib/deputy/reason-copy";
import { summarizeSettled } from "@/lib/telegram/format";
import { cover, enforceGroups, plainFindings, REPORT_SYSTEM, reportUser, type Finding, type FindingKind, type PaidAnswer } from "./core";
import { listKeepPosted, type KeepPostedContact } from "./keep-posted";

/**
 * WHAT N PEOPLE FOUND (relaunch, 20 Nov 2026): the report a builder paid for.
 *
 * Built from PAID answers only. A model on the REPORT lane proposes the groups and `core.ts` decides
 * what is shown; with no model (no key, out of credit, over the day's budget, an unusable answer) the
 * same answers are laid out one by one, and the row says which engine built it. Counts, people and
 * money are read from the submissions and the journal on every read: none of them is ever stored
 * from, or written by, a model.
 */

export const PLAIN_ENGINE = "plain";
/** At most one build per test per ten minutes. */
export const REBUILD_COOLDOWN_SEC = 600;
/** The sweep only builds for tests paid recently; an older one is built when its owner opens it. */
export const SWEEP_RECENT_SEC = 7 * 24 * 3600;
export const SWEEP_MAX_PER_TICK = 2;
/** Below this many paid answers there is nothing to group, so no model is asked. */
export const MIN_ANSWERS_FOR_MODEL = 2;

type Complete = (opts: Parameters<typeof llmCompleteJson>[0]) => Promise<Pick<LlmComplete, "json" | "model" | "responseModel">>;
export interface BuildDeps {
  /** the model call, for tests; production's is `llmCompleteJson` on the REPORT lane. */
  complete?: Complete;
  /** whether a model is configured at all; production asks `resolveLlm`. */
  modelConfigured?: () => boolean;
}

const isPaid = (s: Pick<Submission, "status">) => s.status === "paid";
const answerOf = (s: Submission): PaidAnswer => ({ id: s.id, text: s.note ?? "" });

/** This test's paid answers, oldest first: the only answers a finding is ever made from. */
export function paidAnswers(campaignId: string): Submission[] {
  return listSubmissions(campaignId)
    .filter(isPaid)
    .sort((a, b) => (a.decidedAt ?? a.createdAt) - (b.decidedAt ?? b.createdAt) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function storedFindings(campaignId: string): CampaignFindingsRow | null {
  return db.select().from(campaignFindings).where(eq(campaignFindings.campaignId, campaignId)).get() ?? null;
}

const modelConfigured = (deps: BuildDeps) => (deps.modelConfigured ? deps.modelConfigured() : resolveLlm(undefined, "REPORT") !== null);

/** Ask the model to group the answers. Null on ANY failure: the caller then builds plainly. */
async function grouped(title: string, answers: PaidAnswer[], deps: BuildDeps): Promise<{ findings: Finding[]; engine: string } | null> {
  if (answers.length < MIN_ANSWERS_FOR_MODEL || !modelConfigured(deps)) return null;
  try {
    const complete: Complete = deps.complete ?? llmCompleteJson;
    const res = await complete({ system: REPORT_SYSTEM, user: reportUser(title, answers), maxTokens: 2200, temperature: 0.2, lane: "REPORT" });
    const out = enforceGroups(res.json, answers);
    if (out.kept === 0) return null;
    return { findings: out.findings, engine: (res.responseModel ?? res.model) || "model" };
  } catch (e) {
    // out of credit and over-budget arrive here as llm_status_402; the report is built without a model
    console.warn("[report] grouping fell back to plain:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

export interface BuiltFindings {
  findings: Finding[];
  engine: string;
  paidAnswers: number;
  builtAt: number;
}

/** Build this test's findings from its paid answers and keep them. Never throws for a model's sake. */
export async function buildFindings(campaignId: string, deps: BuildDeps = {}, now = nowSeconds()): Promise<BuiltFindings> {
  const answers = paidAnswers(campaignId).map(answerOf);
  const model = await grouped(getCampaign(campaignId)?.title ?? "", answers, deps);
  // the answers may have grown while the model was thinking; cover what it never saw
  const latest = paidAnswers(campaignId).map(answerOf);
  const built: BuiltFindings = {
    findings: model ? cover(model.findings, latest) : plainFindings(latest),
    engine: model ? model.engine : PLAIN_ENGINE,
    paidAnswers: latest.length,
    builtAt: now,
  };
  const values = { json: { findings: built.findings }, paidAnswers: built.paidAnswers, engine: built.engine, builtAt: built.builtAt };
  db.insert(campaignFindings)
    .values({ campaignId, ...values })
    .onConflictDoUpdate({ target: campaignFindings.campaignId, set: values })
    .run();
  return built;
}

/**
 * Is a build due? Only when the number of paid answers changed, and never inside the cooldown.
 * `upgrade` (the owner opening the report) also retries a plain build once a model is configured:
 * a person's visit, never a background loop.
 */
export function rebuildDue(
  stored: Pick<CampaignFindingsRow, "paidAnswers" | "builtAt" | "engine"> | null,
  paid: number,
  now: number,
  opts: { upgrade?: boolean } = {},
): boolean {
  if (!stored) return paid > 0;
  if (now - stored.builtAt < REBUILD_COOLDOWN_SEC) return false;
  if (stored.paidAnswers !== paid) return true;
  return !!opts.upgrade && stored.engine === PLAIN_ENGINE && paid >= MIN_ANSWERS_FOR_MODEL;
}

const inFlight = new Map<string, Promise<BuiltFindings | null>>();

/** Build if due. One build per test at a time; a second caller gets the first one's result. */
export function refreshFindings(campaignId: string, opts: { now?: number; upgrade?: boolean; deps?: BuildDeps } = {}): Promise<BuiltFindings | null> {
  const running = inFlight.get(campaignId);
  if (running) return running;
  const now = opts.now ?? nowSeconds();
  const deps = opts.deps ?? {};
  const upgrade = !!opts.upgrade && modelConfigured(deps);
  if (!rebuildDue(storedFindings(campaignId), paidAnswers(campaignId).length, now, { upgrade })) return Promise.resolve(null);
  const p = buildFindings(campaignId, deps, now)
    .catch((e) => {
      console.error("[report] build failed:", e instanceof Error ? e.message : String(e));
      return null;
    })
    .finally(() => inFlight.delete(campaignId));
  inFlight.set(campaignId, p);
  return p;
}

/**
 * The sweep's step: queue a build for at most two tests whose paid answers changed. The builds run
 * after the sweep answers (`defer`), so a slow model can never hold the sweep's lock or a payout.
 */
export function queueDueFindings(now: number, defer: (fn: () => Promise<unknown>) => void, deps: BuildDeps = {}): { due: number; queued: number } {
  const paid = db
    .select({
      id: submissions.campaignId,
      c: sql<number>`count(*)`,
      last: sql<number>`max(coalesce(${submissions.decidedAt}, ${submissions.createdAt}))`,
    })
    .from(submissions)
    .where(eq(submissions.status, "paid"))
    .groupBy(submissions.campaignId)
    .all();
  const stored = new Map(db.select().from(campaignFindings).all().map((r) => [r.campaignId, r]));
  const due = paid
    .filter((p) => p.id !== SANDBOX_CAMPAIGN_ID && p.last >= now - SWEEP_RECENT_SEC && !inFlight.has(p.id))
    .filter((p) => rebuildDue(stored.get(p.id) ?? null, p.c, now))
    .sort((a, b) => a.last - b.last);
  const take = due.slice(0, SWEEP_MAX_PER_TICK);
  for (const p of take) defer(() => refreshFindings(p.id, { now, deps }));
  return { due: due.length, queued: take.length };
}

/* ───────────────────────────────────────────────────────── the view ───── */

export interface FindingPerson {
  submissionId: string;
  wallet: string;
  /** what the vault paid this answer, in USDC base units (6 dp), from the journal; null when unrecorded. */
  paidBase: number | null;
  /** the receipt's path (`/proof/<tx>`), or null. */
  receipt: string | null;
}
export interface FindingView {
  title: string;
  kind: FindingKind;
  /** distinct people behind this finding: the length of `people`, counted in code. */
  count: number;
  people: FindingPerson[];
  quotes: { submissionId: string; text: string }[];
}
export interface FindingsView {
  campaignId: string;
  title: string;
  viewer: "owner" | "public";
  findingsPublic: boolean;
  /** different wallets that sent an answer. */
  peopleTried: number;
  paid: { answers: number; people: number; totalBase: number; totalUsd: string };
  notPaid: { total: number; byReason: { reason: string; count: number }[] };
  /** answers still being checked. */
  checking: number;
  findings: FindingView[];
  /** the model id that grouped the findings, or "plain". */
  engine: string;
  /** when the stored findings were built (epoch seconds); null when nothing is stored yet. */
  builtAt: number | null;
  /** a fresh build was queued by this read; ask again shortly. */
  rebuilding: boolean;
  keepPosted: { count: number; contacts?: KeepPostedContact[] };
}

const walletKey = (w: string) => normalizeFounder(w) ?? w.trim().toLowerCase();

const FILLED = "The places filled up before this answer could be paid";
const CAPPED = "This person had already been paid for this test";
const STOPPED = "The test was stopped before this answer was checked";
const NOT_ACCEPTED = "Not accepted";

/** The recorded reason an answer was not paid, as one plain line. Deterministic: no model reads it. */
export function notPaidReason(sub: Pick<Submission, "id" | "rejectReason">, viewer: "owner" | "public"): string {
  const text = sub.rejectReason?.trim() ?? "";
  if (text === CAMPAIGN_STOPPED_REASON) return STOPPED;
  if (/mission filled up before/i.test(text)) return FILLED;
  if (/this wallet has already been paid/i.test(text)) return CAPPED;
  const code = getDecisionBySubmission(sub.id)?.brief?.reasonCode;
  if (code && code !== "all_criteria_met" && code !== "unknown") {
    const s = reasonSentencePublic(code);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  // free text may name another person's wallet, so only the owner reads it
  if (text && viewer === "owner") return text.replace(/^0x[0-9a-f…]+ · /i, "").slice(0, 160);
  return NOT_ACCEPTED;
}

/**
 * The report as a reader may see it. Everything but the grouping is read now: who tried, who was
 * paid and how much (the journal's settled rows), who was not and why, who wants to hear back.
 * An answer paid since the last build is covered here, so it is never missing.
 */
export function findingsView(campaign: Campaign, viewer: "owner" | "public", findingsPublic: boolean): Omit<FindingsView, "rebuilding"> {
  const subs = listSubmissions(campaign.id);
  const paidRows = paidAnswers(campaign.id);
  const byId = new Map(paidRows.map((s) => [s.id, s]));
  const answers = paidRows.map(answerOf);
  const events = listCampaignEvents(campaign.id);

  // money: the vault-derived amount on each settled row, by its transaction, else by its submission
  const amountByTx = new Map<string, number>();
  const amountBySub = new Map<string, number>();
  for (const e of events) {
    if ((e.kind !== "settled" && e.kind !== "autopay_settled") || e.amount == null) continue;
    if (e.txHash) amountByTx.set(e.txHash.toLowerCase(), e.amount);
    if (e.submissionId) amountBySub.set(e.submissionId, e.amount);
  }
  const person = (id: string): FindingPerson => {
    const s = byId.get(id)!;
    return {
      submissionId: s.id,
      wallet: s.wallet,
      paidBase: (s.payoutTx ? amountByTx.get(s.payoutTx.toLowerCase()) : undefined) ?? amountBySub.get(s.id) ?? null,
      receipt: s.payoutTx ? `/proof/${s.payoutTx}` : null,
    };
  };

  const row = storedFindings(campaign.id);
  const kept: Finding[] = (row?.json.findings ?? [])
    .map((f) => ({ ...f, submissionIds: f.submissionIds.filter((id) => byId.has(id)), quotes: f.quotes.filter((q) => byId.has(q.submissionId)) }))
    .filter((f) => f.submissionIds.length > 0);
  const findings = row ? cover(kept, answers) : plainFindings(answers);

  const refused = subs.filter((s) => s.status === "rejected" || s.status === "blocked");
  const reasons = new Map<string, number>();
  for (const s of refused) {
    const r = notPaidReason(s, viewer);
    reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  const { settledBase } = summarizeSettled(events);
  const posted = listKeepPosted(campaign.id).filter((k) => byId.has(k.submissionId));

  return {
    campaignId: campaign.id,
    title: campaign.title,
    viewer,
    findingsPublic,
    peopleTried: new Set(subs.map((s) => walletKey(s.wallet))).size,
    paid: {
      answers: paidRows.length,
      people: new Set(paidRows.map((s) => walletKey(s.wallet))).size,
      totalBase: settledBase,
      totalUsd: (settledBase / 1_000_000).toFixed(2),
    },
    notPaid: {
      total: refused.length,
      byReason: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    },
    checking: subs.filter((s) => s.status === "pending" || s.status === "approved" || s.status === "settling").length,
    findings: findings.map((f) => {
      const people = f.submissionIds.map(person);
      return { title: f.title, kind: f.kind, count: people.length, people, quotes: f.quotes };
    }),
    engine: row?.engine ?? PLAIN_ENGINE,
    builtAt: row?.builtAt ?? null,
    // contacts are the owner's alone; anyone else gets the number
    keepPosted: viewer === "owner" ? { count: posted.length, contacts: posted } : { count: posted.length },
  };
}

/**
 * A reader opens the report. The owner's visit also queues a build when one is due (the cooldown
 * still holds); the read itself never waits on a model.
 */
export function openFindings(
  campaign: Campaign,
  viewer: "owner" | "public",
  findingsPublic: boolean,
  defer: (fn: () => Promise<unknown>) => void,
  now = nowSeconds(),
  deps: BuildDeps = {},
): FindingsView {
  let rebuilding = inFlight.has(campaign.id);
  if (viewer === "owner" && !rebuilding) {
    const upgrade = modelConfigured(deps);
    if (rebuildDue(storedFindings(campaign.id), paidAnswers(campaign.id).length, now, { upgrade })) {
      rebuilding = true;
      defer(() => refreshFindings(campaign.id, { now, upgrade: true, deps }));
    }
  }
  return { ...findingsView(campaign, viewer, findingsPublic), rebuilding };
}
