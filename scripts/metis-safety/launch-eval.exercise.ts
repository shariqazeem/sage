import { describe, it, expect } from "vitest";
import { inspectAndPlan } from "@/lib/launch/pipeline";
import type { FounderLaunchInput } from "@/lib/launch/schemas";

/**
 * PART N — real quality evaluation. Run the Mission Brain READ-ONLY against three
 * genuinely different public products and print what it produced, so a human can judge
 * whether the missions are product-specific (not interchangeable) and safe. No chain,
 * no deployment. LLM variance is expected; this logs quality rather than asserting a
 * fixed shape.
 */

const PRODUCTS: { label: string; input: FounderLaunchInput; id: string }[] = [
  {
    label: "Sage (self)",
    id: "eval-sage",
    input: {
      productUrl: "https://sage.80.225.209.190.sslip.io",
      goal: "Launching an autonomous AI that pays testers for verified product testing; I want to learn if the payout proof + onboarding are convincing.",
      targetUsers: "crypto-native founders and early testers",
      totalBudgetBase: BigInt(5_000_000),
      tokenDecimals: 6,
    },
  },
  {
    label: "PostgreSQL (docs-heavy dev product)",
    id: "eval-postgres",
    input: {
      productUrl: "https://www.postgresql.org",
      goal: "I maintain an open-source relational database and want to learn whether a developer can find the download + getting-started path and understand what version to use.",
      targetUsers: "backend developers evaluating a database",
      totalBudgetBase: BigInt(6_000_000),
      tokenDecimals: 6,
    },
  },
  {
    label: "Basecamp (consumer/SMB SaaS)",
    id: "eval-basecamp",
    input: {
      productUrl: "https://basecamp.com",
      goal: "Project management for small teams; I want to learn whether the value proposition and signup are clear to a non-technical small-business owner.",
      targetUsers: "non-technical small-business owners",
      totalBudgetBase: BigInt(4_000_000),
      tokenDecimals: 6,
    },
  },
];

function genericityScore(missions: { title: string; instructions: string; targetSurface: string }[], host: string): number {
  // fraction of missions that reference the product's own host in their target surface.
  if (missions.length === 0) return 0;
  const specific = missions.filter((m) => m.targetSurface.includes(host)).length;
  return specific / missions.length;
}

describe("PART N — Mission Brain real quality evaluation (read-only)", () => {
  for (const p of PRODUCTS) {
    it(`inspects + plans for ${p.label}`, async () => {
      const r = await inspectAndPlan(p.input, p.id, () => {}, 0);
      const host = (() => { try { return new URL(p.input.productUrl).host; } catch { return ""; } })();
      const missions = r.plan?.missions ?? [];

      console.log(`\n===== ${p.label} =====`);
      console.log(`stage=${r.stage} reason=${r.reason ?? "-"} pagesInspected=${r.map?.pagesInspected ?? 0} repoFiles=${r.map?.repoFilesInspected ?? 0}`);
      if (r.map) {
        console.log(`productName=${JSON.stringify(r.map.productName)} category=${JSON.stringify(r.map.category)}`);
        console.log(`valueProp=${JSON.stringify(r.map.valueProp.slice(0, 120))}`);
        console.log(`routes=${r.map.routes.slice(0, 8).map((x) => x.value).join(", ")}`);
        console.log(`limitations=${JSON.stringify(r.map.limitations)}`);
        if (r.map.openQuestions.length) console.log(`openQuestions=${JSON.stringify(r.map.openQuestions)}`);
      }
      if (r.brain) console.log(`brain: candidates=${r.brain.candidates.length} accepted=${r.brain.accepted.length} model=${r.brain.model} provider=${r.brain.provider} rejected=${r.brain.reports.filter((x) => !x.ok).length}`);
      for (const m of missions) {
        console.log(`  • [${m.priority}/${m.riskCategory}] ${m.title}`);
        console.log(`    target=${m.targetSurface}`);
        console.log(`    why=${m.whyItMatters.slice(0, 160)}`);
        console.log(`    reward=${(Number(m.rewardBase) / 1e6).toFixed(2)} ×${m.maxCompletions} · effort=${m.effortMinutes}m · sources=${m.sources.map((s) => s.ref).slice(0, 2).join(" | ")}`);
        console.log(`    criteria[0]=${m.criteria[0] ?? "-"}`);
      }
      if (r.plan) {
        const summed = r.plan.missions.reduce((s, m) => s + m.rewardBase * m.maxCompletions, BigInt(0));
        console.log(`plan: campaignIdHash=${r.plan.campaignIdHash.slice(0, 14)}… missionPlanDigest=${r.plan.missionPlanDigest.slice(0, 14)}… budgetExact=${summed === r.plan.totalBudgetBase}`);
        console.log(`GENERICITY specific-target-fraction=${genericityScore(missions, host).toFixed(2)} (1.0 = all missions target this product)`);
        // hard invariant even in the eval: a ready plan sums to the budget exactly.
        expect(summed).toBe(r.plan.totalBudgetBase);
      }

      // the pipeline must always RUN and return a coherent stage (no crash).
      expect(["ready", "needs_input", "failed"]).toContain(r.stage);
    }, 120_000);
  }
});
