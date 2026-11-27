import { describe, expect, it } from "vitest";
import { buildActivity, reasonWords, type ActivityEvent, type ActivityInput } from "./activity";

/**
 * WHAT SAGE DID (activity.ts): every line is a recorded row, newest first, and a missing row is a missing
 * line. Reasons are the recorded words.
 */
const A = "0x3a12…cd41";
const B = "0x77fe…0b02";
const ev = (over: Partial<ActivityEvent> & { kind: string; at: number }): ActivityEvent => ({ text: null, submissionId: null, txHash: null, amountBase: null, ...over });
const base = (over: Partial<ActivityInput> = {}): ActivityInput => ({
  product: "umanity.gives",
  run: null,
  sageReads: null,
  plan: null,
  opened: null,
  events: [],
  answers: new Map(),
  xPosts: [],
  channelPost: null,
  findings: null,
  ended: null,
  ...over,
});

describe("what Sage did", () => {
  it("is empty when nothing is on record", () => {
    expect(buildActivity(base())).toEqual([]);
  });

  it("says each recorded thing once, newest first", () => {
    const items = buildActivity(
      base({
        run: { at: 100, steps: 10, seconds: 46 },
        plan: { at: 200, missions: 3, places: 20 },
        opened: { at: 300, fundedBase: 20_000_000, places: 20, network: "Metis", vaultUrl: "https://explorer.example/address/0xvault" },
        events: [
          ev({ kind: "work_announced", at: 400, text: "Told 12 of 30 on the roster about this work" }),
          ev({ kind: "settled", at: 600, submissionId: "s1", txHash: "0xaaa", amountBase: 2_000_000, text: A }),
          ev({ kind: "autopay_settled", at: 601, submissionId: "s1", txHash: "0xaaa", amountBase: 2_000_000, text: `${A} · 91% · dec d1` }),
          ev({ kind: "autopay_held", at: 700, submissionId: "s2", text: `${B} · Sage's model was not available to read this answer (observation_review)` }),
        ],
        answers: new Map([
          ["s1", { handle: A, status: "paid", rejectReason: null }],
          ["s2", { handle: B, status: "pending", rejectReason: null }],
        ]),
        xPosts: [{ kind: "mission", at: 450, url: "https://x.com/i/status/1" }],
        channelPost: { at: 460, url: "https://t.me/sagetests/9" },
        findings: { at: 800, answers: 7, groups: 3 },
        ended: { at: 900, how: "full", paid: 20, total: 20 },
      }),
    );
    expect(items.map((i) => [i.kind, i.text, i.href ?? null])).toEqual([
      ["ended", "Every place is paid: 20 of 20 people paid. The test is done.", null],
      ["findings", "Sage grouped 7 answers into 3 findings.", null],
      ["held", `Sage held ${B}'s answer for you: Sage's model was not available to read this answer.`, null],
      ["paid", `Sage checked ${A}'s answer and paid $2.00.`, "/proof/0xaaa"],
      ["posted-channel", "Sage posted your test in its Telegram channel.", "https://t.me/sagetests/9"],
      ["posted-x", "Sage posted your test on X.", "https://x.com/i/status/1"],
      ["announced", "Sage told 12 people who asked to hear about new tests.", null],
      ["opened", "The test opened: $20.00 for 20 places, held in its own vault on Metis.", "https://explorer.example/address/0xvault"],
      ["planned", "Sage wrote 3 missions with 20 places.", null],
      ["tried", "Sage opened umanity.gives in a real browser: 10 steps in 46 s.", null],
    ]);
    // newest first
    for (let i = 1; i < items.length; i += 1) expect(items[i].at).toBeLessThanOrEqual(items[i - 1].at);
  });

  it("says Sage read a listing where it could not try the product itself", () => {
    const [item] = buildActivity(base({ product: "apps.apple.com", sageReads: "the store listing", run: { at: 1, steps: 2, seconds: 9 } }));
    expect(item.text).toBe("Sage read the store listing for apps.apple.com.");
  });

  it("never claims a run that has no steps, a plan with no missions or findings with no groups", () => {
    expect(buildActivity(base({ run: { at: 1, steps: 0, seconds: null }, plan: { at: 2, missions: 0, places: 0 }, findings: { at: 3, answers: 2, groups: 0 } }))).toEqual([]);
  });

  it("says a payout a person released as released, and one payout as one line", () => {
    const items = buildActivity(
      base({
        events: [ev({ kind: "settled", at: 10, submissionId: "s1", txHash: "0xbbb", amountBase: 1_500_000, text: A })],
        answers: new Map([["s1", { handle: A, status: "paid", rejectReason: null }]]),
      }),
    );
    expect(items).toEqual([{ at: 10, kind: "paid", text: `${A}'s answer was released and Sage paid $1.50.`, href: "/proof/0xbbb" }]);
  });

  it("is silent about a roster nobody on was told from", () => {
    expect(buildActivity(base({ events: [ev({ kind: "work_announced", at: 5, text: "Told 0 of 4 on the roster about this work" })] }))).toEqual([]);
  });

  it("says the latest hold of an answer only, and never a hold that just asks the tester for more", () => {
    const items = buildActivity(
      base({
        events: [
          ev({ kind: "autopay_held", at: 10, submissionId: "s1", text: `${A} · Held for the tester to refine — attempt 1 of 3, no action needed yet (observation_retry)` }),
          ev({ kind: "autopay_held", at: 20, submissionId: "s2", text: `${B} · first reason` }),
          ev({ kind: "autopay_held", at: 30, submissionId: "s2", text: `${B} · second reason` }),
        ],
        answers: new Map([
          ["s1", { handle: A, status: "pending", rejectReason: null }],
          ["s2", { handle: B, status: "pending", rejectReason: null }],
        ]),
      }),
    );
    expect(items).toEqual([{ at: 30, kind: "held", text: `Sage held ${B}'s answer for you: second reason.` }]);
  });

  it("reads an answer the journal closed as not paid, in the recorded words", () => {
    const why = "every slot on this mission was paid before this answer could be";
    const items = buildActivity(
      base({
        events: [ev({ kind: "autopay_held", at: 10, submissionId: "s1", text: `${A} · ${why}` })],
        answers: new Map([["s1", { handle: A, status: "rejected", rejectReason: why }]]),
      }),
    );
    expect(items[0]).toEqual({ at: 10, kind: "not-paid", text: `Sage did not pay ${A}: ${why}.` });
  });

  it("says a revoked payout, a decline by hand and the builder's flag, each once", () => {
    const items = buildActivity(
      base({
        events: [
          ev({ kind: "submission_rejected", at: 10, submissionId: "s1", text: `${A} · it matched another answer almost word for word` }),
          ev({ kind: "submission_rejected", at: 20, submissionId: "s2", text: B }),
          ev({ kind: "submission_rejected", at: 25, submissionId: "s4", text: "0x4444…4444" }),
          ev({ kind: "submission_rejected", at: 30, submissionId: "s3", text: "The builder said: this is our competitor's site" }),
          ev({ kind: "builder_flagged", at: 30, submissionId: "s3", text: "this is our competitor's site" }),
        ],
        answers: new Map([
          ["s1", { handle: A, status: "rejected", rejectReason: "x" }],
          ["s2", { handle: B, status: "rejected", rejectReason: "Did not try the product." }],
          ["s3", { handle: "0x9999…9999", status: "rejected", rejectReason: "The builder said: this is our competitor's site" }],
          ["s4", { handle: "0x4444…4444", status: "rejected", rejectReason: "The builder said: they tried the old version" }],
        ]),
      }),
    );
    expect(items.map((i) => [i.kind, i.text])).toEqual([
      ["flagged", "You said 0x9999…9999's answer wasn't a real try: this is our competitor's site."],
      ["not-paid", "You declined 0x4444…4444's answer: they tried the old version."],
      ["not-paid", `${B}'s answer was declined: Did not try the product.`],
      ["not-paid", `Sage did not pay ${A}: it matched another answer almost word for word.`],
    ]);
  });

  it("skips an event whose answer is not on record, rather than naming nobody", () => {
    expect(buildActivity(base({ events: [ev({ kind: "settled", at: 1, submissionId: "gone", txHash: "0x1", amountBase: 1 })] }))).toEqual([]);
  });

  it("says a stopped test only when a row carries its time", () => {
    const [item] = buildActivity(base({ ended: { at: 50, how: "stopped", paid: 1, total: 5 } }));
    expect(item.text).toBe("The test was stopped: 1 of 5 people paid.");
  });
});

describe("a recorded reason as the end of a sentence", () => {
  it("drops the wallet the journal leads with, the log's token and the final stop", () => {
    expect(reasonWords("0x3a12…cd41 · It met Sage's bar. (observation_verified)")).toBe("It met Sage's bar");
    expect(reasonWords("few matches (few_matches(2<3))")).toBe("few matches");
    expect(reasonWords("  ")).toBeNull();
    expect(reasonWords(null)).toBeNull();
    // a parenthesis that is words, not a token, is kept
    expect(reasonWords("held (it was late)")).toBe("held (it was late)");
  });
});

describe("reasonWords never shows an engineering name", () => {
  it("renames the payout brain and says what its shorthand means", () => {
    expect(reasonWords("0xcCbF…768D · Deputy recommends hold")).toBe("Sage was not sure it was a real try");
    expect(reasonWords("Held: the Deputy wants a second look")).toBe("Held: Sage wants a second look");
  });
});
