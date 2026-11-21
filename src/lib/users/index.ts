import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userDrafts, type Campaign, type UserDraftsRow } from "@/lib/db/schema";
import { getInspectionJobByCampaign } from "@/lib/db/inspection";
import { nowSeconds } from "@/lib/db/keys";
import { v2Economics } from "@/lib/campaigns/v2-economics";
import { isPublicWork } from "@/lib/campaigns/visibility";
import { firstLookFor } from "@/lib/first-look";
import { llmCompleteJson, resolveLlm, type LlmComplete } from "@/lib/llm/complete";
import { completeSteadily } from "@/lib/llm/steady";
import { findingsView, type FindingsView } from "@/lib/report";
import { sharingFor } from "@/lib/sharing";
import { hostOf } from "@/lib/site/when";
import { draftsUser, enforceDrafts, factsFrom, plainDrafts, PLAIN_ENGINE, USERS_SYSTEM, type Drafts, type UserFacts } from "./core";
import { POST_DOOR, type PostDoor } from "./links";
import { venuesFor, type Venue } from "./venues";

/**
 * GET YOUR FIRST USERS, as the owner's page reads it (21 Nov 2026).
 *
 * The plain drafts are written by code on every read, so the stage is never empty and never waits. A
 * model words them only when the owner asks (`wordDrafts`, POST /api/campaigns/<id>/users), on the DRAFT
 * lane, once per version of the facts: the result is kept, and a wording that failed is not asked for
 * again inside the cooldown. A test nobody opens costs nothing.
 *
 * NO CORPUS ORACLE (CLAUDE.md). While a place is still open, a post that carried what paid people found
 * would hand the next tester an answer to copy, so until the test is done the drafts only ask people to
 * try the product: no count, no problem, no quote. They turn into "what I learned" when it is done.
 *
 * For the owner alone. Nothing here holds a tester's handle, email or wallet: the keep-posted contacts
 * stay where they already were (`findings.keepPosted`), and the page joins the two in the owner's browser.
 */
export const REWORD_COOLDOWN_SEC = 600;

export interface FirstUsersView {
  /** a hash of the facts the drafts are written from: it changes when a count, a quote or the product does */
  version: string;
  productUrl: string;
  name: string;
  /** the test is done and someone was paid: the drafts say what people found, not a call for people */
  hasFindings: boolean;
  /** places are still open, so the drafts hold nothing people found yet */
  open: boolean;
  drafts: Drafts;
  /** the model that worded the drafts shown, or "plain" */
  engine: string;
  /** the owner may ask for a wording now: a model is configured and this version has not been worded */
  canReword: boolean;
  venues: readonly Venue[];
  /** how a post leaves: the channel's own share link today (see links.ts for the seam) */
  door: PostDoor;
}

type Complete = (opts: Parameters<typeof llmCompleteJson>[0]) => Promise<Pick<LlmComplete, "json" | "model" | "responseModel">>;
export interface UsersDeps {
  /** the model call, for tests; production's is `llmCompleteJson` on the DRAFT lane */
  complete?: Complete;
  /** whether a model is configured at all; production asks `resolveLlm` */
  modelConfigured?: () => boolean;
}

const configured = (deps: UsersDeps) => (deps.modelConfigured ? deps.modelConfigured() : resolveLlm(undefined, "DRAFT") !== null);

export function versionOf(facts: UserFacts): string {
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex").slice(0, 16);
}

export function storedDrafts(campaignId: string): UserDraftsRow | null {
  return db.select().from(userDrafts).where(eq(userDrafts.campaignId, campaignId)).get() ?? null;
}

type Findings = Omit<FindingsView, "rebuilding">;

/** No place can be taken any more: every place is paid, or the test was stopped or ended. As the page's own `phase`. */
export function testIsDone(campaign: Campaign): boolean {
  const e = v2Economics(campaign);
  return campaign.status !== "live" || (e.totalCompletions > 0 && e.paidCompletions >= e.totalCompletions);
}

/**
 * This test's facts, or null when it has no product address to send people to. What people found is
 * read only once the test is `done`.
 */
