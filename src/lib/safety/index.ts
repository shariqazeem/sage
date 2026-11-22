import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, productScreens, type InspectionJob, type ProductScreenRow } from "@/lib/db/schema";
import { getInspectionJob, getInspectionJobByCampaign } from "@/lib/db/inspection";
import { nowSeconds } from "@/lib/db/keys";
import { notifyTelegram } from "@/lib/deputy/notify";
import { domainAgeDays, safeBrowsingThreats } from "./lookups";
import { phishingListForScreen, phishingListNow } from "./phishing-list";
import {
  builderSafetyLine,
  phishingVerdict,
  safetyOfMap,
  screenProduct,
  screenSubject,
  withReview,
  type ProductSafetyRecord,
  type SafetyOutcome,
  type SafetySignal,
  type ScreenInput,
} from "./product-screen";

/**
 * THE PRODUCT SAFETY SCREEN, ON THE SERVER: the lists, the record, the operator, and the doors.
 *
 * `product-screen.ts` decides (pure). This file:
 *   - `screenForJob`: reads the lists, runs the screen once an inspection has looked at the product, applies
 *     a person's earlier decision, writes the record, and tells the operator once;
 *   - `productStanding`: what a door asks about a plan, at the moment it asks (the stored record, a person's
 *     decision, and the phishing list as the server has it now);
 *   - `launchSafety`: the door itself. Refused closes every launch BEFORE money moves. A hold lets the launch
 *     through and marks the test held (`campaigns.safety_hold`), which keeps it away from the public;
 *   - `decideProduct`: the operator's clear or refuse (`/api/admin/review`, `scripts/review.mjs`).
 *
 * The same rule as plans (CLAUDE.md, section 4): a door is asked before a vault holds money and never after.
 * No settlement path reads any of this: a test that is live keeps paying its testers.
 */

type ScreenContext = Pick<ScreenInput, "url" | "observations" | "fieldTest" | "kind">;

