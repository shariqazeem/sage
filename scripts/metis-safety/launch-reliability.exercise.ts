import { describe, it } from "vitest";
import { inspectAndPlan } from "@/lib/launch/pipeline";
import type { FounderLaunchInput } from "@/lib/launch/schemas";

/** PART K — actual Mission Brain reliability over repeated REAL runs on a stable
 *  founder-shaped product. Reports numerator/denominator + failure classes. No chain. */

const INPUT: FounderLaunchInput = {
  productUrl: "https://www.postgresql.org",
  goal: "Confirm a new developer can find the download and getting-started docs.",
  targetUsers: "backend developers",
  totalBudgetBase: BigInt(6_000_000),
  tokenDecimals: 6,
};
const N = 6;

describe("PART K — Mission Brain reliability (real, repeated)", () => {
  it(`${N} repeated real runs on postgresql.org`, async () => {
    let ready = 0;
    const outcomes: string[] = [];
    for (let i = 0; i < N; i++) {
      const r = await inspectAndPlan(INPUT, `rel-${i}`, () => {}, 0);
      if (r.stage === "ready" && r.plan) ready++;
      outcomes.push(`${r.stage}${r.reason ? `(${r.reason})` : ""}:${r.plan?.missions.length ?? 0}m`);
    }
    console.log(`RELIABILITY ready=${ready}/${N} · ${(100 * ready / N).toFixed(0)}% · outcomes=[${outcomes.join(", ")}]`);
  }, 400_000);
});
