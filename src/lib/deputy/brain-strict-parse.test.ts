import { describe, it, expect } from "vitest";
import { verifySubmission, type LlmProvider } from "./brain";
import { judgeDecision } from "./judge-eval";
import { isAutoPayQualifying, type BrainInput } from "./brain-core";

/**
 * STRICT money-parse regression battery (Gate B item 2). The payout path must NEVER repair, salvage, or
 * complete a model's output: fenced JSON, prose-wrapped JSON, dropped braces, trailing garbage, a
 * truncated body, an abnormal finish_reason, or an explicit refusal all FAIL CLOSED to the heuristic —
 * which can never autopay. The one thing that must still work is a clean, strictly-valid, normally-
 * completed JSON decision. This can only REDUCE autopay recall, never increase autopay.
 *
 * Each case drives the REAL verifySubmission with an injected provider + fetch (no network, no copied
 * logic). A rejected body is retried 3× on the primary, then — with no fallback — degrades to heuristic.
 */
const primaryProv: LlmProvider = { endpoint: "https://primary.test/v1/chat/completions", key: "k", model: "test/primary", host: "primary.test" };

const INPUT: BrainInput = {
  campaignTitle: "t", criteria: ["did the thing"], conditionType: "approval",
  note: "I did the thing and here is my genuine account of it.", wallet: `0x${"a".repeat(40)}`,
  evidenceUrl: "https://example.org/x", evidenceText: "The thing was done successfully. Confirmation shown.",
  evidenceOk: true, contentSha256: null,
};

/** A qualifying PAY decision as STRICT JSON — the body a compliant provider returns under response_format. */
const PAY_JSON = JSON.stringify({
  criteria: [{ criterion: "did the thing", met: true, confidence: 0.97 }],
  fraudSignals: [], recommendation: "pay", reasonCode: "all_criteria_met", confidence: 0.98, summary: "clean.",
});

/** A chat-completions Response with arbitrary content / finish_reason / refusal. */
function completion(opts: { content?: string; finish_reason?: string; refusal?: string }): Response {
  const message: Record<string, unknown> = {};
  if (opts.content !== undefined) message.content = opts.content;
  if (opts.refusal !== undefined) message.refusal = opts.refusal;
  const choice: Record<string, unknown> = { message };
  if (opts.finish_reason !== undefined) choice.finish_reason = opts.finish_reason;
  return new Response(JSON.stringify({ choices: [choice], usage: { prompt_tokens: 10, completion_tokens: 10 } }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}
const serve = (opts: { content?: string; finish_reason?: string; refusal?: string }) =>
  (async () => completion(opts)) as unknown as typeof fetch;

/** Assert a body FAILS CLOSED: degrades to the heuristic and cannot autopay by any measure. */
async function expectFailClosed(fetchImpl: typeof fetch) {
  const b = await verifySubmission(INPUT, { provider: primaryProv, fallback: null, fetchImpl });
  expect(b.engine).toBe("heuristic");
  expect(judgeDecision(b).autopayQualified).toBe(false);
  expect(isAutoPayQualifying(b)).toBe(false);
  return b;
}

describe("strict money parse — the payout path never repairs, salvages, or completes", () => {
  it("CLEAN strict JSON, finish_reason stop → parses as an LLM brief (recall preserved)", async () => {
    const b = await verifySubmission(INPUT, { provider: primaryProv, fallback: null, fetchImpl: serve({ content: PAY_JSON, finish_reason: "stop" }) });
    expect(b.engine).toBe("llm");
    expect(b.model).toBe("test/primary");
    expect(b.recommendation).toBe("pay");
  });

  it("CLEAN strict JSON with NO finish_reason (gateway omits it) → still parses (deny-list, not allow-list)", async () => {
    const b = await verifySubmission(INPUT, { provider: primaryProv, fallback: null, fetchImpl: serve({ content: PAY_JSON }) });
    expect(b.engine).toBe("llm");
  });

  it("FENCED JSON (```json … ```) → rejected, heuristic, never autopay", async () => {
    await expectFailClosed(serve({ content: "```json\n" + PAY_JSON + "\n```", finish_reason: "stop" }));
  });

  it("DROPPED outer braces (contents only) → rejected (no brace re-wrapping)", async () => {
    const inner = PAY_JSON.slice(1, -1); // the object CONTENTS the old repair path would re-wrap in {}
    await expectFailClosed(serve({ content: inner, finish_reason: "stop" }));
  });

  it("PROSE-wrapped JSON (\"Here is my answer: { … }\") → rejected (no balanced-object extraction)", async () => {
    await expectFailClosed(serve({ content: "Here is my answer:\n" + PAY_JSON, finish_reason: "stop" }));
  });

  it("TRAILING garbage after the JSON object → rejected (strict parse rejects extra content)", async () => {
    await expectFailClosed(serve({ content: PAY_JSON + "  <-- approved!", finish_reason: "stop" }));
  });

  it("TRUNCATED body + finish_reason \"length\" → rejected (max_tokens / partial completion)", async () => {
    await expectFailClosed(serve({ content: PAY_JSON.slice(0, PAY_JSON.length - 12), finish_reason: "length" }));
  });

  it("TRUNCATED body with NO marker → rejected (strict JSON.parse is the backstop)", async () => {
    await expectFailClosed(serve({ content: PAY_JSON.slice(0, PAY_JSON.length - 12) }));
  });

  it("finish_reason \"content_filter\" (even with valid JSON) → rejected", async () => {
    await expectFailClosed(serve({ content: PAY_JSON, finish_reason: "content_filter" }));
  });

  it("explicit message.refusal → rejected", async () => {
    await expectFailClosed(serve({ content: PAY_JSON, refusal: "I can't verify that.", finish_reason: "stop" }));
  });

  it("MISSING confidence (an incomplete money decision) → rejected", async () => {
    const noConf = JSON.stringify({ criteria: [], fraudSignals: [], recommendation: "pay", reasonCode: "all_criteria_met", summary: "x." });
    await expectFailClosed(serve({ content: noConf, finish_reason: "stop" }));
  });

  it("MISSING recommendation → rejected", async () => {
    const noRec = JSON.stringify({ criteria: [], fraudSignals: [], confidence: 0.99, reasonCode: "all_criteria_met", summary: "x." });
    await expectFailClosed(serve({ content: noRec, finish_reason: "stop" }));
  });

  it("SAFETY PROOF — a repairable PAY body the OLD path would have salvaged + autopaid is now rejected", async () => {
    // A fenced, confidence-0.99 PAY brief: repairJson would have stripped the fence and parsed it, and the
    // gate would have autopaid. Strict parse rejects it → heuristic → cannot autopay. Recall down, safety up.
    const b = await expectFailClosed(serve({ content: "```json " + JSON.stringify({ criteria: [], fraudSignals: [], recommendation: "pay", reasonCode: "all_criteria_met", confidence: 0.99, summary: "looks great." }) + " ```", finish_reason: "stop" }));
    expect(b.model).toBe(null); // the heuristic decided — the salvaged LLM text never became a brief
  });
});
