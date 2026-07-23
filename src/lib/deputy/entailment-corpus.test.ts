import { describe, it, expect } from "vitest";
import { runEntailmentVeto, type EntailmentProvider, type EntailmentInput } from "./entailment";
import { ENTAILMENT_FIXTURES } from "./entailment-fixtures";

/**
 * Validates the DEDICATED entailment corpus + the veto's HANDLING deterministically (no quota): a fake
 * provider returns the verdict a correct checker should return for each fixture, and the veto must veto
 * every non-entailing trap, accept every entailing one, and FAIL CLOSED (veto) on malformed output. This
 * is the offline fix for the P-ENTAIL 0/15 (the old harness sent malformed multi-criterion inputs); a
 * LIVE model run over these fixtures is the promotion evidence, owed when quota is unthrottled.
 */
const provider: EntailmentProvider = { endpoint: "https://ent.test/v1/chat/completions", key: "k", model: "anthropic/claude-haiku-4-5", host: "ent.test" };
const serve = (content: string, finish = "stop"): typeof fetch =>
  (async () => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }], usage: {} }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
const inputFor = (criterion: string, quote: string, note: string | null): EntailmentInput => ({ criteria: [{ id: "c0", criterion, quote }], note });
const verdictJson = (verdict: string) => JSON.stringify({ results: [{ criterionId: "c0", verdict, reasonCode: "r", reason: "because" }] });

describe("dedicated entailment corpus — every quote is verbatim + the veto handles each trap", () => {
  it("every fixture's quote is a real substring of its evidence (well-formed corpus)", () => {
    for (const f of ENTAILMENT_FIXTURES) expect(f.evidence.includes(f.quote), f.id).toBe(true);
    expect(ENTAILMENT_FIXTURES.length).toBeGreaterThanOrEqual(13);
  });

  for (const f of ENTAILMENT_FIXTURES) {
    it(`${f.trap}/${f.id} (${f.language}): a correct verdict "${f.expected}" ${f.expected === "entailed" ? "clears" : "vetoes"}`, async () => {
      const res = await runEntailmentVeto(inputFor(f.criterion, f.quote, f.note), { provider, fetchImpl: serve(verdictJson(f.expected)) });
      expect(res.ran).toBe(true);
      expect(res.vetoed).toBe(f.expected !== "entailed"); // not_entailed/uncertain → veto; entailed → clear
    });
  }
});

describe("entailment veto FAILS CLOSED on malformed / abnormal output (never a false clear)", () => {
  const input = inputFor("did the thing", "the thing", "I did the thing");
  const cases: [string, typeof fetch][] = [
    ["missing results", serve(JSON.stringify({ notResults: [] }))],
    ["wrong criterionId", serve(JSON.stringify({ results: [{ criterionId: "cX", verdict: "entailed", reasonCode: "r", reason: "x" }] }))],
    ["duplicate criterion", serve(JSON.stringify({ results: [{ criterionId: "c0", verdict: "entailed", reasonCode: "r", reason: "x" }, { criterionId: "c0", verdict: "entailed", reasonCode: "r", reason: "x" }] }))],
    ["bad verdict enum", serve(JSON.stringify({ results: [{ criterionId: "c0", verdict: "definitely", reasonCode: "r", reason: "x" }] }))],
    ["fenced/prose (not strict JSON)", serve("```json\n" + verdictJson("entailed") + "\n```")],
    ["truncated (finish length)", serve(verdictJson("entailed"), "length")],
    ["absent finish_reason", serve(verdictJson("entailed"), "")],
  ];
  for (const [name, fetchImpl] of cases) {
    it(`${name} → vetoed (fail closed)`, async () => {
      const res = await runEntailmentVeto(input, { provider, fetchImpl });
      expect(res.vetoed).toBe(true);
      expect(res.error).not.toBeNull();
    });
  }
});
