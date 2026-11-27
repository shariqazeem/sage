import { describe, expect, it } from "vitest";
import { baselineKinds, dueNotices, QUIET_AFTER_SEC, type NoticeFacts } from "./due";

/**
 * WHICH MESSAGES A BUILDER IS DUE (due.ts): each once, each a counted fact, and in Sage's plain voice.
 */
const NOW = 1_800_000_000;
const facts = (over: Partial<NoticeFacts> = {}): NoticeFacts => ({
  product: "umanity.gives",
  url: "https://sagepays.xyz/t/abc",
  status: "live",
  openedAt: NOW - 3600,
  now: NOW,
  answers: 0,
  inFlight: 0,
  held: [],
  findingGroups: 0,
  findingAnswers: 0,
  paidPeople: 0,
  places: 10,
  full: false,
  publicWork: true,
  told: null,
  ...over,
});
const kinds = (f: NoticeFacts, sent: string[] = []) => dueNotices(f, new Set(sent)).map((n) => n.kind);

describe("which notices are due", () => {
  it("says nothing about a test that just opened", () => {
    expect(kinds(facts())).toEqual([]);
  });

  it("tells the first answer once", () => {
    const due = dueNotices(facts({ answers: 1, inFlight: 1 }));
    expect(due).toEqual([{ kind: "first-answer", text: "The first answer to your test of umanity.gives is in.\nhttps://sagepays.xyz/t/abc#people" }]);
    expect(kinds(facts({ answers: 3 }), ["first-answer"])).toEqual([]);
  });

  it("tells each answer that waits for the builder, once per answer, with the recorded reason", () => {
    const f = facts({ answers: 2, held: [{ submissionId: "s1", why: "It names nothing Sage saw behind the first screen." }, { submissionId: "s2", why: null }] });
    const due = dueNotices(f, new Set(["first-answer", "held:s1"]));
    expect(due).toEqual([{ kind: "held:s2", text: "An answer to your test of umanity.gives is waiting for you. Read it and decide whether it is paid.\nhttps://sagepays.xyz/t/abc#people" }]);
    expect(dueNotices(f, new Set(["first-answer"]))[0].text).toBe(
      "An answer to your test of umanity.gives is waiting for you. It names nothing Sage saw behind the first screen. Read it and decide whether it is paid.\nhttps://sagepays.xyz/t/abc#people",
    );
  });

  it("tells the findings the first time they have a group", () => {
    expect(kinds(facts({ answers: 3, findingGroups: 0 }), ["first-answer"])).toEqual([]);
    const due = dueNotices(facts({ answers: 7, findingGroups: 3, findingAnswers: 7 }), new Set(["first-answer"]));
    expect(due).toEqual([{ kind: "findings", text: "Sage grouped 7 answers to your test of umanity.gives into 3 findings.\nhttps://sagepays.xyz/t/abc#findings" }]);
  });

  it("tells the end with the count of people paid, and only when nothing is still being decided", () => {
    const done = facts({ status: "live", full: true, answers: 10, paidPeople: 10 });
    expect(dueNotices(done, new Set(["first-answer"]))).toEqual([
      { kind: "done", text: "Your test of umanity.gives has ended: 10 of 10 people paid. What they found is here.\nhttps://sagepays.xyz/t/abc#findings" },
    ]);
    expect(kinds(facts({ status: "cancelled", answers: 4, paidPeople: 3, inFlight: 1 }), ["first-answer"])).toEqual([]);
    expect(kinds(facts({ status: "cancelled", answers: 4, paidPeople: 3, held: [{ submissionId: "s9", why: null }] }), ["first-answer", "held:s9"])).toEqual([]);
    expect(dueNotices(facts({ status: "cancelled", places: 1 }))[0].text).toBe("Your test of umanity.gives has ended: 0 of 1 person paid.\nhttps://sagepays.xyz/t/abc");
    expect(kinds(facts({ status: "draft", full: true }))).toEqual([]);
  });

  it("tells a quiet first day once, and says only what Sage did", () => {
    const quiet = facts({ openedAt: NOW - QUIET_AFTER_SEC });
    expect(kinds(facts({ openedAt: NOW - QUIET_AFTER_SEC + 1 }))).toEqual([]);
    expect(dueNotices(facts({ ...quiet, told: 12 }))[0]).toEqual({
      kind: "quiet-24h",
      text: "Your test of umanity.gives has been open for a day and nobody has answered yet. Sage listed it on Earn and told 12 people who asked to hear about new tests. Sharing your own link fills it faster.\nhttps://sagepays.xyz/t/abc",
    });
    expect(dueNotices(facts({ ...quiet, told: 0 }))[0].text).toContain("Sage listed it on Earn. Sharing your own link fills it faster.");
    // a test for the builder's own people was never listed and nobody was told
    const own = dueNotices(facts({ ...quiet, publicWork: false, told: 12 }))[0].text;
    expect(own).toContain("Only people with your link can take part. Sharing that link is what fills it.");
    expect(own).not.toMatch(/Earn|told/);
    // one answer and it is no longer quiet; a test that ended is not quiet either
    expect(kinds(facts({ ...quiet, answers: 1 }), ["first-answer"])).toEqual([]);
    expect(kinds(facts({ ...quiet, status: "cancelled" }), ["done"])).toEqual([]);
    expect(kinds(quiet, ["quiet-24h"])).toEqual([]);
  });

  it("is written in Sage's voice: no emoji, no exclamation mark, people never users, and always the test's link", () => {
    const everything = dueNotices(facts({ status: "completed", answers: 5, paidPeople: 4, findingGroups: 2, findingAnswers: 4, held: [] }));
    const quiet = dueNotices(facts({ openedAt: NOW - 2 * QUIET_AFTER_SEC, told: 3 }));
    const held = dueNotices(facts({ answers: 1, held: [{ submissionId: "s1", why: "why" }] }));
    for (const n of [...everything, ...quiet, ...held]) {
      expect(n.text).not.toMatch(/!|\busers?\b|Deputy/);
      expect(n.text).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(n.text).toMatch(/\nhttps:\/\/sagepays\.xyz\/t\/abc(#people|#findings)?$/);
    }
    expect(everything.map((n) => n.kind)).toEqual(["first-answer", "findings", "done"]);
  });
});

describe("what is already true when a builder connects", () => {
  it("is not news, except an answer still waiting for them", () => {
    const due = dueNotices(facts({ status: "live", answers: 3, findingGroups: 1, findingAnswers: 2, held: [{ submissionId: "s1", why: null }] }));
    expect(baselineKinds(due)).toEqual(["first-answer", "findings"]);
  });
});
