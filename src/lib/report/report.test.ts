import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { campaignFindings, keepPosted } from "@/lib/db/schema";
import { createCampaign, createSubmission, recordEvent, updateSubmission, CAMPAIGN_STOPPED_REASON } from "@/lib/db/campaigns";
import { buildFindings, findingsView, openFindings, PLAIN_ENGINE, queueDueFindings, rebuildDue, REBUILD_COOLDOWN_SEC, refreshFindings, storedFindings, type BuildDeps } from "./index";
import { setKeepPosted } from "./keep-posted";
import { OTHER_NOTES } from "./core";

/**
 * The report end to end against the real tables: built from paid answers only, rebuilt only when
 * their number changes and never inside the cooldown, and never a dead end without a model.
 */
let n = 0;
const wallet = () => `0x${(++n).toString(16).padStart(40, "0")}`;
const T0 = 1_800_000_000;

function test_(title = "Try my app") {
  return createCampaign({ title, rewardAmount: 2_000_000, maxRecipients: 10, chainId: 1088, vaultAddress: wallet(), posterWallet: wallet(), status: "live" });
}
function answer(campaignId: string, note: string | null, status: "paid" | "pending" | "rejected" = "paid", extra: { rejectReason?: string } = {}) {
  const r = createSubmission({ campaignId, wallet: wallet(), note });
  if (!r.ok) throw new Error(r.error);
  const tx = `0x${(++n).toString(16).padStart(64, "0")}`;
  if (status === "paid") {
    updateSubmission(r.submission.id, { status, payoutTx: tx, decidedAt: T0 - 60 });
    recordEvent({ campaignId, submissionId: r.submission.id, kind: "settled", txHash: tx, amount: 2_000_000 });
  } else if (status === "rejected") {
    updateSubmission(r.submission.id, { status, decidedAt: T0 - 60, rejectReason: extra.rejectReason ?? null });
  }
  return r.submission.id;
}
/** a model that groups every answer it is shown into one finding, and claims nine people */
const groupsAll = (title = "Sign up is hard to find"): BuildDeps => ({
  modelConfigured: () => true,
  complete: vi.fn(async (opts) => {
    const ids = [...opts.user.matchAll(/ANSWER id=(\S+)/g)].map((m) => m[1]!);
    return { json: { groups: [{ title, kind: "stuck", count: 9, submissionIds: ids, quotes: [{ submissionId: ids[0], text: "never said this" }] }] }, model: "test-model", responseModel: "test-model-served" };
  }),
});
const noModel: BuildDeps = { modelConfigured: () => false };

beforeEach(() => {
  db.delete(campaignFindings).run();
  db.delete(keepPosted).run();
});

describe("buildFindings", () => {
  it("groups paid answers only, on the REPORT lane, and records the engine", async () => {
    const c = test_();
    const a = answer(c.id, "The sign up button is hidden on mobile.");
    const b = answer(c.id, "Could not find sign up at all.");
    answer(c.id, "I am still being checked.", "pending");
    answer(c.id, "Spam spam spam.", "rejected");
    const deps = groupsAll();
    const built = await buildFindings(c.id, deps, T0);
    expect(built.engine).toBe("test-model-served");
    expect(built.paidAnswers).toBe(2);
    expect(built.findings).toHaveLength(1);
    expect(built.findings[0]!.submissionIds.sort()).toEqual([a, b].sort());
    // the fabricated quote is gone; the finding carries a real first sentence instead
    expect(built.findings[0]!.quotes.map((q) => q.text)).not.toContain("never said this");
    const call = vi.mocked(deps.complete!).mock.calls[0]![0];
    expect(call.lane).toBe("REPORT");
    expect(call.user).not.toContain("still being checked");
    expect(call.user).not.toContain("Spam spam");
    expect(call.user).not.toMatch(/\$|2\.00|2000000/); // the model never sees a price
    expect(storedFindings(c.id)).toMatchObject({ paidAnswers: 2, engine: "test-model-served", builtAt: T0 });
  });

  it("builds plainly with no model, and says so", async () => {
    const c = test_();
    answer(c.id, "Checkout failed twice, then worked.");
    answer(c.id, "Nice onboarding. Clear steps.");
    const built = await buildFindings(c.id, noModel, T0);
    expect(built.engine).toBe(PLAIN_ENGINE);
    expect(built.findings.map((f) => f.title).sort()).toEqual(["Checkout failed twice", "Nice onboarding"]);
    expect(built.findings.find((f) => f.title === "Nice onboarding")!.quotes[0]!.text).toBe("Nice onboarding.");
  });

  it.each([
    ["out of credit or over the day's budget", new Error("llm_status_402")],
    ["no key", new Error("llm_not_configured")],
    ["a timeout", new Error("The operation was aborted")],
  ])("is never a dead end when the model fails: %s", async (_label, err) => {
    const c = test_();
    answer(c.id, "First thing I noticed was the slow load.");
    answer(c.id, "Search returned nothing for my query.");
    const built = await buildFindings(c.id, { modelConfigured: () => true, complete: async () => { throw err; } }, T0);
    expect(built.engine).toBe(PLAIN_ENGINE);
    expect(built.findings).toHaveLength(2);
  });

  it("builds plainly when the model's groups are all unusable", async () => {
    const c = test_();
    answer(c.id, "One real answer here.");
    answer(c.id, "Another real answer here.");
    const built = await buildFindings(c.id, { modelConfigured: () => true, complete: async () => ({ json: { groups: [{ title: "x", submissionIds: ["made-up"] }] }, model: "m" }) }, T0);
    expect(built.engine).toBe(PLAIN_ENGINE);
    expect(built.findings).toHaveLength(2);
  });

  it("asks no model about a single answer: there is nothing to group", async () => {
    const c = test_();
    answer(c.id, "Only me so far.");
    const deps = groupsAll();
    const built = await buildFindings(c.id, deps, T0);
    expect(deps.complete).not.toHaveBeenCalled();
    expect(built.engine).toBe(PLAIN_ENGINE);
  });
});

