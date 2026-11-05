import { describe, expect, it } from "vitest";
import { sageJobIdFrom, sageReceiptTxFrom, verifySageRecord, type SageJobRecord, type SagePayoutRecord, type SageRecordLookup } from "./sage-record";
import type { SageRecordContract } from "./contract";

/**
 * SAGE'S OWN RECORDS AS PROOF (5 Nov 2026). A founder asked to pay "whoever launches a job on sagepays.xyz".
 * The only proof on offer was a link that must show the worker's wallet, and a Sage job page never shows
 * who posted it: every honest worker would have been refused. These rules read Sage's database instead.
 */
const WORKER = "0x1111111111111111111111111111111111111111";
const FOUNDER = "0x2222222222222222222222222222222222222222";
const OTHER = "0x3333333333333333333333333333333333333333";
const VAULT = "0x4444444444444444444444444444444444444444";
const TX = `0x${"ab".repeat(32)}`;
const BOUNTY_AT = 1_793_800_000; // the bounty went live
const deps = {
  same: (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase(),
  isMainnet: (id: number) => id === 1088 || id === 2345,
  chainName: (id: number) => (id === 1088 ? "Metis" : id === 2345 ? "GOAT" : `chain ${id}`),
};
const job = (over: Partial<SageJobRecord> = {}): SageJobRecord => ({
  id: "gig-ABCdef1234",
  title: "Translate our onboarding guide into Spanish",
  posterWallet: WORKER,
  status: "live",
  chainId: 1088,
  createdAt: BOUNTY_AT + 600,
  vaultAddress: VAULT,
  fundedUsd: 6,
  missions: [{ title: "Translate the guide", criteria: ["Every section is translated", "The doc carries the wallet"] }],
  ...over,
});
const payout = (over: Partial<SagePayoutRecord> = {}): SagePayoutRecord => ({
  tx: TX,
  wallet: WORKER,
  status: "paid",
  paidAt: BOUNTY_AT + 900,
  campaignId: "gig-other00001",
  campaignTitle: "Write a short guide to Sage",
  chainId: 1088,
  amountUsd: 1,
  ...over,
});
const lookup = (j: SageJobRecord | null, p: SagePayoutRecord | null = null, used = 0, earlier = 0): SageRecordLookup => ({
  job: (id) => (j && j.id === id ? j : null),
  payout: (tx) => (p && p.tx === tx ? p : null),
  usedBy: () => used,
  earlier: () => earlier,
});
const LAUNCH: SageRecordContract = { kind: "sage_record", action: "launched_job" };
const PAID: SageRecordContract = { kind: "sage_record", action: "was_paid" };
const input = (evidenceUrl: string | null, over: object = {}) => ({ wallet: WORKER, evidenceUrl, note: null, bountyId: "gig-bounty0001", bountyCreatedAt: BOUNTY_AT, bountyFounder: FOUNDER, submissionId: "sub-1", ...over });

describe("reading the record a worker points at", () => {
  it("finds a job in any of Sage's job links, and only on Sage", () => {
    expect(sageJobIdFrom("https://sagepays.xyz/c/gig-ABCdef1234")).toBe("gig-ABCdef1234");
    expect(sageJobIdFrom("https://www.sagepays.xyz/campaign/gig-ABCdef1234/")).toBe("gig-ABCdef1234");
    expect(sageJobIdFrom(null, "here it is: https://sagepays.xyz/c/gig-ABCdef1234.")).toBe("gig-ABCdef1234");
    expect(sageJobIdFrom("https://evil.example/c/gig-ABCdef1234")).toBeNull();
    expect(sageJobIdFrom("https://sagepays.xyz/pricing")).toBeNull();
  });
  it("finds a payout in a receipt link or a bare hash", () => {
    expect(sageReceiptTxFrom(`https://sagepays.xyz/proof/${TX}`)).toBe(TX);
    expect(sageReceiptTxFrom(null, `paid in ${TX.toUpperCase().replace("0X", "0x")}`)).toBe(TX);
    expect(sageReceiptTxFrom("https://sagepays.xyz/c/gig-x")).toBeNull();
  });
});

describe("launched_job", () => {
  const run = (j: SageJobRecord | null, url = "https://sagepays.xyz/c/gig-ABCdef1234", over: object = {}, used = 0, c = LAUNCH) =>
    verifySageRecord(c, input(url, over), lookup(j, null, used), deps);

  it("passes for a funded job the worker launched after this one went live, with Sage's facts and their words apart", () => {
    const o = run(job());
    expect(o.result.verified).toBe(true);
    expect(o.result.strength).toBe("deterministic");
    expect(o.facts.join(" ")).toMatch(/posted by the submitter's own account/);
    expect(o.facts.join(" ")).toMatch(/\$6\.00/);
    expect(o.authored.join(" ")).toMatch(/Translate the guide · 2 acceptance criteria/);
  });
  it("counts a job that is paused or already fully paid out: it was launched", () => {
    expect(run(job({ status: "paused" })).result.verified).toBe(true);
    expect(run(job({ status: "completed" })).result.verified).toBe(true);
  });
  it("refuses everything that is not that, each with words the worker can act on", () => {
    const cases: [string, ReturnType<typeof run>, RegExp][] = [
      ["no link", run(job(), "https://example.com/mine"), /link to the job you launched/],
      ["this job itself", run(job({ id: "gig-bounty0001" }), "https://sagepays.xyz/c/gig-bounty0001"), /link to this job/],
      ["unknown job", run(null), /no job at that link/],
      ["the sandbox", run(job({ sandbox: true })), /no job at that link/],
      ["another account's", run(job({ posterWallet: OTHER })), /another account/],
      ["the founder's own", run(job({ posterWallet: FOUNDER }), undefined, { wallet: FOUNDER }), /founder doesn't count/],
      ["a draft", run(job({ status: "draft" })), /hasn't been launched/],
      ["a stopped job", run(job({ status: "cancelled" })), /stopped and refunded/],
      ["no vault", run(job({ vaultAddress: `0x${"0".repeat(40)}` })), /hasn't been launched/],
      ["a test network", run(job({ chainId: 59902 })), /test network/],
      ["the wrong network", run(job({ chainId: 2345 }), undefined, {}, 0, { ...LAUNCH, chainId: 1088 }), /launched on Metis\. Yours is on GOAT/],
      ["before this job", run(job({ createdAt: BOUNTY_AT - 1 })), /before this one went live/],
      ["already submitted", run(job(), undefined, {}, 1), /counts once/],
    ];
    for (const [name, o, words] of cases) {
      expect(o.result.verified, name).toBe(false);
      expect(o.result.publicDetail, name).toMatch(words);
    }
  });
});

describe("first on Sage, and what kind of job it is", () => {
  it("says whether it is their first, and refuses an earlier one only when the job asks for a first", () => {
    const first = verifySageRecord(LAUNCH, input("https://sagepays.xyz/c/gig-ABCdef1234"), lookup(job({ kind: "testing" }), null, 0, 0), deps);
    expect(first.facts.join(" ")).toMatch(/It is a product test Sage planned\./);
    expect(first.facts.join(" ")).toMatch(/the first job they launched on Sage/);
    const third = verifySageRecord(LAUNCH, input("https://sagepays.xyz/c/gig-ABCdef1234"), lookup(job(), null, 0, 2), deps);
    expect(third.result.verified).toBe(true);
    expect(third.facts.join(" ")).toMatch(/had launched 2 jobs on Sage before this one/);
    const asked = verifySageRecord({ ...LAUNCH, first: true }, input("https://sagepays.xyz/c/gig-ABCdef1234"), lookup(job(), null, 0, 2), deps);
    expect(asked.result.verified).toBe(false);
    expect(asked.result.publicDetail).toMatch(/first job on Sage, and you had launched 2 before it/);
    const paidOnce = verifySageRecord({ kind: "sage_record", action: "was_paid", first: true }, input(`https://sagepays.xyz/proof/${TX}`), lookup(null, payout(), 0, 1), deps);
    expect(paidOnce.result.publicDetail).toMatch(/first payout on Sage, and Sage had paid you once before it/);
  });
});

describe("was_paid", () => {
  const run = (p: SagePayoutRecord | null, url = `https://sagepays.xyz/proof/${TX}`, used = 0) => verifySageRecord(PAID, input(url), lookup(null, p, used), deps);
  it("passes for a payout Sage made the worker after this job went live", () => {
    const o = run(payout());
    expect(o.result.verified).toBe(true);
    expect(o.facts.join(" ")).toMatch(/Sage paid the submitter's own account \(0x1111…|Sage paid the submitter's own account/);
  });
  it("refuses a payout that isn't theirs, isn't real, isn't new or is reused", () => {
    expect(run(null).result.publicDetail).toMatch(/no payout with that receipt/);
    expect(run(payout({ status: "approved" })).result.verified).toBe(false);
    expect(run(payout({ wallet: OTHER })).result.publicDetail).toMatch(/another account/);
    expect(run(payout({ campaignId: "gig-bounty0001" })).result.publicDetail).toMatch(/this job itself/);
    expect(run(payout({ chainId: 59902 })).result.publicDetail).toMatch(/test network/);
    expect(run(payout({ paidAt: BOUNTY_AT - 5 })).result.publicDetail).toMatch(/before this job went live/);
    expect(run(payout(), undefined, 2).result.publicDetail).toMatch(/counts once/);
    expect(run(payout(), "https://sagepays.xyz/c/gig-x").result.publicDetail).toMatch(/receipt link/);
  });
});
