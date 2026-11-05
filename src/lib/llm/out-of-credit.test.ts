import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOSED_FOR_MS, closedProviders, lastReopenedAt, onCreditChange, outOfCredit, postChat, providerMessage, resetWireMemory, type CreditEvent } from "./wire";
import { armCreditAlerts, creditAlertText, judgeOutOfCredit, OUTAGE_REPEAT_MS, probeClosedProviders, resetCreditAlerts } from "./credit-alert";
import { verifySubmission } from "@/lib/deputy/brain";
import { draftDirectCampaign, WRITER_OFFLINE } from "@/lib/launch/gig-draft";
import { LlmCompletionError } from "./complete";

/**
 * AN EMPTY MODEL ACCOUNT IS CLOSED, NOT BUSY (wire.ts section 4, credit-alert.ts).
 *
 * 5 Nov 2026: CommonStack answered every call "429 Insufficient available balance: 0". Every lane read it
 * as a rate limit: the judge burned its attempts in two seconds, the drafter made a founder wait on a
 * "rate limit", and nobody was told. These hold the fix: the provider's own words decide, the account is
 * answered from memory for a short while, the operator hears it once, and a top-up is noticed.
 */
const COMMONSTACK_EMPTY = '{"error":{"code":"rate_limit_exceeded","message":"Insufficient available balance: 0","type":"rate_limit_exceeded"}}';
const P = { endpoint: "https://api.commonstack.ai/v1/chat/completions", key: "sk-test-key-commonstack-0001", model: "minimax/minimax-m3", host: "api.commonstack.ai" };
const okBody = JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: {} });

function fetchSeq(...answers: { status: number; body: string }[]) {
  const calls: string[] = [];
  let i = 0;
  const impl = (async (url: string) => {
    calls.push(url);
    const a = answers[Math.min(i++, answers.length - 1)]!;
    return new Response(a.body, { status: a.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

beforeEach(() => {
  resetWireMemory();
  resetCreditAlerts();
});
afterEach(() => {
  vi.useRealTimers();
  for (const k of ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "PAYOUT_API_KEY", "PAYOUT_BASE_URL", "PAYOUT_MODEL"]) delete process.env[k];
});

describe("reading an empty account from the provider's own words", () => {
  it.each([
    ["CommonStack at $0", 429, COMMONSTACK_EMPTY],
    ["Anthropic, credit too low", 400, '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'],
    ["OpenAI, quota", 429, '{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota"}}'],
    ["OpenRouter", 402, '{"error":{"message":"Insufficient credits"}}'],
    ["DeepSeek", 402, '{"error":{"message":"Insufficient Balance"}}'],
  ])("%s is out of credit", (_n, status, body) => {
    expect(outOfCredit(status, body)).toBe(true);
  });

  it.each([
    ["a real rate limit with its cap", 429, '{"error":{"message":"Access key quota exceeded (cap 1)"}}'],
    ["a refused parameter", 400, '{"error":{"message":"`temperature` is deprecated for this model."}}'],
    ["a server error that mentions billing", 500, "billing service unavailable"],
    ["a plain too-many-requests", 429, "Too Many Requests"],
  ])("%s is not", (_n, status, body) => {
    expect(outOfCredit(status, body)).toBe(false);
  });

  it("keeps the provider's message short and free of anything key-like", () => {
    expect(providerMessage(COMMONSTACK_EMPTY)).toBe("Insufficient available balance: 0");
    const leaky = providerMessage('{"error":{"message":"balance too low for key sk-abcdef0123456789 on account 0123456789abcdef0123456789abcdef"}}');
    expect(leaky).not.toMatch(/sk-abcdef/);
    expect(leaky).not.toMatch(/0123456789abcdef0123456789abcdef/);
  });
});

describe("the wire, facing an empty account", () => {
  it("answers it as 402, so no caller retries it as a rate limit", async () => {
    const f = fetchSeq({ status: 429, body: COMMONSTACK_EMPTY });
    const res = await postChat(P, { model: P.model, messages: [] }, { timeoutMs: 5000, fetchImpl: f.impl });
    expect(res.status).toBe(402);
    expect(res.outOfCredit).toBe(true);
    expect(closedProviders()).toEqual([expect.objectContaining({ host: "api.commonstack.ai", message: "Insufficient available balance: 0" })]);
  });

  it("answers from memory inside the window, asks again after it, and clears on the first answer", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T09:00:00Z"));
    const events: CreditEvent[] = [];
    const off = onCreditChange((e) => events.push(e));
    const f = fetchSeq({ status: 429, body: COMMONSTACK_EMPTY }, { status: 200, body: okBody });
    await postChat(P, { model: P.model, messages: [] }, { timeoutMs: 5000, fetchImpl: f.impl });
    // inside the window: no network at all
    const again = await postChat(P, { model: P.model, messages: [] }, { timeoutMs: 5000, fetchImpl: f.impl });
    expect(again.status).toBe(402);
    expect(f.calls).toHaveLength(1);
    // past it: the provider is asked, answers, and the account is open again
    vi.setSystemTime(new Date(Date.now() + CLOSED_FOR_MS + 1));
    const back = await postChat(P, { model: P.model, messages: [] }, { timeoutMs: 5000, fetchImpl: f.impl });
    expect(back.ok).toBe(true);
    expect(f.calls).toHaveLength(2);
    expect(closedProviders()).toEqual([]);
    expect(lastReopenedAt()).toBe(Date.now());
    expect(events.map((e) => e.kind)).toEqual(["closed", "reopened"]);
    off();
  });

  it("closes only the key that is empty: another account on the same host still answers", async () => {
    const f = fetchSeq({ status: 429, body: COMMONSTACK_EMPTY }, { status: 200, body: okBody });
    await postChat(P, { model: P.model, messages: [] }, { timeoutMs: 5000, fetchImpl: f.impl });
    const other = await postChat({ ...P, key: "sk-test-key-commonstack-0002" }, { model: P.model, messages: [] }, { timeoutMs: 5000, fetchImpl: f.impl });
    expect(other.ok).toBe(true);
  });
});

describe("the operator hears it once, and hears it come back", () => {
  const closed: CreditEvent = { kind: "closed", host: "api.commonstack.ai", keyId: "abc", message: "Insufficient available balance: 0", since: 0 };

  it("says what is down, what it means, and what to do", () => {
    const t = creditAlertText(closed, 0);
    expect(t).toContain("api.commonstack.ai");
    expect(t).toContain("Insufficient available balance: 0");
    expect(t).toMatch(/Top up api\.commonstack\.ai/);
    expect(creditAlertText({ ...closed, kind: "reopened" }, 47 * 60_000)).toMatch(/about 47 min/);
  });

  it("one alert per outage, a reminder only after hours, and a recovery note only if it was told", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T09:00:00Z"));
    const sent: string[] = [];
    armCreditAlerts(async (t) => void sent.push(t));
    const f = fetchSeq({ status: 429, body: COMMONSTACK_EMPTY });
    await postChat(P, { model: P.model, messages: [] }, { timeoutMs: 5000, fetchImpl: f.impl });
    // re-arming (every sweep does) inside the repeat window replays nothing new
    armCreditAlerts(async (t) => void sent.push(t));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/can't reach its model/);
    vi.setSystemTime(new Date(Date.now() + OUTAGE_REPEAT_MS + 1));
    armCreditAlerts(async (t) => void sent.push(t));
    expect(sent).toHaveLength(2);
    // a top-up: the next answer clears it, and the operator is told
    vi.setSystemTime(new Date(Date.now() + CLOSED_FOR_MS + 1));
    await postChat(P, { model: P.model, messages: [] }, { timeoutMs: 5000, fetchImpl: fetchSeq({ status: 200, body: okBody }).impl });
    expect(sent).toHaveLength(3);
    expect(sent[2]).toMatch(/model is back/);
  });

  it("reports an account that emptied before anything was listening, as soon as it is armed", async () => {
    await postChat(P, { model: P.model, messages: [] }, { timeoutMs: 5000, fetchImpl: fetchSeq({ status: 429, body: COMMONSTACK_EMPTY }).impl });
    const sent: string[] = [];
    armCreditAlerts(async (t) => void sent.push(t));
    expect(sent).toHaveLength(1);
  });
});

describe("noticing a top-up without waiting for a stranger", () => {
  it("asks only empty accounts, and an answer reopens it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T09:00:00Z"));
    process.env.LLM_API_KEY = P.key;
    process.env.LLM_BASE_URL = "https://api.commonstack.ai/v1";
    process.env.LLM_MODEL = P.model;
    // healthy: nothing is asked
    const idle = fetchSeq({ status: 200, body: okBody });
    expect(await probeClosedProviders({ fetchImpl: idle.impl })).toEqual({ probed: 0, reopened: 0 });
    expect(idle.calls).toHaveLength(0);
    await postChat(P, { model: P.model, messages: [] }, { timeoutMs: 5000, fetchImpl: fetchSeq({ status: 429, body: COMMONSTACK_EMPTY }).impl });
    expect(judgeOutOfCredit()).toBe(true);
    vi.setSystemTime(new Date(Date.now() + CLOSED_FOR_MS + 1));
    const topped = fetchSeq({ status: 200, body: okBody });
    expect(await probeClosedProviders({ fetchImpl: topped.impl })).toEqual({ probed: 1, reopened: 1 });
    expect(topped.calls).toHaveLength(1);
    expect(judgeOutOfCredit()).toBe(false);
  });
});