function rowFor(subject: string): ProductScreenRow | null {
  if (!subject) return null;
  return db.select().from(productScreens).where(eq(productScreens.subject, subject)).get() ?? null;
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The operator's one message about a product. Pure, for the suite. */
export function productAlertText(record: ProductSafetyRecord, productUrl: string): string {
  const head = record.outcome === "refused" ? "Sage refused a product" : "A product is held for review";
  return [
    `<b>${head}</b>`,
    esc(productUrl.slice(0, 200)),
    ...record.signals.slice(0, 6).map((s) => `• ${esc(s.reason)} [${esc(s.seen.slice(0, 120))}]`),
    record.outcome === "refused"
      ? "No test, no launch, no funding. If it is a mistake:"
      : "Invited people only; never public until you clear it:",
    `<code>node scripts/review.mjs clear-product ${esc(record.subject)}</code>`,
    record.outcome === "hold" ? `<code>node scripts/review.mjs refuse-product ${esc(record.subject)}</code>` : "",
  ].filter(Boolean).join("\n");
}

/**
 * Screen a product an inspection has just looked at. Never throws: a list that cannot be read is recorded
 * as unavailable, and a record or an alert that fails to write never fails the inspection.
 */
export async function screenForJob(
  jobId: string,
  ctx: ScreenContext,
  deps: { fetch?: typeof fetch; notify?: (text: string) => Promise<void>; now?: number } = {},
): Promise<ProductSafetyRecord> {
  const now = deps.now ?? nowSeconds();
  const [phishing, safeBrowsing] = await Promise.all([
    phishingListForScreen({ fetch: deps.fetch }).catch(() => null),
    safeBrowsingThreats([ctx.url, ...ctx.observations.slice(0, 2).map((o) => o.url)], { fetch: deps.fetch }).catch(() => null),
  ]);
  let host = "";
  try {
    host = new URL(ctx.url).hostname;
  } catch {
    /* no address: the page facts still decide */
  }
  const age = host ? await domainAgeDays(host, { fetch: deps.fetch }).catch(() => null) : undefined;
  const screened = screenProduct({ ...ctx, phishing, safeBrowsing, domainAgeDays: age, now });

  let row: ProductScreenRow | null = null;
  try {
    row = rowFor(screened.subject);
  } catch {
    /* the record is a convenience here; the screen's own answer stands */
  }
  const record = withReview(screened, row?.decision ?? null, row?.decidedAt ?? now);
  if (!screened.subject) return record;

  try {
    const tell = screened.outcome !== "clear" && !row?.decision && row?.alertedOutcome !== screened.outcome;
    const values = { productUrl: ctx.url.slice(0, 500), jobId, outcome: screened.outcome, signals: screened.signals as unknown, lastSeenAt: now };
    // a clear product gets a row only when there is something to remember about it
    if (row || screened.outcome !== "clear") {
      db.insert(productScreens)
        .values({ subject: screened.subject, ...values, firstSeenAt: now, ...(tell ? { alertedOutcome: screened.outcome, alertedAt: now } : {}) })
        .onConflictDoUpdate({ target: productScreens.subject, set: { ...values, ...(tell ? { alertedOutcome: screened.outcome, alertedAt: now } : {}) } })
        .run();
    }
    // written down before it is sent, so a crash can never send the same product twice
    if (tell) void (deps.notify ?? notifyTelegram)(productAlertText(screened, ctx.url)).catch(() => {});
  } catch (err) {
    console.error("[safety] could not record the screen for", screened.subject, err);
  }
  return record;
}

export interface ProductStanding {
  outcome: SafetyOutcome;
  subject: string;
  /** the builder's calm line; empty when clear */
  line: string;
  signals: SafetySignal[];
}

const CLEAR: ProductStanding = Object.freeze({ outcome: "clear", subject: "", line: "", signals: [] });

/**
 * Where a plan's product stands right now. The screen's stored record, then a person's decision for that
 * product, and one fresh question the server can answer without a network: is the address on the phishing
 * list today? (A domain can be reported after its plan was written.)
 */
export function productStanding(job: Pick<InspectionJob, "productUrl" | "result"> | null | undefined): ProductStanding {
  if (!job) return CLEAR;
  const stored = safetyOfMap((job.result as { map?: { safety?: unknown } } | null)?.map);
  const subject = stored?.subject || screenSubject(job.productUrl ?? "");
  if (!subject) return CLEAR;
  let record: ProductSafetyRecord = stored ?? { version: 1, outcome: "clear", subject, host: subject.split("/")[0]!, hosts: [subject.split("/")[0]!], signals: [], lists: { phishing: "unavailable", safeBrowsing: "off", domainAge: "off" }, checkedAt: 0 };

  if (!record.signals.some((s) => s.id === "phishing_list")) {
    const list = phishingListNow();
    if (list) {
      for (const h of record.hosts.length > 0 ? record.hosts : [record.host]) {
        const v = phishingVerdict(h, list);
        if (v.verdict !== "listed") continue;
        record = { ...record, outcome: "refused", signals: [...record.signals, { id: "phishing_list", severity: "refuse", reason: `${h} is on a public list of reported phishing addresses (MetaMask's)`, seen: v.match ?? h }] };
        break;
      }
    }
  }
  const row = rowFor(subject);
  record = withReview(record, row?.decision ?? null, row?.decidedAt ?? 0);
  return { outcome: record.outcome, subject, line: builderSafetyLine(record), signals: record.signals };
}

export type LaunchSafety = { ok: true; hold: string | null } | { ok: false; message: string };

/**
 * THE DOOR. Asked wherever a launch starts, before money moves, beside `launchAllowed`. Refused: nothing
 * starts, and the builder reads why. Held: the launch goes on, and the test it becomes is marked held.
 */
export function launchSafety(jobId: string): LaunchSafety {
  let standing: ProductStanding;
  try {
    standing = productStanding(getInspectionJob(jobId));
  } catch (err) {
    // the screen already ran in the pipeline; a door that cannot read its record must not strand a launch
    console.error("[safety] could not read the standing of", jobId, err);
    return { ok: true, hold: null };
  }
  if (standing.outcome === "refused") return { ok: false, message: `${standing.line} Nothing was sent.` };
  return { ok: true, hold: standing.outcome === "hold" ? standing.subject : null };
}

/**
 * What a test's `safety_hold` is when it is recorded: the product under review, or null. Read from the test's
 * own inspection, so no caller has to remember to pass it. A product that came to be refused after its vault
 * was funded is recorded held too: the money is already there, and the test must not become public.
 */
export function holdForCampaign(publicCampaignId: string): string | null {
  try {
    const standing = productStanding(getInspectionJobByCampaign(publicCampaignId));
    return standing.outcome === "clear" ? null : standing.subject;
  } catch {
    return null;
  }
}

/** The builder's line for a plan or a live test, and whether the public may see it. */
export function safetyView(job: Pick<InspectionJob, "productUrl" | "result"> | null | undefined): { outcome: SafetyOutcome; line: string } | null {
  try {
    const s = productStanding(job);
    return s.outcome === "clear" ? null : { outcome: s.outcome, line: s.line };
  } catch {
    return null;
  }
}

/* ───────────────────────────────────────────────────────── the operator ── */

export interface ProductReviewItem {
  subject: string;
  productUrl: string;
  outcome: SafetyOutcome;
  reasons: string[];
  decision: "cleared" | "refused" | null;
  lastSeenAt: number;
  /** tests of this product that are held right now */
  heldTests: string[];
}

/** Products the screen held or refused, newest first; the ones still waiting for a person come first. */
export function listProductReviews(): ProductReviewItem[] {
  const held = db.select({ id: campaigns.id, safetyHold: campaigns.safetyHold }).from(campaigns).all().filter((c) => !!c.safetyHold);
  return db
    .select()
    .from(productScreens)
    .all()
    .filter((r) => r.outcome !== "clear" || r.decision)
    .sort((a, b) => Number(!!a.decision) - Number(!!b.decision) || b.lastSeenAt - a.lastSeenAt)
    .map((r) => ({
      subject: r.subject,
      productUrl: r.productUrl,
      outcome: r.outcome,
      reasons: (Array.isArray(r.signals) ? (r.signals as SafetySignal[]) : []).map((s) => s.reason),
      decision: r.decision ?? null,
      lastSeenAt: r.lastSeenAt,
      heldTests: held.filter((c) => c.safetyHold === r.subject).map((c) => c.id),
    }));
}

/**
 * A person's decision about one product. `cleared` lifts the hold from every test of it and lets it launch
 * and be public from now on; `refused` closes it to new launches (a test already live stays held, and keeps
 * paying the people in it).
 */
export function decideProduct(subjectRaw: string, decision: "cleared" | "refused", note?: string, now = nowSeconds()): { ok: boolean; subject: string; released: number; error?: string } {
  const subject = subjectRaw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  if (!subject || /\s/.test(subject)) return { ok: false, subject, released: 0, error: "name the product as the alert names it (a host, or host/path on a shared platform)" };
  const set = { decision, decidedAt: now, decisionNote: note?.slice(0, 300) ?? null };
  db.insert(productScreens)
    .values({ subject, productUrl: `https://${subject}`, jobId: null, outcome: "clear", signals: [] as unknown, firstSeenAt: now, lastSeenAt: now, ...set })
    .onConflictDoUpdate({ target: productScreens.subject, set })
    .run();
  let released = 0;
  if (decision === "cleared") {
    released = db.update(campaigns).set({ safetyHold: null }).where(eq(campaigns.safetyHold, subject)).run().changes;
  }
  return { ok: true, subject, released };
}