export function factsFor(campaign: Campaign, findings: Findings | null, done: boolean): UserFacts | null {
  const job = getInspectionJobByCampaign(campaign.id);
  if (!job || !/^https?:\/\//i.test(job.productUrl)) return null;
  const host = hostOf(job.productUrl);
  if (!host) return null;
  const map = (job.result as { map?: { productName?: unknown; category?: unknown } } | null)?.map;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return factsFrom({
    productUrl: job.productUrl,
    host,
    productName: str(map?.productName),
    says: firstLookFor(job)?.read.says ?? null,
    category: str(map?.category),
    inviteOnly: !isPublicWork(campaign),
    findings: done ? findings : null,
  });
}

const isDrafts = (v: unknown): v is Drafts => {
  const d = v as Partial<Drafts> | null;
  return !!d && typeof d.post === "string" && typeof d.long === "string" && typeof d.redditTitle === "string" && typeof d.emailSubject === "string" && !!d.tell && typeof d.tell.subject === "string" && typeof d.tell.body === "string";
};

function viewOf(facts: UserFacts, done: boolean, row: UserDraftsRow | null, now: number, deps: UsersDeps): FirstUsersView {
  const version = versionOf(facts);
  const current = row && row.version === version ? row : null;
  const worded = current && current.engine !== PLAIN_ENGINE && isDrafts(current.json) ? current : null;
  const resting = !!current && current.engine === PLAIN_ENGINE && now - current.builtAt < REWORD_COOLDOWN_SEC;
  return {
    version,
    productUrl: facts.url,
    name: facts.name,
    hasFindings: facts.people > 0,
    open: !done,
    drafts: worded ? (worded.json as Drafts) : plainDrafts(facts),
    engine: worded ? worded.engine : PLAIN_ENGINE,
    canReword: !worded && !resting && configured(deps),
    venues: venuesFor(facts.category),
    door: POST_DOOR,
  };
}

/** The stage for the owner's page. Reads rows only: no model is ever asked here. */
export function firstUsersView(campaign: Campaign, findings: Findings | null, opts: { done?: boolean; now?: number; deps?: UsersDeps } = {}): FirstUsersView | null {
  const done = opts.done ?? testIsDone(campaign);
  const facts = factsFor(campaign, findings, done);
  return facts ? viewOf(facts, done, storedDrafts(campaign.id), opts.now ?? nowSeconds(), opts.deps ?? {}) : null;
}

const inFlight = new Map<string, Promise<FirstUsersView | null>>();

/**
 * The owner asked Sage to word the drafts. One model call at most per version of the facts, one at a
 * time per test; every draft it returns is checked (`enforceDrafts`) and any that fails is the plain one.
 * Never throws for a model's sake: whatever happens, the builder gets a complete set of drafts back.
 */
export function wordDrafts(campaign: Campaign, deps: UsersDeps = {}, now = nowSeconds()): Promise<FirstUsersView | null> {
  const running = inFlight.get(campaign.id);
  if (running) return running;
  const findings = findingsView(campaign, "owner", sharingFor(campaign.id).findingsPublic);
  const done = testIsDone(campaign);
  const facts = factsFor(campaign, findings, done);
  if (!facts) return Promise.resolve(null);
  const before = viewOf(facts, done, storedDrafts(campaign.id), now, deps);
  if (!before.canReword) return Promise.resolve(before);

  const plain = plainDrafts(facts);
  const save = (drafts: Drafts, engine: string) => {
    const values = { version: before.version, json: drafts, engine, builtAt: now };
    db.insert(userDrafts)
      .values({ campaignId: campaign.id, ...values })
      .onConflictDoUpdate({ target: userDrafts.campaignId, set: values })
      .run();
  };
  const p = (async () => {
    try {
      const complete: Complete = deps.complete ?? llmCompleteJson;
      // a person is waiting on this tap, so it gives up sooner than background wording does
      const res = await completeSteadily(complete, { system: USERS_SYSTEM, user: draftsUser(facts), maxTokens: 1400, temperature: 0.4, lane: "DRAFT" }, { attempts: 2, budgetMs: 45_000, label: "users" });
      const out = enforceDrafts(res.json, facts, plain);
      if (out.dropped.length > 0) console.warn("[users] drafts dropped:", out.dropped.slice(0, 6).join(" | "));
      save(out.drafts, out.kept > 0 ? (res.responseModel ?? res.model) || "model" : PLAIN_ENGINE);
    } catch (e) {
      // out of credit and over-budget arrive here as llm_status_402: the plain drafts stand
      console.warn("[users] kept the plain drafts:", e instanceof Error ? e.message : String(e));
      save(plain, PLAIN_ENGINE);
    }
    return viewOf(facts, done, storedDrafts(campaign.id), now, deps);
  })().finally(() => inFlight.delete(campaign.id));
  inFlight.set(campaign.id, p);
  return p;
}
