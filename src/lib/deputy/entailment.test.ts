import { describe, it, expect, afterEach } from "vitest";
import {
  parseEntailment,
  runEntailmentVeto,
  entailmentMode,
  entailmentInputFromBrief,
  isApprovedEntailmentModel,
  ENTAILMENT_APPROVED_MODELS,
  type EntailmentProvider,
  type EntailmentInput,
} from "./entailment";
import type { DecisionBrief } from "./brain-core";

/**
 * P-ENTAIL — the deterministic criterion-entailment battery (no network). Proves the STRICT validation
 * (no repair), the fail-closed veto semantics, the mode gating, and the brief→input mapping. The live
 * semantic proof (a genuine model returns not_entailed for a marketing-phrase quote) is in
 * entailment-eval.live; here every model response is injected so the LOGIC is what's under test.
 */
const approved = [...ENTAILMENT_APPROVED_MODELS][0];
const prov: EntailmentProvider = { endpoint: "https://ent.test/v1/chat/completions", key: "k", model: approved, host: "ent.test" };
const IDS2 = ["c0", "c1"];

const ONE: EntailmentInput = { criteria: [{ id: "c0", criterion: "Confirm SSO by logging in with it", quote: "Single Sign-On (SSO)" }], note: "I used SSO." };
const TWO: EntailmentInput = {
  criteria: [
    { id: "c0", criterion: "Reached the pricing page", quote: "Starter $9/mo" },
    { id: "c1", criterion: "Completed a purchase", quote: "Add to cart" },
  ],
  note: "I did both.",
};