describe("each lane, facing an empty account", () => {
  const input = { criteria: ["c"], evidenceUrl: "https://example.com/p", note: null, evidenceText: "c", evidenceOk: true, contentSha256: null } as never;

  it("the judge stops after one refused attempt and goes to the fallback", async () => {
    const brief = { criteria: [{ criterion: "c", met: true, confidence: 0.95, quote: null }], fraudSignals: [], recommendation: "pay", reasonCode: "all_criteria_met", confidence: 0.9, summary: "ok" };
    const hosts: string[] = [];
    const fetchImpl = (async (url: string) => {
      hosts.push(new URL(url).host);
      if (url.includes("commonstack")) return new Response(COMMONSTACK_EMPTY, { status: 429 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(brief) }, finish_reason: "stop" }], usage: {} }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await verifySubmission(input, {
      provider: P,
      fallback: { endpoint: "https://api.other.test/v1/chat/completions", key: "k2", model: "other-model", host: "api.other.test" },
      fetchImpl,
      hedgeAfterMs: 60_000,
    });
    expect(hosts.filter((h) => h === "api.commonstack.ai")).toHaveLength(1);
    expect(hosts).toContain("api.other.test");
    expect(out.engine).toBe("llm");
  });

  it("Post tells the founder the writer is offline, not to try again in a moment", async () => {
    const r = await draftDirectCampaign(
      { intent: "Write a 600-word guide to setting up our SDK, published on your own blog." },
      {
        complete: async () => {
          throw new LlmCompletionError({
            code: "llm_status_402", httpStatus: 402, provider: "api.commonstack.ai", requestedModel: "m", responseModel: null, finishReason: null,
            latencyMs: 1, promptTokens: null, completionTokens: null, parsePolicy: "repair", responseSchemaName: null, contentShape: "unknown", retryAfterMs: null,
          });
        },
      },
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe(WRITER_OFFLINE);
  });
});
