import { describe, it, expect } from "vitest";
import { verifySubmission, type LlmProvider } from "./brain";
import { judgeDecision } from "./judge-eval";
import type { BrainInput } from "./brain-core";

/**
 * DETERMINISTIC fault-injection for the payout brain (CI, no network). Drives the REAL `verifySubmission`
 * with an injected provider + `fetch`, proving the production chain FAILS CLOSED: a timeout, a refusal, an
 * unparseable/empty completion → the honest heuristic (which can NEVER autopay), and a primary outage →
 * a verified LLM brief from the FALLBACK provider with correct provenance. No copied logic — this is the
 * production path under simulated provider faults.
 */
const primaryProv: LlmProvider = { endpoint: "https://primary.test/v1/chat/completions", key: "k", model: "test/primary", host: "primary.test" };
const fallbackProv: LlmProvider = { endpoint: "https://fallback.test/v1/chat/completions", key: "k", model: "test/fallback", host: "fallback.test" };

const INPUT: BrainInput = {
  campaignTitle: "t", criteria: ["did the thing"], conditionType: "approval",
  note: "I did the thing and here is my genuine account of it.", wallet: `0x${"a".repeat(40)}`,
  evidenceUrl: "https://example.org/x", evidenceText: "The thing was done successfully. Confirmation shown.",
  evidenceOk: true, contentSha256: null,
};

/** A chat-completions Response carrying `content`, with an explicit NORMAL finish (Gate C requires it;
 *  these fault cases isolate OTHER failures — timeout, bad status, refusal text, malformed/empty body). */
function completion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}
const PAY_BRIEF = JSON.stringify({ criteria: [{ criterion: "did the thing", met: true, confidence: 0.95 }], fraudSignals: [], recommendation: "pay", reasonCode: "all_criteria_met", confidence: 0.96, summary: "a. b. c." });

describe("payout brain — fault injection fails CLOSED", () => {
  it("TIMEOUT on every primary attempt, no fallback → heuristic, never autopay", async () => {
    const fetchImpl = (async () => { throw new Error("The operation was aborted"); }) as unknown as typeof fetch;
    const b = await verifySubmission(INPUT, { provider: primaryProv, fallback: null, fetchImpl });
    expect(b.engine).toBe("heuristic");
    expect(judgeDecision(b).autopayQualified).toBe(false);
  });

  it("REFUSAL (200 but a natural-language refusal, unparseable) → heuristic, never autopay", async () => {
    const fetchImpl = (async () => completion("I'm sorry, but I can't help with that request.")) as unknown as typeof fetch;
    const b = await verifySubmission(INPUT, { provider: primaryProv, fallback: null, fetchImpl });
    expect(b.engine).toBe("heuristic");
    expect(judgeDecision(b).autopayQualified).toBe(false);
  });

  it("MALFORMED output (garbage, no JSON object) → heuristic, never autopay", async () => {
    const fetchImpl = (async () => completion("<<<<<< not json at all >>>>>>")) as unknown as typeof fetch;
    const b = await verifySubmission(INPUT, { provider: primaryProv, fallback: null, fetchImpl });
    expect(b.engine).toBe("heuristic");
    expect(judgeDecision(b).autopayQualified).toBe(false);
  });

  it("EMPTY completion → heuristic, never autopay", async () => {
    const fetchImpl = (async () => completion("")) as unknown as typeof fetch;
    const b = await verifySubmission(INPUT, { provider: primaryProv, fallback: null, fetchImpl });
    expect(b.engine).toBe("heuristic");
    expect(judgeDecision(b).autopayQualified).toBe(false);
  });

  it("HTTP 500 on the primary, no fallback → heuristic, never autopay", async () => {
    const fetchImpl = (async () => new Response("upstream error", { status: 500 })) as unknown as typeof fetch;
    const b = await verifySubmission(INPUT, { provider: primaryProv, fallback: null, fetchImpl });
    expect(b.engine).toBe("heuristic");
    expect(judgeDecision(b).autopayQualified).toBe(false);
  });

  it("FALLBACK activation: primary fails, fallback returns a valid brief → engine llm with FALLBACK provenance", async () => {
    const fetchImpl = (async (url: string) => {
      if (String(url).includes("primary.test")) throw new Error("primary down");
      return completion(PAY_BRIEF); // fallback endpoint
    }) as unknown as typeof fetch;
    const b = await verifySubmission(INPUT, { provider: primaryProv, fallback: fallbackProv, fetchImpl });
    expect(b.engine).toBe("llm");
    expect(b.provider).toBe("fallback.test");
    expect(b.model).toBe("test/fallback"); // provenance = the model that actually decided
    // (whether it autopays is the gate's call; the point here is correct provenance on fail-over)
  });
});

/**
 * HEDGED ATTEMPTS (10 Oct 2026). The same real submission took 27.6 s in the morning and 279 s in the
 * afternoon: two attempts ran into the token ceiling one after the other. An attempt still thinking at
 * the hedge mark is now joined by the next, and the first VALID brief wins — through the same strict
 * path, so a truncated or malformed attempt can never win the race.
 */
describe("payout brain — hedged attempts", () => {
  const truncated = () =>
    new Response(JSON.stringify({ choices: [{ message: { content: PAY_BRIEF }, finish_reason: "length" }], usage: { prompt_tokens: 10, completion_tokens: 8000 } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  const later = <T,>(ms: number, v: () => T) => new Promise<T>((r) => setTimeout(() => r(v()), ms));

  it("a slow attempt is overtaken: the hedge answers first, and the slow one's truncation never wins", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      // attempt 1 thinks for 400 ms and is then cut off at the ceiling; attempt 2 answers at once
      return n === 1 ? later(400, truncated) : completion(PAY_BRIEF);
    }) as unknown as typeof fetch;
    const t0 = Date.now();
    const b = await verifySubmission(INPUT, { provider: primaryProv, fallback: null, fetchImpl, hedgeAfterMs: 50 });
    expect(b.engine).toBe("llm");
    expect(b.provider).toBe("primary.test");
    expect(b.recommendation).toBe("pay");
    expect(Date.now() - t0).toBeLessThan(350); // did not wait for the slow attempt
    expect(n).toBe(2);
  });

  it("a quick answer starts no second call", async () => {
    let n = 0;
    const fetchImpl = (async () => { n++; return completion(PAY_BRIEF); }) as unknown as typeof fetch;
    const b = await verifySubmission(INPUT, { provider: primaryProv, fallback: null, fetchImpl, hedgeAfterMs: 50 });
    expect(b.engine).toBe("llm");
    await later(150, () => null);
    expect(n).toBe(1);
  });

  it("never more than three primary calls, and when all three are truncated it fails over, not pays", async () => {
    let primaryCalls = 0;
    const fetchImpl = (async (url: string) => {
      if (String(url).includes("primary.test")) { primaryCalls++; return later(120, truncated); }
      return completion(PAY_BRIEF);
    }) as unknown as typeof fetch;
    const b = await verifySubmission(INPUT, { provider: primaryProv, fallback: fallbackProv, fetchImpl, hedgeAfterMs: 30 });
    expect(primaryCalls).toBe(3);
    expect(b.provider).toBe("fallback.test"); // every primary attempt truncated → the fallback decided
    await later(200, () => null);
    expect(primaryCalls).toBe(3); // no stray fourth call after the race ended
  });
});