describe("when the findings are rebuilt", () => {
  it("only when the number of paid answers changed, and never inside ten minutes", () => {
    expect(rebuildDue(null, 0, T0)).toBe(false);
    expect(rebuildDue(null, 1, T0)).toBe(true);
    const stored = { paidAnswers: 3, builtAt: T0, engine: "m" };
    expect(rebuildDue(stored, 3, T0 + 10 * REBUILD_COOLDOWN_SEC)).toBe(false); // nothing changed
    expect(rebuildDue(stored, 4, T0 + REBUILD_COOLDOWN_SEC - 1)).toBe(false); // changed, cooling down
    expect(rebuildDue(stored, 4, T0 + REBUILD_COOLDOWN_SEC)).toBe(true);
  });

  it("retries a plain build only for a person's visit, and only past the cooldown", () => {
    const plain = { paidAnswers: 3, builtAt: T0, engine: PLAIN_ENGINE };
    expect(rebuildDue(plain, 3, T0 + REBUILD_COOLDOWN_SEC)).toBe(false);
    expect(rebuildDue(plain, 3, T0 + REBUILD_COOLDOWN_SEC, { upgrade: true })).toBe(true);
    expect(rebuildDue(plain, 3, T0 + 5, { upgrade: true })).toBe(false);
  });

  it("refreshes through the cooldown and the changed count", async () => {
    const c = test_();
    answer(c.id, "The first answer about pricing.");
    answer(c.id, "The second answer about pricing.");
    const deps = groupsAll();
    expect(await refreshFindings(c.id, { now: T0, deps })).not.toBeNull();
    expect(await refreshFindings(c.id, { now: T0 + 3600, deps })).toBeNull(); // same count
    answer(c.id, "A third person arrived.");
    expect(await refreshFindings(c.id, { now: T0 + 30, deps })).toBeNull(); // changed, inside the cooldown
    const again = await refreshFindings(c.id, { now: T0 + REBUILD_COOLDOWN_SEC, deps });
    expect(again?.paidAnswers).toBe(3);
    expect(deps.complete).toHaveBeenCalledTimes(2);
  });

  it("runs one build at a time per test", async () => {
    const c = test_();
    answer(c.id, "Answer one is here.");
    answer(c.id, "Answer two is here.");
    const deps = groupsAll();
    const [x, y] = await Promise.all([refreshFindings(c.id, { now: T0, deps }), refreshFindings(c.id, { now: T0, deps })]);
    expect(x).toBe(y);
    expect(deps.complete).toHaveBeenCalledTimes(1);
  });

  it("the sweep queues at most two tests a tick, the ones whose paid answers changed", async () => {
    db.delete(campaignFindings).run();
    const made = [test_("a"), test_("b"), test_("c")];
    for (const c of made) answer(c.id, "Something to report here.");
    const queued: (() => Promise<unknown>)[] = [];
    const first = queueDueFindings(T0, (fn) => queued.push(fn), noModel);
    expect(first.queued).toBe(2);
    expect(first.due).toBeGreaterThanOrEqual(3);
    await Promise.all(queued.map((fn) => fn()));
    const built = made.filter((c) => storedFindings(c.id)).length;
    expect(built).toBeLessThanOrEqual(2);
    // a built test is not due again until its count changes
    const second = queueDueFindings(T0 + 1, () => undefined, noModel);
    expect(second.due).toBe(first.due - 2);
  });
});

