import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WHO MAY READ THE FINDINGS. The owner, always, with the contacts people chose to share. Anyone,
 * only when the owner made them public, and then with no contact. Everyone else gets the same 404
 * as a test that doesn't exist.
 */
let signedIn: string | null = null;
const deferred: (() => Promise<unknown>)[] = [];
vi.mock("@/lib/auth/founder", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/founder")>()), getFounderAddress: async () => signedIn }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => Promise<unknown>) => void deferred.push(fn) }));

import { GET } from "./route";
import { createCampaign, createSubmission, recordEvent, updateSubmission } from "@/lib/db/campaigns";
import { setSharing } from "@/lib/sharing";
import { setKeepPosted } from "@/lib/report/keep-posted";

const OWNER = "0x00000000000000000000000000000000000000a1";
const STRANGER = "0x00000000000000000000000000000000000000b2";
let n = 0;
const wallet = () => `0x${(++n + 4096).toString(16).padStart(40, "0")}`;

function seed(status: "live" | "draft" | "stopped" = "live") {
  const c = createCampaign({ title: "Try my app", rewardAmount: 2_000_000, maxRecipients: 5, chainId: 1088, vaultAddress: wallet(), posterWallet: OWNER, status });
  const r = createSubmission({ campaignId: c.id, wallet: wallet(), note: "The pricing page 404s from the footer link." });
  if (!r.ok) throw new Error(r.error);
  const tx = `0x${(++n).toString(16).padStart(64, "0")}`;
  updateSubmission(r.submission.id, { status: "paid", payoutTx: tx, decidedAt: 1_800_000_000 });
  recordEvent({ campaignId: c.id, submissionId: r.submission.id, kind: "settled", txHash: tx, amount: 2_000_000 });
  setKeepPosted({ submissionId: r.submission.id, campaignId: c.id, kind: "email", contact: "tester@example.com" });
  return c;
}
const get = (id: string) => GET(new Request(`http://localhost/api/campaigns/${id}/findings`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  signedIn = null;
  deferred.length = 0;
});

describe("GET /api/campaigns/[id]/findings", () => {
  it("gives the owner everything, private or not, and queues the build their visit is due", async () => {
    const c = seed();
    signedIn = OWNER;
    const res = await get(c.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      campaignId: c.id,
      viewer: "owner",
      findingsPublic: false,
      peopleTried: 1,
      paid: { answers: 1, people: 1, totalBase: 2_000_000, totalUsd: "2.00" },
      notPaid: { total: 0, byReason: [] },
      checking: 0,
      engine: "plain",
      builtAt: null,
      rebuilding: true,
      keepPosted: { count: 1, contacts: [{ kind: "email", contact: "tester@example.com" }] },
    });
    expect(body.findings).toHaveLength(1);
    expect(body.findings[0]).toMatchObject({ title: "The pricing page 404s from the footer link", kind: "bug", count: 1, of: 1, quotes: [{ text: "The pricing page 404s from the footer link." }] });
    expect(body.changed).toBeNull();
    expect(deferred).toHaveLength(1);
  });

  it("404s a private test for a stranger and for someone signed out", async () => {
    const c = seed();
    expect((await get(c.id)).status).toBe(404);
    signedIn = STRANGER;
    expect((await get(c.id)).status).toBe(404);
    expect(deferred).toHaveLength(0);
  });

  it("keeps a live test's findings from the public while places are open, even when sharing is on", async () => {
    // NO CORPUS ORACLE: paid answers can be copied, so the public reads them only once no place is open
    const c = seed("live");
    setSharing(c.id, { findingsPublic: true });
    for (const who of [null, STRANGER]) {
      signedIn = who;
      expect((await get(c.id)).status).toBe(404);
    }
    signedIn = OWNER;
    expect((await get(c.id)).status).toBe(200);
  });

  it("gives anyone the public findings of a finished test, with every contact removed", async () => {
    const c = seed("stopped");
    setSharing(c.id, { findingsPublic: true });
    for (const who of [null, STRANGER]) {
      signedIn = who;
      const res = await get(c.id);
      expect(res.status).toBe(200);
      const text = await res.text();
      const body = JSON.parse(text);
      expect(body.viewer).toBe("public");
      expect(body.keepPosted).toEqual({ count: 1 });
      expect(text).not.toContain("tester@example.com");
      expect(body.findings[0].quotes[0].text).toBe("The pricing page 404s from the footer link.");
      expect(body.rebuilding).toBe(false);
    }
    expect(deferred).toHaveLength(0); // a public reader never starts a build
  });

  it("404s a draft to the public even when sharing is on, and a test that doesn't exist", async () => {
    const c = seed("draft");
    setSharing(c.id, { findingsPublic: true });
    expect((await get(c.id)).status).toBe(404);
    signedIn = OWNER;
    expect((await get(c.id)).status).toBe(200);
    expect((await get("nope")).status).toBe(404);
  });
  it("keeps a finished test's public findings from strangers while the builder's retest of the product is open", async () => {
    const { createInspectionJob } = await import("@/lib/db/inspection");
    const { setCampaignStatus } = await import("@/lib/db/campaigns");
    const job = (c: { id: string }) =>
      createInspectionJob({ founderWallet: OWNER, publicCampaignId: c.id, productUrl: "https://retest.example/", goal: "test it", targetUsers: "anyone", totalBudgetBase: BigInt(5_000_000), tokenDecimals: 6, planningRequestId: `req-retest-${++n}` });
    const first = seed();
    job(first);
    setCampaignStatus(first.id, "paused");
    setSharing(first.id, { findingsPublic: true });
    signedIn = STRANGER;
    expect((await get(first.id)).status).toBe(200);

    // a second test of the same product opens later: the first's answers go back to the owner alone
    const second = seed();
    const { db } = await import("@/lib/db");
    const { campaigns } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    db.update(campaigns).set({ createdAt: first.createdAt + 60 }).where(eq(campaigns.id, second.id)).run();
    job(second);
    expect((await get(first.id)).status).toBe(404);
    signedIn = OWNER;
    expect((await get(first.id)).status).toBe(200);

    // the retest ends: the public reads the first test's findings again
    setCampaignStatus(second.id, "paused");
    signedIn = STRANGER;
    expect((await get(first.id)).status).toBe(200);
  });
});
