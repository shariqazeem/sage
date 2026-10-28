import { describe, expect, it } from "vitest";
import { readyJobs, FIRST_IMPRESSIONS_GOAL, type ReadyJob } from "./ready-jobs";
import { composeDirectBody, composerTotal } from "./composer";
import { compileDirectCampaign, directCampaignSchema } from "./direct-campaign";
import { PLANS } from "@/lib/plans/catalog";

/**
 * READY TO GO (28 Oct 2026). Post's ready jobs fill the composer in full, so each must survive the exact
 * path a founder's click takes: the composer's body, the server's schema, the deterministic compiler.
 * A ready job that cannot launch is worse than a blank box.
 */
const product = { name: "Sage", url: "https://sagepays.xyz" };
const pay = (jobs: ReadyJob[]) => jobs.filter((j): j is Extract<ReadyJob, { kind: "pay" }> => j.kind === "pay");
const CONTRACT = "0x00000000000000000000000000000000000000aa";

function compile(j: Extract<ReadyJob, { kind: "pay" }>, fill = true) {
  const tranches = j.draft.tranches.map((t) => (fill && t.verify === "onchain" && !t.toAddr ? { ...t, toAddr: CONTRACT } : t));
  const body = composeDirectBody({ ...j.draft, tranches, currency: "USD", why: "" });
  const parsed = directCampaignSchema.safeParse(body);
  if (!parsed.success) return { parsed, compiled: null, total: composerTotal({ ...j.draft, tranches }) };
  return { parsed, compiled: compileDirectCampaign(parsed.data, `gig-ready${j.key}`), total: composerTotal({ ...j.draft, tranches }) };
}

describe("Post's ready jobs", () => {
  it("each compiles through the composer's own body, the schema and the compiler", () => {
    for (const j of pay(readyJobs(product))) {
      const { parsed, compiled } = compile(j);
      expect(parsed.success, `${j.key}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`).toBe(true);
      expect(compiled?.ok, `${j.key}: ${compiled && !compiled.ok ? compiled.error : ""}`).toBe(true);
    }
  });

  it("the vault holds exactly the price on the card, and every one fits the Free plan's month", () => {
    const want: Record<string, number> = { guide: 10, onchain: 6, grant: 30 };
    for (const j of pay(readyJobs(product))) {
      const { compiled, total } = compile(j);
      expect(total).toBe(want[j.key]);
      expect(compiled?.ok && Number(compiled.totalBudgetBase)).toBe(want[j.key] * 1e6);
      expect(total).toBeLessThanOrEqual(PLANS.free.monthlyUsd);
    }
  });

  it("a job that needs the founder's contract cannot launch until it is added, and says so", () => {
    const onchain = pay(readyJobs(product)).find((j) => j.key === "onchain")!;
    expect(onchain.needs).toMatch(/contract address/);
    expect(compile(onchain, false).parsed.success).toBe(false);
    expect(compile(onchain, true).parsed.success).toBe(true);
  });

  it("checks what Sage can check from the proof: a link carrying the worker's wallet, or the transaction itself", () => {
    for (const j of pay(readyJobs(product))) {
      const { parsed } = compile(j);
      if (!parsed.success) throw new Error(j.key);
      for (const m of parsed.data.milestones) {
        expect(["artifact_url", "onchain_tx"]).toContain(m.evidence.kind);
        if (m.evidence.kind === "onchain_tx") expect(m.evidence.chainId).toBe(1088);
      }
    }
  });

  it("is written for the founder's product, and reads plainly without one", () => {
    const named = JSON.stringify(readyJobs(product));
    expect(named).toContain("Sage");
    expect(named).toContain("https://sagepays.xyz");
    const bare = readyJobs({ name: null, url: null });
    expect(JSON.stringify(bare)).toContain("your product");
    expect(JSON.stringify(bare)).not.toMatch(/ at null|undefined/);
    expect(readyJobs({ name: null, url: "https://www.example.com/app" })[0].title).toBe("Have people try example.com");
  });

  it("offers a product test that starts from the first-impressions goal", () => {
    const test = readyJobs(product).find((j) => j.kind === "test");
    expect(test && test.kind === "test" && test.goal).toBe(FIRST_IMPRESSIONS_GOAL);
  });
});
