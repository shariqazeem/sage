import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaignFindings, campaigns, coreAnswers } from "@/lib/db/schema";
import { createCampaign, getCampaign, createMission, createSubmission, recordEvent, setCampaignStatus, updateSubmission } from "@/lib/db/campaigns";
import { createInspectionJob } from "@/lib/db/inspection";
import { missionIdHash } from "@/lib/campaigns/mission-plan";
import { setCoreAnswer } from "@/lib/core-test/answers";
import { composeCoreAccount, CORE_MISSION_KEY, type Again, type Reached } from "@/lib/core-test/shape";
import { setSharing } from "@/lib/sharing";
import { CHANGE_WORDS, productKey, whatChanged, type TestSide } from "./changed";
import type { PaidAnswer } from "./core";
import { findingsView, previousTest } from "./index";
import { plainFindings } from "./plain";
import { DROPS } from "./plain.fixtures";
import { coreReport, rankFindings, type CoreTaps } from "./product";

/**
 * WHAT CHANGED SINCE YOUR LAST TEST. The builder fixed something and ran the test again: every number
 * here is counted from the two tests' own rows, a small test says it is small, and nothing is ever
 * called fixed.
 */
const core = (action: string) => composeCoreAccount(["A gifting app.", "The headline.", action, "Maybe."]);
const tapsOf = (rungs: ReadonlyMap<string, Reached>, again: Again = "maybe") => new Map<string, CoreTaps>([...rungs].map(([id, reached]) => [id, { reached, again: reached === "finished" ? "yes" : again }]));

function side(answers: PaidAnswer[], rungs: Map<string, Reached>): TestSide & { ranked: ReturnType<typeof rankFindings> } {
  const plain = { rungs };
  return {
    answers,
    plain,
    personOf: (id) => id,
    core: coreReport({ answers, taps: tapsOf(rungs), understood: [], says: null, mainAction: "start a drop" }),
    ranked: rankFindings(plainFindings(answers, plain), []),
  };
}

describe("the same product", () => {
  it("is the host and the path, whatever the scheme, the www, the slash or the query", () => {
    expect(productKey("https://www.Drops.example/app/?utm=x#top")).toBe("drops.example/app");
    expect(productKey("drops.example/app")).toBe("drops.example/app");
    expect(productKey("https://drops.example")).toBe("drops.example");
    expect(productKey("https://drops.example/other")).not.toBe(productKey("https://drops.example/app"));
    expect(productKey("")).toBeNull();
    expect(productKey(null)).toBeNull();
  });
});

