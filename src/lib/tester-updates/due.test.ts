import { describe, expect, it } from "vitest";
import { dueTesterNotices, noticeFor, type AnswerFacts } from "./due";

/** What a tester is told about their own answer: one state, one message, once, in plain words. */
const facts = (over: Partial<AnswerFacts> = {}): AnswerFacts => ({
  submissionId: "s1",
  product: "umanity.gives",
  url: "https://sagepays.xyz/t/abc",
  status: "pending",
  rewardBase: 2_000_000,
  payoutTx: null,
  origin: "https://sagepays.xyz",
  reason: null,
  heldForBuilder: false,
  canImprove: false,
  at: 1000,
  ...over,
});

describe("the message for an answer", () => {
  it("says nothing while Sage is still checking", () => {
    expect(noticeFor(facts())).toBeNull();
    expect(noticeFor(facts({ status: "approved" }))).toBeNull();
    expect(noticeFor(facts({ status: "settling" }))).toBeNull();
  });

  it("says paid, with the amount and the receipt", () => {
    expect(noticeFor(facts({ status: "paid", payoutTx: "0xfeed" }))?.text).toBe("Sage paid you $2.00 for trying umanity.gives. Receipt: https://sagepays.xyz/proof/0xfeed");
    // paid with no receipt on record yet: wait for it
    expect(noticeFor(facts({ status: "paid" }))).toBeNull();
  });

  it("says not paid with the recorded reason, as the page shows it", () => {
    expect(noticeFor(facts({ status: "rejected", reason: "The builder said: you tried the old version." }))?.text).toBe(
      "Your answer on umanity.gives was not paid: The builder said: you tried the old version.",
    );
    expect(noticeFor(facts({ status: "blocked", reason: "The places filled up before this answer could be paid" }))?.text).toBe(
      "Your answer on umanity.gives was not paid: The places filled up before this answer could be paid.",
    );
    expect(noticeFor(facts({ status: "rejected" }))?.text).toBe("Your answer on umanity.gives was not paid.");
  });

  it("says Sage needs more while attempts remain, with the way back, and nothing about what Sage saw", () => {
    const n = noticeFor(facts({ canImprove: true, heldForBuilder: false }));
    expect(n?.kind).toBe("improve");
    expect(n?.text).toBe("Your answer on umanity.gives was not paid yet: Sage needs more of what you saw. You can improve it from the test page: https://sagepays.xyz/t/abc");
  });

  it("says the builder is reading it", () => {
    expect(noticeFor(facts({ heldForBuilder: true }))).toMatchObject({
      kind: "held",
      text: "Sage passed your answer on umanity.gives to its builder to read. You'll hear here when they decide.",
    });
  });

  it("is in Sage's voice: no emoji, no exclamation mark, never Deputy", () => {
    const all = [
      noticeFor(facts({ status: "paid", payoutTx: "0x1" })),
      noticeFor(facts({ status: "rejected", reason: "Great try!!  But no!" })),
      noticeFor(facts({ canImprove: true })),
      noticeFor(facts({ heldForBuilder: true })),
    ];
    for (const n of all) {
      expect(n?.text).not.toMatch(/!|Deputy/);
      expect(n?.text).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe("which messages are due", () => {
  const paid = facts({ submissionId: "a", status: "paid", payoutTx: "0x1", at: 500 });
  const held = facts({ submissionId: "b", heldForBuilder: true, at: 300 });

  it("sends each (answer, kind) once, oldest first", () => {
    expect(dueTesterNotices([paid, held], new Set()).map((n) => [n.submissionId, n.kind])).toEqual([["b", "held"], ["a", "paid"]]);
    expect(dueTesterNotices([paid, held], new Set(["a|paid"])).map((n) => n.submissionId)).toEqual(["b"]);
    // the same answer, later paid, is a new message
    const later = { ...held, status: "paid", payoutTx: "0x2", heldForBuilder: false, at: 900 };
    expect(dueTesterNotices([later], new Set(["b|held"])).map((n) => n.kind)).toEqual(["paid"]);
  });

  it("never tells someone what happened before they asked to be told", () => {
    const since = new Map([["a", 600], ["b", 200]]);
    expect(dueTesterNotices([paid, held], new Set(), since).map((n) => n.submissionId)).toEqual(["b"]);
  });
});
