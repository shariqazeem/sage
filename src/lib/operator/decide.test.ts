import { describe, expect, it, vi } from "vitest";
import { chooseWithoutModel, choosePosition, proposalLine, surfaceReport } from "./decide";
import { DEFAULT_POLICY, type CampaignObservation, type OperatorPolicy } from "./policy";

const $ = (n: number) => Math.round(n * 1e6);
const policy: OperatorPolicy = { ...DEFAULT_POLICY, enabled: true };
const obs = (over: Partial<CampaignObservation> = {}): CampaignObservation => ({
  campaignId: "c", surface: "acme.io", kind: "testing", budgetBase: $(5), slots: 10, paid: 0, submissions: 0,
  ageMinutes: 60, status: "live", unclaimedBase: $(5), ...over,
});
const input = (over: Partial<Parameters<typeof chooseWithoutModel>[0]> = {}) => ({
  productUrl: "https://acme.io", founderGoal: "get developers to finish the quickstart",
  allowedSurfaces: ["acme.io"], observations: [] as CampaignObservation[], policy, budgetBase: $(5), ...over,
});

vi.mock("@/lib/llm/complete", () => ({ llmCompleteJson: vi.fn() }));
const { llmCompleteJson } = await import("@/lib/llm/complete");
const answer = (json: unknown) => ({ json, text: JSON.stringify(json), model: "m", usage: null }) as never;

describe("choosing what work to buy", () => {
  it("with no history it probes the founder's own product with a testing run", () => {
    const p = chooseWithoutModel(input());
    expect(p).toMatchObject({ surface: "acme.io", kind: "testing", decidedBy: "rules" });
    expect(p?.goal).toContain("get developers to finish the quickstart");
  });

  it("once testing gets claimed it moves to a deliverable rather than another read", () => {
    const filled = obs({ status: "ended", slots: 10, paid: 8, submissions: 9, unclaimedBase: 0 });
    expect(chooseWithoutModel(input({ observations: [filled] }))?.kind).toBe("gig");
  });

  it("refuses every surface that went unclaimed, and then has nothing to propose", () => {
    const quiet = obs({ status: "ended", submissions: 0, paid: 0, ageMinutes: 5000 });
    expect(chooseWithoutModel(input({ observations: [quiet] }))).toBeNull();
  });

  it("takes the model's position when it is inside the founder's surfaces", async () => {
    vi.mocked(llmCompleteJson).mockResolvedValueOnce(answer({ surface: "acme.io", kind: "gig", goal: "Have people publish a walkthrough of the quickstart.", reason: "the last testing run filled quickly" }));
    const p = await choosePosition(input());
    expect(p).toMatchObject({ surface: "acme.io", kind: "gig", decidedBy: "llm" });
  });

  it("REFUSES a surface the founder never named — an invented URL never gets a budget", async () => {
    vi.mocked(llmCompleteJson).mockResolvedValueOnce(answer({ surface: "competitor.dev", kind: "testing", goal: "Test the competitor.", reason: "more traffic there" }));
    const p = await choosePosition(input());
    expect(p).toMatchObject({ surface: "acme.io", decidedBy: "rules" });
  });

  it("REFUSES a position that names money — pricing is never the model's", async () => {
    vi.mocked(llmCompleteJson).mockResolvedValueOnce(answer({ surface: "acme.io", kind: "gig", goal: "Pay $5 for a walkthrough of the quickstart.", reason: "cheap" }));
    expect((await choosePosition(input()))?.decidedBy).toBe("rules");
    vi.mocked(llmCompleteJson).mockResolvedValueOnce(answer({ surface: "acme.io", kind: "gig", goal: "Publish a walkthrough.", reason: "worth 10 USDC of budget" }));
    expect((await choosePosition(input()))?.decidedBy).toBe("rules");
  });

  it("falls back, never stalls, when the provider throws", async () => {
    vi.mocked(llmCompleteJson).mockRejectedValueOnce(new Error("llm_not_configured"));
    expect((await choosePosition(input()))?.decidedBy).toBe("rules");
  });

  it("reports each surface honestly, and the proposal line carries the price the mandate set", () => {
    const r = surfaceReport(["acme.io", "other.dev"], [obs({ status: "ended", slots: 4, paid: 4, submissions: 5 })], policy);
    // the KIND is the part the model was missing: without it, it asked for the same work twice
    expect(r).toMatch(/acme\.io: 1 campaign\(s\) — testing 4\/4 claimed/);
    expect(r).toMatch(/other\.dev: never worked/);
    const line = proposalLine({ surface: "acme.io", kind: "testing", goal: "g", reason: "the last one filled", decidedBy: "llm" }, $(5));
    expect(line).toBe("$5.00 testing run on acme.io — the last one filled");
  });
});