describe("whatChanged: counted in code", () => {
  const then = side(DROPS.answers, DROPS.rungs);

  it("sets the counts side by side and marks each earlier problem fewer, still hit or gone", () => {
    // the builder fixed Continue; the wallet wall is still there; nobody failed to find the start
    const answers: PaidAnswer[] = [
      { id: "n1", text: core("Finished, sent a drop. Easy.") },
      { id: "n2", text: core("Finished it in a minute.") },
      { id: "n3", text: core("Sent one to a friend, worked.") },
      { id: "n4", text: core("Finished.") },
      { id: "n5", text: core("It asked me to connect a wallet and I don't have one.") },
      { id: "n6", text: core("It wants a wallet connection first, so I stopped.") },
      { id: "n7", text: core("Done, no problems.") },
      { id: "n8", text: core("The Continue button did nothing the first time, then it worked.") },
    ];
    const rungs = new Map<string, Reached>([["n1", "finished"], ["n2", "finished"], ["n3", "finished"], ["n4", "finished"], ["n5", "found-start"], ["n6", "found-start"], ["n7", "finished"], ["n8", "finished"]]);
    const c = whatChanged({ then, now: side(answers, rungs) })!;
    expect(c.people).toEqual({ then: 10, now: 8 });
    expect(c.small).toBeNull();
    expect(c.lines.map((l) => [l.key, `${l.then.n} of ${l.then.of} → ${l.now.n} of ${l.now.of}`])).toEqual([
      ["finished", "2 of 10 → 6 of 8"],
      ["again", "2 of 10 → 6 of 8"],
    ]);
    expect(c.problems.map((p) => [p.title, `${p.then.n} of ${p.then.of} → ${p.now.n} of ${p.now.of}`, p.change])).toEqual([
      ["I reached the form and the Continue button did nothing", "3 of 10 → 1 of 8", "fewer"],
      ["It wants a wallet connection before showing anything", "2 of 10 → 2 of 8", "still"],
      ["I couldn't find where to start", "2 of 10 → 0 of 8", "gone"],
    ]);
    // three people then is enough to say fewer; two is too few to call anything fixed
    expect(c.problems.map((p) => p.caution)).toEqual([null, null, "Too few people to call it fixed."]);
  });

  it("says a small test is small, and never says fixed", () => {
    const c = whatChanged({ then, now: side([{ id: "n1", text: core("Finished.") }, { id: "n2", text: core("Finished too.") }], new Map<string, Reached>([["n1", "finished"], ["n2", "finished"]])) })!;
    expect(c.small).toBe("Small numbers: 10 people then, 2 now. Read this as a direction, not as proof.");
    expect(c.problems.every((p) => p.change === "gone" && p.caution === "Too few people to call it fixed.")).toBe(true);
    const words = JSON.stringify([c, CHANGE_WORDS]).toLowerCase().replace(/too few people to call it fixed/g, "");
    expect(words).not.toMatch(/fixed|solved|resolved/);
  });

  it("fewer is by share of people, not by head count", () => {
    // 3 of 10 then; 2 of 4 now is a bigger share, so it is still hit
    const answers: PaidAnswer[] = [
      { id: "n1", text: core("The Continue button did nothing.") },
      { id: "n2", text: core("Pressed Continue and nothing happened.") },
      { id: "n3", text: core("Finished.") },
      { id: "n4", text: core("Finished.") },
    ];
    const rungs = new Map<string, Reached>([["n1", "started"], ["n2", "started"], ["n3", "finished"], ["n4", "finished"]]);
    const c = whatChanged({ then, now: side(answers, rungs) })!;
    expect(c.problems[0]).toMatchObject({ then: { n: 3, of: 10 }, now: { n: 2, of: 4 }, change: "still", caution: null });
  });

  it("counts a person once, however many answers they sent", () => {
    const answers: PaidAnswer[] = [
      { id: "n1", text: "The Continue button did nothing." },
      { id: "n2", text: "Again: the Continue button did nothing on my second try." },
      { id: "n3", text: "All good." },
    ];
    const now = { ...side(answers, new Map()), personOf: (id: string) => (id === "n3" ? "bob" : "alice") };
    const c = whatChanged({ then, now })!;
    expect(c.people.now).toBe(2);
    expect(c.problems[0]!.now).toEqual({ n: 1, of: 2 });
  });

  it("has nothing to say when either test has no paid answer", () => {
    expect(whatChanged({ then, now: side([], new Map()) })).toBeNull();
    expect(whatChanged({ then: side([], new Map()), now: then })).toBeNull();
  });
});

