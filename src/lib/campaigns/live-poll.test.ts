import { describe, expect, it } from "vitest";
import {
  briefFingerprint,
  diffLive,
  isTerminalStatus,
  payloadVersion,
  shouldKeepPolling,
  workerShouldPoll,
  type PollSub,
} from "./live-poll";

const sub = (over: Partial<PollSub> = {}): PollSub => ({
  id: "s1",
  status: "pending",
  hasBrief: false,
  briefFingerprint: "0",
  autopayState: null,
  payoutTx: null,
  ...over,
});

describe("shouldKeepPolling — start/stop conditions", () => {
  it("polls while a pending submission has no brief yet (any campaign)", () => {
    expect(shouldKeepPolling([sub({ hasBrief: false })], "manual")).toBe(true);
  });

  it("stops on a manual campaign once the pending submission has its brief", () => {
    expect(shouldKeepPolling([sub({ hasBrief: true })], "manual")).toBe(false);
  });

  it("keeps polling a briefed-but-pending submission on an AUTOPILOT campaign", () => {
    // the Deputy may still settle or hold it — the screen will change.
    expect(shouldKeepPolling([sub({ hasBrief: true })], "autopilot")).toBe(true);
  });

  it("polls while any submission is mid-settle", () => {
    expect(shouldKeepPolling([sub({ status: "settling", hasBrief: true })], "manual")).toBe(true);
  });

  it("stops when every submission is terminal", () => {
    const subs = [
      sub({ id: "a", status: "paid", hasBrief: true, payoutTx: "0xabc" }),
      sub({ id: "b", status: "rejected", hasBrief: true }),
      sub({ id: "c", status: "blocked", hasBrief: true }),
    ];
    expect(shouldKeepPolling(subs, "autopilot")).toBe(false);
    expect(shouldKeepPolling(subs, "manual")).toBe(false);
  });

  it("stops for an approved submission awaiting a manual settle (poster drives it)", () => {
    expect(shouldKeepPolling([sub({ status: "approved", hasBrief: true })], "manual")).toBe(false);
  });

  it("no submissions → nothing to poll", () => {
    expect(shouldKeepPolling([], "autopilot")).toBe(false);
  });
});

describe("workerShouldPoll / isTerminalStatus", () => {
  it("polls a non-terminal own submission, stops on terminal", () => {
    expect(workerShouldPoll("pending")).toBe(true);
    expect(workerShouldPoll("approved")).toBe(true);
    expect(workerShouldPoll("settling")).toBe(true);
    expect(workerShouldPoll("paid")).toBe(false);
    expect(workerShouldPoll("rejected")).toBe(false);
    expect(workerShouldPoll("blocked")).toBe(false);
  });

  it("classifies terminal statuses", () => {
    expect(isTerminalStatus("paid")).toBe(true);
    expect(isTerminalStatus("blocked")).toBe(true);
    expect(isTerminalStatus("pending")).toBe(false);
  });
});

describe("payloadVersion — unchanged-payload no-op", () => {
  it("is identical for an unchanged snapshot (client skips the re-render)", () => {
    const a = [sub({ id: "a" }), sub({ id: "b", status: "paid", hasBrief: true, payoutTx: "0x1" })];
    const b = [sub({ id: "a" }), sub({ id: "b", status: "paid", hasBrief: true, payoutTx: "0x1" })];
    expect(payloadVersion(a)).toBe(payloadVersion(b));
  });

  it("changes when a brief arrives", () => {
    const before = payloadVersion([sub({ hasBrief: false, briefFingerprint: "0" })]);
    const after = payloadVersion([sub({ hasBrief: true, briefFingerprint: "llm:pay:all_criteria_met:92" })]);
    expect(before).not.toBe(after);
  });

  it("changes when status, autopay, or payout tx changes", () => {
    const base = payloadVersion([sub()]);
    expect(payloadVersion([sub({ status: "paid" })])).not.toBe(base);
    expect(payloadVersion([sub({ autopayState: "held" })])).not.toBe(base);
    expect(payloadVersion([sub({ payoutTx: "0xdead" })])).not.toBe(base);
  });

  it("changes when the brief content upgrades (heuristic → llm) even if status holds", () => {
    const h = payloadVersion([sub({ hasBrief: true, briefFingerprint: briefFingerprint({ engine: "heuristic", recommendation: "review", confidence: 0.5 }) })]);
    const l = payloadVersion([sub({ hasBrief: true, briefFingerprint: briefFingerprint({ engine: "llm", recommendation: "pay", reasonCode: "all_criteria_met", confidence: 0.92 }) })]);
    expect(h).not.toBe(l);
  });
});

describe("diffLive — animation triggers", () => {
  it("reports a brief arrival exactly once (null → present)", () => {
    const prev = [sub({ id: "a", hasBrief: false })];
    const next = [sub({ id: "a", hasBrief: true, briefFingerprint: "llm:pay:x:90" })];
    expect(diffLive(prev, next)).toEqual({ briefArrived: ["a"], settled: [] });
    // a resend of the same state fires nothing
    expect(diffLive(next, next)).toEqual({ briefArrived: [], settled: [] });
  });

  it("reports a settle when a submission reaches paid with a tx", () => {
    const prev = [sub({ id: "a", status: "pending", hasBrief: true })];
    const next = [sub({ id: "a", status: "paid", hasBrief: true, payoutTx: "0xfeed", autopayState: "settled" })];
    expect(diffLive(prev, next)).toEqual({ briefArrived: [], settled: ["a"] });
    expect(diffLive(next, next).settled).toEqual([]); // idempotent
  });

  it("does not fire for a paid row that lacks a tx (never fabricate a payout)", () => {
    const prev = [sub({ id: "a", status: "pending", hasBrief: true })];
    const next = [sub({ id: "a", status: "paid", hasBrief: true, payoutTx: null })];
    expect(diffLive(prev, next).settled).toEqual([]);
  });

  it("treats a brand-new submission with a brief as an arrival", () => {
    expect(diffLive([], [sub({ id: "new", hasBrief: true })]).briefArrived).toEqual(["new"]);
  });
});