describe("the view", () => {
  it("counts people, money and refusals from the tables, never from the build", async () => {
    const c = test_();
    const a = answer(c.id, "Sign up is hidden on mobile.");
    answer(c.id, "Sign up took a while to find.");
    answer(c.id, "Waiting.", "pending");
    answer(c.id, "Late.", "rejected", { rejectReason: "this mission filled up before your submission could be released — every slot has been paid" });
    answer(c.id, "Late too.", "rejected", { rejectReason: "this mission filled up before your submission could be released — every slot has been paid" });
    answer(c.id, "Stopped.", "rejected", { rejectReason: CAMPAIGN_STOPPED_REASON });
    answer(c.id, "Odd.", "rejected", { rejectReason: "matches 0xabc…def too closely" });
    await buildFindings(c.id, groupsAll(), T0);
    const v = findingsView(c, "owner", false);
    expect(v.peopleTried).toBe(7);
    expect(v.paid).toEqual({ answers: 2, people: 2, totalBase: 4_000_000, totalUsd: "4.00" });
    expect(v.checking).toBe(1);
    expect(v.notPaid.total).toBe(4);
    expect(v.notPaid.byReason[0]).toEqual({ reason: "The places filled up before this answer could be paid", count: 2 });
    expect(v.findings[0]!.count).toBe(2); // the model said 9
    expect(v.findings[0]!.people.find((p) => p.submissionId === a)).toMatchObject({ paidBase: 2_000_000, receipt: expect.stringMatching(/^\/proof\/0x/) });
    expect(v.engine).toBe("test-model-served");
    // a free-text reason may name someone's wallet: the owner reads it, the public does not
    expect(v.notPaid.byReason.map((r) => r.reason)).toContain("matches 0xabc…def too closely");
    expect(findingsView(c, "public", true).notPaid.byReason.map((r) => r.reason)).toContain("Not accepted");
  });

  it("covers an answer paid after the last build, without waiting for a rebuild", async () => {
    const c = test_();
    answer(c.id, "First person here.");
    answer(c.id, "Second person here.");
    await buildFindings(c.id, groupsAll(), T0);
    const late = answer(c.id, "I came later and the export button did nothing.");
    const v = findingsView(c, "owner", false);
    const other = v.findings.find((f) => f.title === OTHER_NOTES)!;
    expect(other.people.map((p) => p.submissionId)).toEqual([late]);
    expect(other.quotes[0]!.text).toBe("I came later and the export button did nothing.");
  });

  it("shows contacts to the owner and only the number to anyone else, for paid answers", async () => {
    const c = test_();
    const paid = answer(c.id, "Liked it a lot.");
    const refused = answer(c.id, "Meh.", "rejected");
    setKeepPosted({ submissionId: paid, campaignId: c.id, kind: "x", contact: "@tester" }, T0);
    setKeepPosted({ submissionId: refused, campaignId: c.id, kind: "email", contact: "farm@example.com" }, T0);
    expect(findingsView(c, "owner", true).keepPosted).toEqual({ count: 1, contacts: [{ submissionId: paid, kind: "x", contact: "@tester", at: T0 }] });
    const pub = findingsView(c, "public", true);
    expect(pub.keepPosted).toEqual({ count: 1 });
    expect(JSON.stringify(pub)).not.toContain("@tester");
  });

  it("is plain and whole before anything was built, and the owner's visit queues the build", () => {
    const c = test_();
    answer(c.id, "Nothing built yet, but I was paid.");
    const queued: unknown[] = [];
    const v = openFindings(c, "owner", false, (fn) => queued.push(fn), T0, noModel);
    expect(v).toMatchObject({ engine: PLAIN_ENGINE, builtAt: null, rebuilding: true });
    expect(v.findings).toHaveLength(1);
    expect(queued).toHaveLength(1);
    // a public reader never starts a build
    const pub = openFindings(c, "public", true, (fn) => queued.push(fn), T0, noModel);
    expect(pub.rebuilding).toBe(false);
    expect(queued).toHaveLength(1);
  });
});
