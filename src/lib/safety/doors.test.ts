// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { campaigns, campaignSharing, inspectionJobs, productScreens } from "@/lib/db/schema";
import { getInspectionJob } from "@/lib/db/inspection";
import { isHeldForReview, isPublicWork } from "@/lib/campaigns/visibility";
import { setSharing, sharingFor } from "@/lib/sharing";
import { withoutSafetyDetail } from "@/lib/launch/job";
import { decideProduct, holdForCampaign, launchSafety, listProductReviews, productAlertText, productStanding, screenForJob } from "./index";
import { screenProduct, type ProductSafetyRecord } from "./product-screen";

/**
 * THE PRODUCT SAFETY SCREEN AT THE DOORS (real in-memory SQLite, no network, no model).
 *
 * Refused closes every launch before money moves. Held launches, and is never public. A person at Sage
 * clears it. And two structural checks hold the lists that would otherwise drift: every file that asks
 * `launchAllowed` also asks `launchSafety`, and every file that reads a campaign's `visibility` for
 * publicity also reads its hold.
 */
const SEED_FIELD: ProductSafetyRecord = screenProduct({
  url: "https://dapp-fix-portal.xyz/",
  observations: [],
  fieldTest: { ran: true, startUrl: "https://dapp-fix-portal.xyz/", mode: "interactive", pages: [], classification: null, limitation: null, durationMs: 1, states: [{ trigger: "initial load", screenshot: null, visibleTextExcerpt: "Connect Wallet", pixelDeltaPct: 0, url: "https://dapp-fix-portal.xyz/", notableElements: [{ tag: "textarea", text: "Secret Recovery Phrase", role: "textbox" }] }] } as never,
  kind: "wallet_dapp",
});
const HELD: ProductSafetyRecord = screenProduct({ url: "https://claim.zkr-foundation.xyz/", observations: [], kind: "wallet_dapp" });

function seedJob(productUrl: string, safety: ProductSafetyRecord | null): { id: string; campaignId: string } {
  const id = nanoid(12);
  const campaignId = `pub-${id}`;
  db.insert(inspectionJobs)
    .values({ id, founderWallet: "anonymous", idempotencyKey: nanoid(20), status: "ready", publicCampaignId: campaignId, productUrl, goal: "g", targetUsers: "u", totalBudgetBase: 1_000_000, tokenDecimals: 6, createdAt: 1, updatedAt: 1, result: { map: safety ? { safety } : {} } })
    .run();
  return { id, campaignId };
}
function seedCampaign(id: string, safetyHold: string | null): void {
  db.insert(campaigns).values({ id, title: "A test", rewardAmount: 1_000_000, vaultAddress: `0x${"a".repeat(40)}`, posterWallet: `0x${"b".repeat(40)}`, status: "live", createdAt: 1, safetyHold }).run();
}

beforeEach(() => {
  db.delete(productScreens).run();
  db.delete(campaignSharing).run();
  db.delete(campaigns).run();
  db.delete(inspectionJobs).run();
});

describe("the fixtures are what they say", () => {
  it("one refused, one held", () => {
    expect(SEED_FIELD.outcome).toBe("refused");
    expect(HELD).toMatchObject({ outcome: "hold", subject: "claim.zkr-foundation.xyz" });
  });
});

