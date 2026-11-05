import { beforeEach, describe, expect, it } from "vitest";
import { verifySubmission } from "./brain";
import { resetWireMemory } from "@/lib/llm/wire";

/**
 * THE JUDGE'S REQUEST, PER PROVIDER. A provider that refuses json_object (Anthropic's endpoint) gets the
 * brief's schema so its answer is one bare object; every provider the judge runs on today keeps its
 * byte-identical request (temperature 0, json_object), so its approved identity is untouched.
 */
const brief = { criteria: [{ criterion: "c", met: true, confidence: 0.95, quote: null }], fraudSignals: [], recommendation: "pay", reasonCode: "all_criteria_met", confidence: 0.9, summary: "ok" };
const input = { criteria: ["c"], evidenceUrl: "https://example.com/p", note: null, evidenceText: "c", evidenceOk: true, contentSha256: null } as never;

function capture() {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_u: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(brief) }, finish_reason: "stop" }], usage: {} }), { status: 200 });
  }) as unknown as typeof fetch;
  return { bodies, fetchImpl };
}

beforeEach(() => resetWireMemory());

describe("the payout judge's request shape", () => {
  it("asks Anthropic's endpoint for the brief's exact schema, never json_object or a temperature", async () => {
    const { bodies, fetchImpl } = capture();
    await verifySubmission(input, { provider: { endpoint: "https://api.anthropic.com/v1/chat/completions", key: "k", model: "claude-sonnet-5-5", host: "api.anthropic.com" }, fallback: null, fetchImpl });
    const rf = bodies[0]!.response_format as { type: string; json_schema?: { name: string } };
    expect(rf.type).toBe("json_schema");
    expect(rf.json_schema?.name).toBe("payout_brief");
    expect(bodies[0]).not.toHaveProperty("temperature");
  });

  it("keeps the approved MiniMax judge's request byte-identical: temperature 0 and json_object", async () => {
    const { bodies, fetchImpl } = capture();
    await verifySubmission(input, { provider: { endpoint: "https://api.commonstack.ai/v1/chat/completions", key: "k", model: "minimax/minimax-m3", host: "api.commonstack.ai" }, fallback: null, fetchImpl });
    expect(bodies[0]!.response_format).toEqual({ type: "json_object" });
    expect(bodies[0]!.temperature).toBe(0);
  });
});