function serve(body: unknown, opts: { finish_reason?: string; refusal?: string; status?: number } = {}): typeof fetch {
  return (async () => {
    if (opts.status && opts.status !== 200) return new Response("err", { status: opts.status });
    const message: Record<string, unknown> = { content: typeof body === "string" ? body : JSON.stringify(body) };
    if (opts.refusal !== undefined) message.refusal = opts.refusal;
    const choice: Record<string, unknown> = { message };
    if (opts.finish_reason !== undefined) choice.finish_reason = opts.finish_reason;
    return new Response(JSON.stringify({ choices: [choice] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}
const results = (rows: { criterionId: string; verdict: string }[]) => ({ results: rows.map((r) => ({ ...r, reasonCode: "x", reason: "y" })) });

afterEach(() => {
  delete process.env.ENTAILMENT_MODE;
});

describe("entailmentMode — default off, unknown → off, only exact strings arm", () => {
  it("defaults to off", () => { delete process.env.ENTAILMENT_MODE; expect(entailmentMode()).toBe("off"); });
  it("unknown value → off (a typo can never arm enforcement)", () => { process.env.ENTAILMENT_MODE = "enforced"; expect(entailmentMode()).toBe("off"); });
  it("shadow / enforce parse exactly (case-insensitive, trimmed)", () => {
    process.env.ENTAILMENT_MODE = " Shadow "; expect(entailmentMode()).toBe("shadow");
    process.env.ENTAILMENT_MODE = "ENFORCE"; expect(entailmentMode()).toBe("enforce");
  });
});

describe("parseEntailment — STRICT, no repair", () => {
  it("valid: exactly one row per requested id → normalized rows", () => {
    const rows = parseEntailment(JSON.stringify(results([{ criterionId: "c0", verdict: "entailed" }, { criterionId: "c1", verdict: "not_entailed" }])), IDS2);
    expect(rows?.map((r) => r.verdict)).toEqual(["entailed", "not_entailed"]);
  });
  it("FENCED JSON → null (no fence repair)", () => {
    expect(parseEntailment("```json\n" + JSON.stringify(results([{ criterionId: "c0", verdict: "entailed" }])) + "\n```", ["c0"])).toBeNull();
  });
  it("TRAILING garbage → null", () => {
    expect(parseEntailment(JSON.stringify(results([{ criterionId: "c0", verdict: "entailed" }])) + " ok!", ["c0"])).toBeNull();
  });
  it("non-JSON → null", () => { expect(parseEntailment("sure, all entailed!", ["c0"])).toBeNull(); });
  it("results not an array → null", () => { expect(parseEntailment(JSON.stringify({ results: "entailed" }), ["c0"])).toBeNull(); });
  it("FEWER results than requested → null (a missing criterion fails closed)", () => {
    expect(parseEntailment(JSON.stringify(results([{ criterionId: "c0", verdict: "entailed" }])), IDS2)).toBeNull();
  });
  it("MORE results than requested → null", () => {
    expect(parseEntailment(JSON.stringify(results([{ criterionId: "c0", verdict: "entailed" }, { criterionId: "c1", verdict: "entailed" }])), ["c0"])).toBeNull();
  });
  it("DUPLICATE criterionId → null", () => {
    expect(parseEntailment(JSON.stringify(results([{ criterionId: "c0", verdict: "entailed" }, { criterionId: "c0", verdict: "not_entailed" }])), IDS2)).toBeNull();
  });
  it("UNKNOWN criterionId → null", () => {
    expect(parseEntailment(JSON.stringify(results([{ criterionId: "cX", verdict: "entailed" }])), ["c0"])).toBeNull();
  });
  it("INVALID verdict enum → null", () => {
    expect(parseEntailment(JSON.stringify(results([{ criterionId: "c0", verdict: "probably" }])), ["c0"])).toBeNull();
  });
});

describe("runEntailmentVeto — fail-closed veto semantics", () => {
  it("ALL entailed → vetoed=false, ran=true, digests present", async () => {
    const r = await runEntailmentVeto(TWO, { provider: prov, fetchImpl: serve(results([{ criterionId: "c0", verdict: "entailed" }, { criterionId: "c1", verdict: "entailed" }]), { finish_reason: "stop" }) });
    expect(r.vetoed).toBe(false);
    expect(r.ran).toBe(true);
    expect(r.error).toBeNull();
    expect(r.inputDigest).toHaveLength(16);
  });
  it("one NOT_ENTAILED → vetoed=true", async () => {
    const r = await runEntailmentVeto(TWO, { provider: prov, fetchImpl: serve(results([{ criterionId: "c0", verdict: "entailed" }, { criterionId: "c1", verdict: "not_entailed" }]), { finish_reason: "stop" }) });
    expect(r.vetoed).toBe(true);
    expect(r.vetoReason).toMatch(/c1:not_entailed/);
  });
  it("one UNCERTAIN → vetoed=true", async () => {
    const r = await runEntailmentVeto(ONE, { provider: prov, fetchImpl: serve(results([{ criterionId: "c0", verdict: "uncertain" }]), { finish_reason: "stop" }) });
    expect(r.vetoed).toBe(true);
  });
  it("empty criteria (no met criteria) → ran=false, vetoed=false (nothing to check, not a veto)", async () => {
    const r = await runEntailmentVeto({ criteria: [], note: "x" }, { provider: prov, fetchImpl: serve("unused") });
    expect(r.ran).toBe(false);
    expect(r.vetoed).toBe(false);
    expect(r.error).toBe("no_criteria");
  });
  it("NO provider → vetoed=true (fail closed)", async () => {
    const r = await runEntailmentVeto(ONE, { provider: null });
    expect(r.vetoed).toBe(true);
    expect(r.error).toBe("no_provider");
  });
  it("UNAPPROVED model → vetoed=true, never calls the network", async () => {
    let called = false;
    const fetchImpl = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
    const r = await runEntailmentVeto(ONE, { provider: { ...prov, model: "someone/unapproved" }, fetchImpl });
    expect(r.vetoed).toBe(true);
    expect(r.error).toBe("unapproved_model");
    expect(called).toBe(false);
  });
  it("provider HTTP 500 → vetoed=true", async () => {
    const r = await runEntailmentVeto(ONE, { provider: prov, fetchImpl: serve("", { status: 500 }) });
    expect(r.vetoed).toBe(true);
    expect(r.error).toBe("provider_error");
  });
  it("abnormal finish_reason (length) → vetoed=true", async () => {
    const r = await runEntailmentVeto(ONE, { provider: prov, fetchImpl: serve(results([{ criterionId: "c0", verdict: "entailed" }]), { finish_reason: "length" }) });
    expect(r.vetoed).toBe(true);
    expect(r.error).toBe("abnormal_finish");
  });
  it("explicit refusal → vetoed=true", async () => {
    const r = await runEntailmentVeto(ONE, { provider: prov, fetchImpl: serve(results([{ criterionId: "c0", verdict: "entailed" }]), { refusal: "no", finish_reason: "stop" }) });
    expect(r.vetoed).toBe(true);
    expect(r.error).toBe("abnormal_finish");
  });
  it("INVALID output (fenced) → vetoed=true, error=invalid_output", async () => {
    const r = await runEntailmentVeto(ONE, { provider: prov, fetchImpl: serve("```json " + JSON.stringify(results([{ criterionId: "c0", verdict: "entailed" }])) + " ```", { finish_reason: "stop" }) });
    expect(r.vetoed).toBe(true);
    expect(r.error).toBe("invalid_output");
  });
});

describe("entailmentInputFromBrief — only MET criteria, carrying the verbatim quote", () => {
  it("filters unmet criteria and maps quotes to stable ids", () => {
    const brief = {
      criteria: [
        { criterion: "met with quote", met: true, confidence: 1, quote: "the proof" },
        { criterion: "unmet", met: false, confidence: 0 },
        { criterion: "met no quote", met: true, confidence: 1 },
      ],
    } as unknown as DecisionBrief;
    const input = entailmentInputFromBrief(brief, "my note");
    expect(input.criteria).toEqual([
      { id: "c0", criterion: "met with quote", quote: "the proof" },
      { id: "c1", criterion: "met no quote", quote: null },
    ]);
    expect(input.note).toBe("my note");
  });
});

describe("entailment model approval is independent of the judge allowlist", () => {
  it("only explicitly-approved entailment models pass", () => {
    expect(isApprovedEntailmentModel(approved)).toBe(true);
    expect(isApprovedEntailmentModel("google/gemini-3.1-flash-lite-preview")).toBe(false); // a judge model is NOT auto-approved to veto
    expect(isApprovedEntailmentModel(null)).toBe(false);
  });
});
