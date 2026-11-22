import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaignFindings, submissions, type Campaign, type CampaignFindingsRow, type Submission } from "@/lib/db/schema";
import { getCampaign, getDecisionBySubmission, listCampaignEvents, listSubmissions, CAMPAIGN_STOPPED_REASON, SANDBOX_CAMPAIGN_ID } from "@/lib/db/campaigns";
import { nowSeconds } from "@/lib/db/keys";
import { normalizeFounder } from "@/lib/auth/founder";
import { llmCompleteJson, resolveLlm, type LlmComplete } from "@/lib/llm/complete";
import { completeSteadily } from "@/lib/llm/steady";
import { reasonSentencePublic } from "@/lib/deputy/reason-copy";
import { summarizeSettled } from "@/lib/telegram/format";
import { listCoreAnswers } from "@/lib/core-test/answers";
import { CORE_MISSION_KEY, REACHED_REPORT, splitCoreAccount, type Reached } from "@/lib/core-test/shape";
import { getMissionByKey } from "@/lib/db/campaigns";
import { getInspectionJobByCampaign, listInspectionJobs } from "@/lib/db/inspection";
import { v2Economics } from "@/lib/campaigns/v2-economics";
import { sharingFor } from "@/lib/sharing";
import { testPath } from "@/lib/site/test-path";
import { firstLookFor } from "@/lib/first-look";
import { enforceGroups, REPORT_SYSTEM, reportUser, rungOf, type Finding, type FindingKind, type PaidAnswer, type ReportContext, type Understood } from "./core";
import { coverPlainly, plainFindings, type PlainContext } from "./plain";
import { productKey, whatChanged, type Changed } from "./changed";
import { listKeepPosted, type KeepPostedContact } from "./keep-posted";
import { kindHonestyLine } from "@/lib/launch/product-kind";
import { coreReport, fixFirst, mainActionOf, rankFindings, type CoreReport, type CoreTaps, type FixFirst, type RankedFinding, type SageProblem } from "./product";

/**
 * WHAT N PEOPLE FOUND (relaunch, 20 Nov 2026): the report a builder paid for.
 *
 * Built from PAID answers only. A model on the REPORT lane proposes the groups and `core.ts` decides
 * what is shown; with no model (no key, out of credit, over the day's budget, an unusable answer) the
 * same answers are grouped in code (`plain.ts`: by the rung people stopped on, the things their
 * sentences share and Sage's own notes), and the row says which engine built it. Counts, people and
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

/**
 * What a build knows beyond the answers themselves: Sage's own first look at the product (its
 * problems, and what the product says it is) and the core mission's answers. Read from rows; a test
 * with no inspection behind it, or no core mission, simply has less.
 */
export interface ProductContext {
  ctx: ReportContext;
  sage: SageProblem[];
  /** this test's core mission id (bytes32), or null */
  coreHash: string | null;
  mainAction: string | null;
  /** true when Sage's look used the builder's own test account: its notes are the owner's to read */
  sealed: boolean;
  /** what Sage could and could not try with this kind of product: one fixed line, null for an ordinary site */
  sageTried: string | null;
}

export function productContext(campaignId: string, paid: readonly Submission[] = paidAnswers(campaignId)): ProductContext {
  const job = getInspectionJobByCampaign(campaignId);
  const look = job ? firstLookFor(job) : null;
  const byId = new Map((look?.evidence ?? []).map((e) => [e.id, e]));
  const sage: SageProblem[] = (look?.problems ?? []).map((p) => ({
    id: p.id,
    title: p.title,
    fix: p.fix,
    text: `${p.title} ${p.evidence.map((id) => byId.get(id)?.text ?? "").join(" ")}`,
  }));
  const core = getMissionByKey(campaignId, CORE_MISSION_KEY);
  const coreHash = core?.missionIdHash?.toLowerCase() ?? null;
  const impressions = new Map<string, string>();
  if (coreHash) {
    for (const s of paid) {
      if (s.missionIdHash?.toLowerCase() !== coreHash) continue;
      const parts = splitCoreAccount(s.note);
      if (parts) impressions.set(s.id, parts.impression);
    }
  }
  return {
    ctx: { says: look?.read.says ?? null, sageProblems: sage.map((p) => ({ id: p.id, text: p.text })), impressions },
    sage,
    coreHash,
    mainAction: mainActionOf(core?.evidenceList),
    sealed: !!job?.testAccountSealed,
    sageTried: kindHonestyLine((job?.result as { map?: { productKind?: unknown } } | null | undefined)?.map) || null,
  };
}