describe("against the real tables", () => {
  let n = 0;
  const wallet = () => `0x${(++n + 40960).toString(16).padStart(40, "0")}`;
  const T0 = 1_800_000_000;
  const FOUNDER = `0x${"f".repeat(39)}1`;
  beforeEach(() => {
    db.delete(campaignFindings).run();
    db.delete(coreAnswers).run();
  });

  function test_(productUrl: string, at: number, founder = FOUNDER) {
    const c = createCampaign({ title: "Try Drops", rewardAmount: 2_000_000, maxRecipients: 10, chainId: 1088, vaultAddress: wallet(), posterWallet: founder, status: "live" });
    db.update(campaigns).set({ createdAt: at }).where(eq(campaigns.id, c.id)).run();
    const hash = missionIdHash(c.id, CORE_MISSION_KEY);
    createMission({ campaignId: c.id, missionKey: CORE_MISSION_KEY, missionIdHash: hash, title: "Try Drops for the first time", rewardAmount: 2_000_000, maxCompletions: 10, evidenceList: ["What is it?", "One thing?", "You tried to start a drop. Which screens did you pass?", "Again?"] });
    createInspectionJob({ founderWallet: founder, publicCampaignId: c.id, productUrl, goal: "test it", targetUsers: "anyone", totalBudgetBase: BigInt(20_000_000), tokenDecimals: 6, planningRequestId: `req-${++n}` });
    const answer = (action: string, reached: Reached) => {
      const r = createSubmission({ campaignId: c.id, wallet: wallet(), note: core(action), missionIdHash: hash });
      if (!r.ok) throw new Error(r.error);
      const tx = `0x${(++n).toString(16).padStart(64, "0")}`;
      updateSubmission(r.submission.id, { status: "paid", payoutTx: tx, decidedAt: T0 + n });
      recordEvent({ campaignId: c.id, submissionId: r.submission.id, kind: "settled", txHash: tx, amount: 2_000_000 });
      setCoreAnswer({ submissionId: r.submission.id, campaignId: c.id, reached, again: reached === "finished" ? "yes" : "no" });
    };
    return { c: { ...c, createdAt: at }, answer };
  }

  it("finds the builder's last finished test of the same product, and shows what changed", () => {
    const first = test_("https://drops.example/", T0);
    first.answer("The Continue button did nothing.", "started");
    first.answer("Pressed Continue and nothing happened.", "started");
    first.answer("The Continue button does not respond.", "started");
    first.answer("Finished.", "finished");
    first.answer("Finished, easy.", "finished");
    setCampaignStatus(first.c.id, "paused");

    const second = test_("https://www.drops.example", T0 + 86_400);
    // nothing to compare until someone is paid
    expect(findingsView(second.c, "owner", false).changed).toBeNull();
    for (const a of ["Finished.", "Finished quickly.", "Sent a drop, worked.", "Done.", "Finished it."]) second.answer(a, "finished");

    expect(previousTest(second.c)?.id).toBe(first.c.id);
    expect(previousTest(first.c)).toBeNull();
    const v = findingsView(second.c, "owner", false);
    expect(v.changed).toMatchObject({ previous: { id: first.c.id, path: `/t/${first.c.id}` }, live: true, people: { then: 5, now: 5 }, small: null });
    expect(v.changed!.lines.find((l) => l.key === "finished")).toMatchObject({ then: { n: 2, of: 5 }, now: { n: 5, of: 5 } });
    expect(v.changed!.problems).toEqual([{ title: "The Continue button did nothing", then: { n: 3, of: 5 }, now: { n: 0, of: 5 }, change: "gone", caution: null }]);
    // the earlier test's own page compares with nothing: it is the first
    expect(findingsView(first.c, "owner", false).changed).toBeNull();
  });

  it("never compares with a test that is still taking answers, another product, or another builder", () => {
    const open = test_("https://apart.example/", T0);
    open.answer("The Continue button did nothing.", "started");
    const other = test_("https://apart.example/pricing", T0 + 10);
    other.answer("Could not find the price.", "first-screen");
    setCampaignStatus(other.c.id, "paused");
    const theirs = test_("https://apart.example/", T0 + 20, `0x${"e".repeat(39)}2`);
    theirs.answer("The Continue button did nothing.", "started");
    setCampaignStatus(theirs.c.id, "paused");

    const mine = test_("https://apart.example/", T0 + 86_400);
    mine.answer("Finished.", "finished");
    expect(previousTest(mine.c)).toBeNull();
    expect(findingsView(mine.c, "owner", false).changed).toBeNull();
    // once the open one ends, it is the last test
    setCampaignStatus(open.c.id, "paused");
    expect(previousTest(mine.c)?.id).toBe(open.c.id);
  });

  it("shows the public the comparison only when the earlier test's findings are public too", () => {
    const first = test_("https://public.example/", T0);
    first.answer("The Continue button did nothing.", "started");
    first.answer("Pressed Continue and nothing happened.", "started");
    setCampaignStatus(first.c.id, "paused");
    const second = test_("https://public.example/", T0 + 86_400);
    second.answer("Finished.", "finished");
    setCampaignStatus(second.c.id, "paused");
    setSharing(second.c.id, { findingsPublic: true });

    expect(findingsView(getCampaign(second.c.id)!, "owner", true).changed).not.toBeNull();
    const pub = findingsView(getCampaign(second.c.id)!, "public", true);
    expect(pub.changed).toBeNull();
    expect(JSON.stringify(pub)).not.toContain("Continue button did nothing");
    setSharing(first.c.id, { findingsPublic: true });
    expect(findingsView(getCampaign(second.c.id)!, "public", true).changed).toMatchObject({ live: false, small: "Small numbers: 2 people then, 1 now. Read this as a direction, not as proof." });
  });

  it("says where the people in a finding stopped, and how many they are out of", () => {
    const t = test_("https://rungs.example/", T0);
    t.answer("The Continue button did nothing.", "started");
    t.answer("Pressed Continue and nothing happened.", "started");
    t.answer("Finished.", "finished");
    const v = findingsView(t.c, "owner", false);
    expect(v.findings[0]).toMatchObject({ count: 2, of: 3, stoppedOn: "Started, couldn't finish", kind: "stuck" });
    expect(v.fixFirst[0]).toMatchObject({ from: "people", people: 2 });
  });
});
