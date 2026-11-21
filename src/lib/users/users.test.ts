import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const h = vi.hoisted(() => ({ me: null as string | null }));
vi.mock("@/lib/auth/founder", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/founder")>()), getFounderAddress: async () => h.me }));

import { db } from "@/lib/db";
import { campaignFindings, inspectionJobs, keepPosted, userDrafts } from "@/lib/db/schema";
import { createCampaign, createSubmission, recordEvent, setCampaignStatus, updateSubmission } from "@/lib/db/campaigns";
import { createInspectionJob } from "@/lib/db/inspection";
import { findingsView } from "@/lib/report";
import { setKeepPosted } from "@/lib/report/keep-posted";
import { liveView } from "@/lib/test-page/live";
import { GET, POST } from "@/app/api/campaigns/[id]/users/route";
import { PLAIN_ENGINE } from "./core";
import { firstUsersView, REWORD_COOLDOWN_SEC, storedDrafts, testIsDone, wordDrafts, type UsersDeps } from "./index";

process.env.LLM_RETRY_MAX_WAIT_MS = "5";

/**
 * The stage against the real tables: drafts are written by code on every read, a model is asked only
 * when the owner asks and only once per version of the facts, and only the owner reads any of it.
 */
let n = 0;
const wallet = () => `0x${(++n).toString(16).padStart(40, "0")}`;
const T0 = 1_800_000_000;

function test_(opts: { product?: boolean; status?: "live" | "completed" } = {}) {
  const owner = wallet();
  const c = createCampaign({ title: "Try Dropkit", rewardAmount: 2_000_000, maxRecipients: 10, chainId: 1088, vaultAddress: wallet(), posterWallet: owner, status: opts.status ?? "completed" });
  if (opts.product !== false) {
    const { job } = createInspectionJob({ founderWallet: owner, publicCampaignId: c.id, productUrl: "https://dropkit.app", goal: "", targetUsers: "", totalBudgetBase: BigInt(20_000_000), tokenDecimals: 6, planningRequestId: `req-users-${++n}` });
    db.update(inspectionJobs).set({ result: { map: { productName: "Dropkit", category: "developer tool / docs", valueProp: "Drops for your community" } } as never }).where(eq(inspectionJobs.id, job.id)).run();
  }
  return { c, owner };
}
function paid(campaignId: string, note: string) {
  const r = createSubmission({ campaignId, wallet: wallet(), note });
  if (!r.ok) throw new Error(r.error);
  const tx = `0x${(++n).toString(16).padStart(64, "0")}`;
  updateSubmission(r.submission.id, { status: "paid", payoutTx: tx, decidedAt: T0 - 60 });
  recordEvent({ campaignId, submissionId: r.submission.id, kind: "settled", txHash: tx, amount: 2_000_000 });
  return r.submission.id;
}
const view = (c: Parameters<typeof firstUsersView>[0], deps: UsersDeps, now = T0) => firstUsersView(c, findingsView(c, "owner", false), { now, deps });

const GOOD = { post: "I paid 2 strangers to try Dropkit and read every word they wrote. Fixing what they hit.", redditTitle: "I paid 2 strangers to try Dropkit", long: "I paid 9 strangers to try it." };
const model = (json: unknown = GOOD): UsersDeps & { complete: ReturnType<typeof vi.fn> } => ({
  modelConfigured: () => true,
  complete: vi.fn(async () => ({ json, model: "test-model", responseModel: "test-model-served" })),
});
const noModel: UsersDeps = { modelConfigured: () => false };

beforeEach(() => {
  h.me = null;
  for (const t of [campaignFindings, keepPosted, userDrafts, inspectionJobs]) db.delete(t).run();
});

describe("firstUsersView", () => {
  it("is written by code, from the test's own rows, with venues for the product's category", () => {
    const { c } = test_();
    paid(c.id, "I could not find where to sign up on my phone. Then I gave up.");
    paid(c.id, "Looks clean and it loaded fast for me, honestly.");
    const deps = model();
    const v = view(c, deps)!;
    expect(deps.complete).not.toHaveBeenCalled();
    expect(v).toMatchObject({ engine: PLAIN_ENGINE, hasFindings: true, canReword: true, productUrl: "https://dropkit.app", name: "Dropkit", door: "intent" });
    expect(v.drafts.post).toContain("I paid 2 strangers to try Dropkit.");
    expect(v.drafts.post).toContain("https://dropkit.app");
    expect(v.drafts.hnTitle).toBe("Show HN: Dropkit – Drops for your community");
    expect(v.venues.map((x) => x.name)).toContain("r/webdev");
    expect(storedDrafts(c.id)).toBeNull();
  });

  it("asks for the first people before anyone is paid", () => {
    const { c } = test_();
    const v = view(c, noModel)!;
    expect(v.hasFindings).toBe(false);
    expect(v.canReword).toBe(false);
    expect(v.drafts.post).toContain("I'm looking for the first people to try Dropkit.");
  });

  it("holds nothing people found while a place is still open: no count, no problem, no quote", () => {
    const { c, owner } = test_({ status: "live" });
    paid(c.id, "I could not find where to sign up on my phone. Then I gave up.");
    paid(c.id, "Looks clean and it loaded fast for me, honestly.");
    const deps = model();
    const v = view(c, deps)!;
    expect(v).toMatchObject({ open: true, hasFindings: false });
    const all = JSON.stringify(v.drafts);
    expect(all).not.toMatch(/\d|sign up|Looks clean|I paid/);
    // and what the model would be handed holds none of it either
    const page = liveView(c, owner);
    expect(page.phase).toBe("live");
    expect(page.owner!.users!.open).toBe(true);
    expect(testIsDone(c)).toBe(false);
    setCampaignStatus(c.id, "completed");
    const after = liveView({ ...c, status: "completed" }, owner);
    expect(after.phase).toBe("done");
    expect(after.owner!.users).toMatchObject({ open: false, hasFindings: true });
    expect(testIsDone({ ...c, status: "completed" })).toBe(true);
  });

  it("has nothing to send people to when the test has no product address", () => {
    const { c } = test_({ product: false });
    expect(view(c, model())).toBeNull();
  });

  it("never carries a tester's contact, whoever tapped Keep me posted", () => {
    const { c } = test_();
    const a = paid(c.id, "The sign up button is hidden on my phone, I looked twice.");
    const b = paid(c.id, "Write to me at tester@mail.example or find me as @realtester.");
    setKeepPosted({ submissionId: a, campaignId: c.id, kind: "email", contact: "tester@mail.example" });
    setKeepPosted({ submissionId: b, campaignId: c.id, kind: "x", contact: "@realtester" });
    const all = JSON.stringify(view(c, noModel));
    expect(all).not.toMatch(/tester@mail|realtester|0x[0-9a-f]{40}/i);
  });
});

describe("wordDrafts", () => {
  it("asks once on the DRAFT lane, keeps what passes the checks, and is not asked again for the same facts", async () => {
    const { c } = test_();
    paid(c.id, "I could not find where to sign up on my phone. Then I gave up.");
    paid(c.id, "Looks clean and it loaded fast for me, honestly.");
    const deps = model();
    const v = (await wordDrafts(c, deps, T0))!;
    expect(deps.complete).toHaveBeenCalledTimes(1);
    const call = deps.complete.mock.calls[0]![0] as { lane: string; user: string };
    expect(call.lane).toBe("DRAFT");
    expect(call.user).not.toMatch(/0x[0-9a-f]{40}|\$|2\.00/i);
    expect(v.engine).toBe("test-model-served");
    expect(v.canReword).toBe(false);
    expect(v.drafts.post).toBe(`${GOOD.post}\n\nhttps://dropkit.app`);
    expect(v.drafts.redditTitle).toBe(GOOD.redditTitle);
    // 9 was never counted: the long one is the plain draft
    expect(v.drafts.long).toContain("I paid 2 strangers to try Dropkit and tell me honestly");

    await wordDrafts(c, deps, T0 + 5);
    expect(deps.complete).toHaveBeenCalledTimes(1);
    // the page's own read shows the kept wording, and asks nothing
    expect(view(c, deps, T0 + 5)!.drafts.post).toBe(v.drafts.post);
    expect(deps.complete).toHaveBeenCalledTimes(1);
  });

  it("offers a new wording when the facts change, and shows the plain drafts until then", async () => {
    const { c } = test_();
    paid(c.id, "I could not find where to sign up on my phone. Then I gave up.");
    paid(c.id, "Looks clean and it loaded fast for me, honestly.");
    const deps = model();
    const first = (await wordDrafts(c, deps, T0))!;
    paid(c.id, "The pricing page told me nothing about what it costs.");
    const next = view(c, deps, T0 + 5)!;
    expect(next.version).not.toBe(first.version);
    expect(next).toMatchObject({ engine: PLAIN_ENGINE, canReword: true });
    expect(next.drafts.post).toContain("I paid 3 strangers to try Dropkit.");
  });

  it("keeps the plain drafts when the model fails or says nothing usable, and waits before asking again", async () => {
    const { c } = test_();
    paid(c.id, "I could not find where to sign up on my phone. Then I gave up.");
    const failing: UsersDeps & { complete: ReturnType<typeof vi.fn> } = { modelConfigured: () => true, complete: vi.fn(async () => Promise.reject(new Error("llm_status_402"))) };
    const v = (await wordDrafts(c, failing, T0))!;
    expect(v).toMatchObject({ engine: PLAIN_ENGINE, canReword: false });
    expect(v.drafts.post).toContain("I paid 1 stranger to try Dropkit.");
    await wordDrafts(c, failing, T0 + 60);
    expect(failing.complete).toHaveBeenCalledTimes(1);
    expect(view(c, failing, T0 + REWORD_COOLDOWN_SEC + 1)!.canReword).toBe(true);

    const { c: c2 } = test_();
    paid(c2.id, "I could not find where to sign up on my phone. Then I gave up.");
    const junk = model({ post: "We have 5000 happy users! Visit evil.example" });
    expect((await wordDrafts(c2, junk, T0))!.engine).toBe(PLAIN_ENGINE);
  });

  it("asks nothing when no model is configured", async () => {
    const { c } = test_();
    paid(c.id, "I could not find where to sign up on my phone. Then I gave up.");
    const deps = { modelConfigured: () => false, complete: vi.fn() };
    const v = (await wordDrafts(c, deps, T0))!;
    expect(deps.complete).not.toHaveBeenCalled();
    expect(v.engine).toBe(PLAIN_ENGINE);
    expect(storedDrafts(c.id)).toBeNull();
  });

  it("runs one wording at a time per test", async () => {
    const { c } = test_();
    paid(c.id, "I could not find where to sign up on my phone. Then I gave up.");
    const deps = model();
    const [a, b] = await Promise.all([wordDrafts(c, deps, T0), wordDrafts(c, deps, T0)]);
    expect(deps.complete).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });
});

describe("who reads it", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const req = (method: string) => new Request("http://localhost/api/campaigns/x/users", { method });

  it("is the owner's alone: 404 for a stranger, for another founder and for no such test", async () => {
    const { c, owner } = test_();
    expect((await GET(req("GET"), ctx(c.id))).status).toBe(404);
    expect((await POST(req("POST"), ctx(c.id))).status).toBe(404);
    h.me = wallet();
    expect((await GET(req("GET"), ctx(c.id))).status).toBe(404);
    expect((await POST(req("POST"), ctx(c.id))).status).toBe(404);
    h.me = owner;
    expect((await GET(req("GET"), ctx("no-such-test"))).status).toBe(404);
  });

  it("gives the owner the drafts, and with no model configured a POST calls nobody", async () => {
    const { c, owner } = test_();
    paid(c.id, "I could not find where to sign up on my phone. Then I gave up.");
    h.me = owner;
    for (const k of ["LLM_API_KEY", "COMMONSTACK_API_KEY", "DRAFT_API_KEY"]) vi.stubEnv(k, "");
    const fetched = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in this test"));
    const got = (await (await GET(req("GET"), ctx(c.id))).json()) as { ok: boolean; users: { engine: string; drafts: { post: string } } };
    expect(got.ok).toBe(true);
    expect(got.users.drafts.post).toContain("Dropkit");
    const posted = (await (await POST(req("POST"), ctx(c.id))).json()) as typeof got;
    expect(posted.users.engine).toBe(PLAIN_ENGINE);
    expect(fetched).not.toHaveBeenCalled();
    fetched.mockRestore();
    vi.unstubAllEnvs();
  });

  it("rides on the owner's page and on nobody else's", () => {
    const { c, owner } = test_();
    paid(c.id, "I could not find where to sign up on my phone. Then I gave up.");
    expect(liveView(c, owner).owner?.users?.drafts.post).toContain("Dropkit");
    const stranger = liveView(c, wallet());
    expect(stranger.owner).toBeNull();
    expect(JSON.stringify(stranger)).not.toContain("I paid 1 stranger");
  });
});