/**
 * What the plain grouping may know beyond the words: the rung each paid core answer's person tapped,
 * and Sage's own notes. Taps on answers that are not paid core answers are never read.
 */
export function plainContext(product: Pick<ProductContext, "ctx" | "coreHash">, paid: readonly Submission[], taps: ReadonlyMap<string, CoreTaps>): PlainContext & { rungs: Map<string, Reached> } {
  const rungs = new Map<string, Reached>();
  if (product.coreHash) {
    for (const s of paid) {
      const tap = s.missionIdHash?.toLowerCase() === product.coreHash ? taps.get(s.id) : undefined;
      if (tap) rungs.set(s.id, tap.reached);
    }
  }
  return { rungs, sageProblems: product.ctx.sageProblems };
}

/** Ask the model to group the answers. Null on ANY failure: the caller then builds plainly. */
async function grouped(title: string, answers: PaidAnswer[], ctx: ReportContext, deps: BuildDeps): Promise<{ findings: Finding[]; understood: Understood[]; engine: string } | null> {
  if (answers.length < MIN_ANSWERS_FOR_MODEL || !modelConfigured(deps)) return null;
  try {
    const complete: Complete = deps.complete ?? llmCompleteJson;
    // background work: a provider's hiccup is waited out before the plain report is built (steady.ts)
    const res = await completeSteadily(complete, { system: REPORT_SYSTEM, user: reportUser(title, answers, ctx), maxTokens: 2600, temperature: 0.2, lane: "REPORT", tag: "report", maxWaitMs: 90_000 }, { attempts: 3, budgetMs: 90_000, label: "report" });
    const out = enforceGroups(res.json, answers, ctx);
    if (out.droppedExtras.length > 0) console.warn("[report] dropped:", out.droppedExtras.slice(0, 6).join(" | "));
    if (out.droppedGroups.length > 0) console.warn("[report] groups that did not hold up, grouped in code instead:", out.droppedGroups.slice(0, 6).join(" | "));
    if (out.kept === 0) return null;
    // the model's own groups that held up; whoever they leave out is grouped in code by the caller
    return { findings: out.groups, understood: out.understood, engine: (res.responseModel ?? res.model) || "model" };
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
  const paid = paidAnswers(campaignId);
  const answers = paid.map(answerOf);
  const product = productContext(campaignId, paid);
  const model = await grouped(getCampaign(campaignId)?.title ?? "", answers, { ...product.ctx, rungs: plainContext(product, paid, listCoreAnswers(campaignId)).rungs }, deps);
  // the answers may have grown while the model was thinking; whoever it never saw is grouped in code
  const latestRows = paidAnswers(campaignId);
  const latest = latestRows.map(answerOf);
  const plain = plainContext(product, latestRows, listCoreAnswers(campaignId));
  const built: BuiltFindings = {
    findings: model ? coverPlainly(model.findings, latest, plain) : plainFindings(latest, plain),
    engine: model ? model.engine : PLAIN_ENGINE,
    paidAnswers: latest.length,
    builtAt: now,
  };
  const understood = model?.understood ?? [];
  const values = { json: { findings: built.findings, ...(understood.length > 0 ? { understood } : {}) }, paidAnswers: built.paidAnswers, engine: built.engine, builtAt: built.builtAt };
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
  /** distinct people behind this finding (by wallet), counted in code. */
  count: number;
  /** the people it is out of: everyone paid in this test. "3 of 10". */
  of: number;
  /** where these people stopped, when everyone in it who stopped tapped the same rung ("Stopped on the first screen") */
  stoppedOn: string | null;
  people: FindingPerson[];
  quotes: { submissionId: string; text: string }[];
  /** one suggested fix: a model's checked sentence, else Sage's own fix for the matching problem; null when there is none */
  fix: string | null;
  /** Sage recorded the same problem in its own first look, confirmed in code by shared words */
  sageSaw: boolean;
  /** what Sage called it, when this reader may see Sage's notes */
  sageTitle: string | null;
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
  /** what Sage itself could and could not try (a phone app is read from its listing, people try it); null for a site */
  sageTried: string | null;
  /** problems first, then by how many people, ranked in code */
  findings: FindingView[];
  /** the core mission's counts (understood it, the main action, would use it again); null when the test has no core answers yet */
  core: CoreReport | null;
  /** the top three things to fix, by how many people hit each */
  fixFirst: FixFirst[];
  /**
   * What changed since this builder's last finished test of the same product; null when there is none,
   * or when this reader may not see the earlier test's findings.
   */
  changed: ChangedView | null;
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

/** The comparison with the builder's last test, with which test it was. */
export interface ChangedView extends Changed {
  previous: { id: string; title: string; path: string };
  /** this test still has places open, so its side of every count is "so far" */
  live: boolean;
}

/** No place can be taken any more: every place is paid, or the test was stopped or ended. A draft is not done. */
export function testDone(campaign: Campaign): boolean {
  if (campaign.status === "draft") return false;
  if (campaign.status !== "live") return true;
  const e = v2Economics(campaign);
  return e.totalCompletions > 0 && e.paidCompletions >= e.totalCompletions;
}

/**
 * This builder's last FINISHED test of the same product before this one: the same founder (the
 * inspection's owner), the same product address (`productKey`), at least one paid answer. Null when
 * there is none. A test still taking answers is never the "last test".
 */
export function previousTest(campaign: Campaign): Campaign | null {
  const job = getInspectionJobByCampaign(campaign.id);
  const key = productKey(job?.productUrl);
  if (!job || !key) return null;
  let best: Campaign | null = null;
  const seen = new Set<string>([campaign.id]);
  for (const j of listInspectionJobs(job.founderWallet)) {
    const id = j.publicCampaignId;
    if (!id || seen.has(id) || productKey(j.productUrl) !== key) continue;
    seen.add(id);
    const c = getCampaign(id);
    if (!c || c.createdAt >= campaign.createdAt || !testDone(c) || paidAnswers(c.id).length === 0) continue;
    if (!best || c.createdAt > best.createdAt) best = c;
  }
  return best;
}

/**
 * A LATER TEST OF THE SAME PRODUCT THAT IS STILL TAKING ANSWERS, or null (22 Nov 2026).
 *
 * NO CORPUS ORACLE (CLAUDE.md). A finished test's frames, first look and public findings describe the product and
 * what paid people wrote about it. When the same builder tests that product again, those pages would hand the new
 * test's testers answers to copy while its places are open. So while such a retest is open, the earlier test's
 * material is the owner's alone again (the test page, the findings route, the front door's real test); it comes
 * back to the public once the retest is done. The same builder only: tests of one product by two builders are not
 * matched (no cross-builder lookup exists).
 */
export function openRetestOf(campaign: Pick<Campaign, "id" | "createdAt">): Campaign | null {
  const job = getInspectionJobByCampaign(campaign.id);
  const key = productKey(job?.productUrl);
  if (!job || !key) return null;
  const seen = new Set<string>([campaign.id]);
  for (const j of listInspectionJobs(job.founderWallet)) {
    const id = j.publicCampaignId;
    if (!id || seen.has(id) || productKey(j.productUrl) !== key) continue;
    seen.add(id);
    const c = getCampaign(id);
    if (c && c.createdAt > campaign.createdAt && c.status === "live" && !testDone(c)) return c;
  }
  return null;
}

/** One test's report, counted from its rows: what both the view and a comparison read. */
interface ReportParts {
  paidRows: Submission[];
  answers: PaidAnswer[];
  row: CampaignFindingsRow | null;
  product: ProductContext;
  plain: PlainContext & { rungs: Map<string, Reached> };
  ranked: RankedFinding[];
  core: CoreReport | null;
}

function reportParts(campaignId: string): ReportParts {
  const paidRows = paidAnswers(campaignId);
  const byId = new Map(paidRows.map((s) => [s.id, s]));
  const answers = paidRows.map(answerOf);
  const row = storedFindings(campaignId);
  // THE PRODUCT REPORT. Sage's own first look, the core mission's answers, what each person tapped and
  // one stored label per first impression: every count is made here, now, from those rows.
  const product = productContext(campaignId, paidRows);
  const taps = listCoreAnswers(campaignId);
  const plain = plainContext(product, paidRows, taps);
  const kept: Finding[] = (row?.json.findings ?? [])
    .map((f) => ({ ...f, submissionIds: f.submissionIds.filter((id) => byId.has(id)), quotes: f.quotes.filter((q) => byId.has(q.submissionId)) }))
    .filter((f) => f.submissionIds.length > 0);
  // A plain report is grouped again on every read: it costs nothing, it is the same for the same
  // answers, and an answer paid a minute ago joins its group at once. A model's groups are kept as
  // built, and whoever was paid since is grouped in code beside them.
  const findings = row && row.engine !== PLAIN_ENGINE ? coverPlainly(kept, answers, plain) : plainFindings(answers, plain);
  const coreAnswers = product.coreHash ? paidRows.filter((s) => s.missionIdHash?.toLowerCase() === product.coreHash).map(answerOf) : [];
  const core = coreReport({ answers: coreAnswers, taps, understood: row?.json.understood ?? [], says: product.ctx.says, mainAction: product.mainAction });
  return { paidRows, answers, row, product, plain, ranked: rankFindings(findings, product.sage), core };
}

/**
 * What changed since the builder's last test of this product. The owner reads it whenever there is
 * one. Anyone else reads it only when the earlier test's findings are public too: its problems are
 * that test's findings, and a private test stays private.
 */
function changedSince(campaign: Campaign, now: ReportParts, viewer: "owner" | "public"): ChangedView | null {
  const before = previousTest(campaign);
  if (!before) return null;
  if (viewer !== "owner" && !sharingFor(before.id).findingsPublic) return null;
  const then = reportParts(before.id);
  const person = (rows: readonly Submission[]) => {
    const wallet = new Map(rows.map((s) => [s.id, walletKey(s.wallet)]));
    return (id: string) => wallet.get(id) ?? id;
  };
  const changed = whatChanged({
    then: { core: then.core, answers: then.answers, personOf: person(then.paidRows), plain: then.plain, ranked: then.ranked },
    now: { core: now.core, answers: now.answers, personOf: person(now.paidRows), plain: now.plain },
  });
  return changed ? { ...changed, previous: { id: before.id, title: before.title, path: testPath(before.id) }, live: !testDone(campaign) } : null;
}

/**
 * The report as a reader may see it. Everything but the grouping is read now: who tried, who was
 * paid and how much (the journal's settled rows), who was not and why, who wants to hear back.
 * An answer paid since the last build is covered here, so it is never missing.
 */
export function findingsView(campaign: Campaign, viewer: "owner" | "public", findingsPublic: boolean): Omit<FindingsView, "rebuilding"> {
  const subs = listSubmissions(campaign.id);
  const parts = reportParts(campaign.id);
  const { paidRows, row, product, ranked, core } = parts;
  const byId = new Map(paidRows.map((s) => [s.id, s]));
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

  // notes taken with the builder's own test account can describe signed-in screens: the owner's alone
  const maySeeSage = viewer === "owner" || !product.sealed;
  const paidPeople = new Set(paidRows.map((s) => walletKey(s.wallet))).size;

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
      people: paidPeople,
      totalBase: settledBase,
      totalUsd: (settledBase / 1_000_000).toFixed(2),
    },
    notPaid: {
      total: refused.length,
      byReason: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    },
    checking: subs.filter((s) => s.status === "pending" || s.status === "approved" || s.status === "settling").length,
    sageTried: product.sageTried,
    findings: ranked.map((f) => {
      const people = f.submissionIds.map(person);
      // a rung's own finding already says where; a problem says it when everyone in it who stopped agrees
      const rung = f.rung ? null : rungOf(f.submissionIds, parts.plain.rungs);
      return {
        title: f.title,
        kind: f.kind,
        count: new Set(people.map((p) => walletKey(p.wallet))).size,
        of: paidPeople,
        stoppedOn: rung && rung !== "mixed" ? REACHED_REPORT[rung] : null,
        people,
        quotes: f.quotes,
        fix: f.suggestedFix,
        sageSaw: !!f.sage,
        sageTitle: f.sage && maySeeSage ? f.sage.title : null,
      };
    }),
    core,
    fixFirst: fixFirst({ ranked, core, sage: maySeeSage ? product.sage : [] }),
    changed: changedSince(campaign, parts, viewer),
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