describe("launchSafety: the door before money moves", () => {
  it("a clear product, and a plan from before the screen existed, launch as always", () => {
    expect(launchSafety(seedJob("https://getdrops.app/", null).id)).toEqual({ ok: true, hold: null });
    expect(launchSafety("no-such-job")).toEqual({ ok: true, hold: null });
  });

  it("REFUSED: nothing starts, and the builder reads why, plainly", () => {
    const r = launchSafety(seedJob("https://dapp-fix-portal.xyz/", SEED_FIELD).id);
    expect(r).toEqual({ ok: false, message: "Sage can't run a test here: the page has a field that asks for a recovery phrase. Sage does not send testers to an address like that. If this is a mistake, tell us and a person at Sage will look. Nothing was sent." });
  });

  it("HELD: the launch goes on, and says which product is held", () => {
    expect(launchSafety(seedJob("https://claim.zkr-foundation.xyz/", HELD).id)).toEqual({ ok: true, hold: "claim.zkr-foundation.xyz" });
  });

  it("a person's decision is the last word, both ways", () => {
    const refused = seedJob("https://dapp-fix-portal.xyz/", SEED_FIELD);
    decideProduct("dapp-fix-portal.xyz", "cleared", "their own wallet's import page", 50);
    expect(launchSafety(refused.id)).toEqual({ ok: true, hold: null });

    const held = seedJob("https://claim.zkr-foundation.xyz/", HELD);
    decideProduct("https://claim.zkr-foundation.xyz/", "refused", undefined, 60);
    const r = launchSafety(held.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("a person at Sage reviewed claim.zkr-foundation.xyz and it stays closed");
  });

  it("the record a held test is written with comes from its own inspection", () => {
    const held = seedJob("https://claim.zkr-foundation.xyz/", HELD);
    expect(holdForCampaign(held.campaignId)).toBe("claim.zkr-foundation.xyz");
    expect(holdForCampaign(seedJob("https://getdrops.app/", null).campaignId)).toBeNull();
    expect(holdForCampaign("a-campaign-with-no-inspection")).toBeNull();
    // refused after the vault was funded: the money is in, so it is recorded, and recorded held
    expect(holdForCampaign(seedJob("https://dapp-fix-portal.xyz/", SEED_FIELD).campaignId)).toBe("dapp-fix-portal.xyz");
  });
});

describe("screenForJob: the record and the operator", () => {
  const ctx = { url: "https://claim.zkr-foundation.xyz/", observations: [], fieldTest: null, kind: "wallet_dapp" as const };

  it("tells the operator once per product and outcome, and writes it down first", async () => {
    const sent: string[] = [];
    const notify = async (t: string) => void sent.push(t);
    const first = await screenForJob("job-1", ctx, { notify, now: 100 });
    expect(first.outcome).toBe("hold");
    expect(first.lists.phishing).toBe("unavailable"); // the suite never fetches the list
    await screenForJob("job-2", ctx, { notify, now: 200 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("<b>A product is held for review</b>");
    expect(sent[0]).toContain("node scripts/review.mjs clear-product claim.zkr-foundation.xyz");
    const row = db.select().from(productScreens).where(eq(productScreens.subject, "claim.zkr-foundation.xyz")).get()!;
    expect(row).toMatchObject({ outcome: "hold", alertedOutcome: "hold", alertedAt: 100, firstSeenAt: 100, lastSeenAt: 200, jobId: "job-2" });
  });

  it("a clear product leaves no row and no message", async () => {
    const sent: string[] = [];
    const r = await screenForJob("job-3", { url: "https://getdrops.app/", observations: [], fieldTest: null, kind: "website" }, { notify: async (t) => void sent.push(t) });
    expect(r.outcome).toBe("clear");
    expect(sent).toEqual([]);
    expect(db.select().from(productScreens).all()).toEqual([]);
  });

  it("a product a person cleared screens clear from then on, with what was noticed kept, and no new message", async () => {
    const sent: string[] = [];
    const notify = async (t: string) => void sent.push(t);
    await screenForJob("job-4", ctx, { notify, now: 100 });
    decideProduct("claim.zkr-foundation.xyz", "cleared", "the foundation's own claim page", 150);
    const again = await screenForJob("job-5", ctx, { notify, now: 200 });
    expect(again).toMatchObject({ outcome: "clear", reviewed: { decision: "cleared", at: 150 } });
    expect(again.signals.map((s) => s.id)).toEqual(["bait_address"]);
    expect(sent).toHaveLength(1);
  });

  it("a failing alert never fails the screen", async () => {
    const r = await screenForJob("job-6", ctx, { notify: async () => { throw new Error("telegram is down"); }, now: 100 });
    expect(r.outcome).toBe("hold");
  });

  it("the alert escapes what a page said", () => {
    const text = productAlertText({ ...HELD, signals: [{ id: "drainer_words", severity: "hold", reason: "the screen shows <b>x</b>", seen: "<script>" }] }, "https://claim.zkr-foundation.xyz/?a=<b>");
    expect(text).not.toContain("<script>");
    expect(text).toContain("&lt;script&gt;");
  });
});

describe("a held test is never public", () => {
  it("the one predicate of public work", () => {
    expect(isPublicWork({ visibility: "listed", allowlist: null, safetyHold: null })).toBe(true);
    expect(isPublicWork({ visibility: "listed", allowlist: null, safetyHold: "claim.zkr-foundation.xyz" })).toBe(false);
    expect(isHeldForReview({ safetyHold: "" })).toBe(false);
    expect(isHeldForReview({})).toBe(false);
  });

  it("sharing is quiet while held, and the builder's own answers come back when it is cleared", () => {
    seedCampaign("t-held", "claim.zkr-foundation.xyz");
    setSharing("t-held", { postMission: true, postResult: true, findingsPublic: true }, 10);
    expect(sharingFor("t-held")).toEqual({ postMission: false, postResult: false, findingsPublic: false });
    // one switch turned while held never wipes the others
    setSharing("t-held", { postResult: false }, 11);
    expect(decideProduct("claim.zkr-foundation.xyz", "cleared", undefined, 20)).toEqual({ ok: true, subject: "claim.zkr-foundation.xyz", released: 1 });
    expect(db.select().from(campaigns).where(eq(campaigns.id, "t-held")).get()!.safetyHold).toBeNull();
    expect(sharingFor("t-held")).toEqual({ postMission: true, postResult: false, findingsPublic: true });
  });

  it("refusing a held product leaves its live test held (and paying): only clearing releases it", () => {
    seedCampaign("t-live", "claim.zkr-foundation.xyz");
    expect(decideProduct("claim.zkr-foundation.xyz", "refused", undefined, 20).released).toBe(0);
    expect(db.select().from(campaigns).where(eq(campaigns.id, "t-live")).get()!.safetyHold).toBe("claim.zkr-foundation.xyz");
  });

  it("clearing one product never releases another", () => {
    seedCampaign("t-a", "claim.zkr-foundation.xyz");
    seedCampaign("t-b", "t.me/uniswap_support_bot");
    decideProduct("claim.zkr-foundation.xyz", "cleared");
    expect(db.select().from(campaigns).where(eq(campaigns.id, "t-b")).get()!.safetyHold).toBe("t.me/uniswap_support_bot");
    expect(decideProduct("  ", "cleared").ok).toBe(false);
  });

  it("the operator's list: what waits for a person first, with the tests it holds", async () => {
    await screenForJob("job-7", { url: "https://claim.zkr-foundation.xyz/", observations: [], fieldTest: null, kind: "wallet_dapp" }, { notify: async () => {}, now: 100 });
    seedCampaign("t-list", "claim.zkr-foundation.xyz");
    expect(listProductReviews()).toEqual([{ subject: "claim.zkr-foundation.xyz", productUrl: "https://claim.zkr-foundation.xyz/", outcome: "hold", reasons: [HELD.signals[0]!.reason], decision: null, lastSeenAt: 100, heldTests: ["t-list"] }]);
  });
});

describe("what Sage noticed is the builder's to read", () => {
  it("somebody else's view of a refused plan says only that there is no test", () => {
    const line = "Sage can't run a test here: the page has a field that asks for a recovery phrase.";
    const view = { safety: { outcome: "refused" as const, line }, failureReason: line, result: { map: { safety: SEED_FIELD, productName: "x" }, questions: [], reason: line } };
    const out = withoutSafetyDetail(view);
    expect(JSON.stringify(out)).not.toContain("recovery phrase");
    expect(out).toMatchObject({ safety: null, failureReason: "Sage did not run a test here.", result: { map: { productName: "x" } } });
    // nothing to hide leaves the view alone
    const plain = { safety: null, failureReason: null, result: null };
    expect(withoutSafetyDetail(plain)).toBe(plain);
  });

  it("the standing reads a stored record back", () => {
    const j = getInspectionJob(seedJob("https://claim.zkr-foundation.xyz/", HELD).id)!;
    expect(productStanding(j)).toMatchObject({ outcome: "hold", subject: "claim.zkr-foundation.xyz" });
    expect(productStanding(null).outcome).toBe("clear");
  });
});

/* ───────────────────────────────────────────────────── the lists that drift ── */

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const SRC = path.join(process.cwd(), "src");
const rel = (p: string) => path.relative(process.cwd(), p);

describe("every door, by construction", () => {
  const files = sources(SRC).map((p) => ({ p: rel(p), text: readFileSync(p, "utf8") }));

  it("every file that asks the plan (launchAllowed) also asks the product (launchSafety)", () => {
    const asks = files.filter((f) => /\blaunchAllowed\(/.test(f.text) && f.p !== "src/lib/plans/founder-plan.ts");
    expect(asks.length).toBeGreaterThanOrEqual(7);
    expect(asks.filter((f) => !/\blaunchSafety\(/.test(f.text)).map((f) => f.p)).toEqual([]);
  });

  it("the explicit approval asks too, and the record of a test reads its hold from its own inspection", () => {
    const text = (p: string) => files.find((f) => f.p === p)!.text;
    expect(text("src/app/api/launch/[id]/approve/route.ts")).toMatch(/launchSafety\(id\)/);
    expect(text("src/lib/campaigns/v2-setup.ts")).toMatch(/safetyHold: holdForCampaign\(preview\.publicCampaignId\)/);
    expect(text("src/lib/launch/job.ts")).toMatch(/screen: \(ctx\) => screenForJob\(jobId, ctx\)/);
  });

  it("every file that reads a campaign's visibility to decide publicity also reads its hold", () => {
    const readers = files.filter((f) => /\.visibility\s*(?:!==|===)\s*"listed"/.test(f.text));
    expect(readers.length).toBeGreaterThanOrEqual(3);
    expect(readers.filter((f) => !/safetyHold|isPublicWork|isHeldForReview/.test(f.text)).map((f) => f.p)).toEqual([]);
  });

  it("no settlement path reads the screen: a live test keeps paying its testers", () => {
    const money = files.filter((f) => /src\/lib\/(?:campaigns\/settle[-\w]*|deputy\/(?:pipeline|autopilot|brain-core|brain|campaign-vault|signer|finalization))\.ts$/.test(f.p));
    expect(money.length).toBeGreaterThanOrEqual(6);
    expect(money.filter((f) => /safetyHold|launchSafety|productStanding|@\/lib\/safety/.test(f.text)).map((f) => f.p)).toEqual([]);
  });
});

vi.setConfig({ testTimeout: 30_000 });
