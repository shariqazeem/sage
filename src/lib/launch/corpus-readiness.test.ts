import { describe, expect, it } from "vitest";
import { distillPrivateKey } from "@/lib/deputy/observation-verify";
import { RELEASE_LINE, missionTryReadiness } from "@/lib/deputy/real-try";
import { realTryMissions, type RealTryMission } from "@/lib/deputy/real-try-fixtures";
import { computeCorpusReadiness } from "./job";
import type { MissionPlanV1, ProductMapV1 } from "./schemas";

/**
 * THE PLAN SAYS, PER MISSION, WHETHER SAGE CAN PAY ITS ANSWERS ALONE (22 Nov 2026), before the builder
 * pays. It is the same function the payout pipeline runs on the pinned key, on the same key.
 */
const planOf = (m: RealTryMission, cls: "observation-based" | "url-verifiable" = "observation-based") =>
  ({
    missions: [
      {
        missionKey: "m1",
        title: m.publicStrings[0],
        objective: m.publicStrings[1] ?? "",
        instructions: m.publicStrings[2] ?? "",
        targetSurface: m.publicStrings[3] ?? "",
        criteria: m.criteria,
        evidenceRequirements: m.evidenceRequirements,
        verifiabilityClass: cls,
      },
    ],
  }) as unknown as MissionPlanV1;
const mapOf = (m: RealTryMission) => ({ fieldTest: m.fieldTest }) as unknown as ProductMapV1;
const mission = (name: string) => realTryMissions.find((m) => m.name.startsWith(name))!;

describe("corpus readiness, per mission", () => {
  it("a rich product whose card gives nothing away: autonomous, and no line", () => {
    const m = mission("excalidraw");
    // the fixture's card is four loose strings; the plan carries the same four
    const r = computeCorpusReadiness(mapOf(m), planOf(m))!;
    expect(r.autonomous).toBe(true);
    expect(r.missions).toEqual([{ missionKey: "m1", autonomous: true, cardClears: false, tryOnlySources: 4, line: null }]);
  });

  it("the 12 Aug shape (criteria quote the product's own words): the builder reads the line before paying", () => {
    const m = mission("frameworks");
    const r = computeCorpusReadiness(mapOf(m), planOf(m))!;
    expect(r.autonomous).toBe(true); // the key is rich enough to pay at all...
    expect(r.missions?.[0]).toMatchObject({ autonomous: false, cardClears: true, line: RELEASE_LINE }); // ...but not this mission alone
  });

  it("is the pipeline's own measure on the key that gets pinned", () => {
    const m = mission("frameworks");
    const plan = planOf(m);
    const pm = plan.missions[0]!;
    const strings = [pm.title, pm.objective, pm.instructions, pm.targetSurface, ...pm.criteria, ...pm.evidenceRequirements].filter((s) => s.length > 0);
    const key = distillPrivateKey(m.fieldTest, strings);
    const direct = missionTryReadiness(key, { publicStrings: strings, criteria: pm.criteria, evidenceRequirements: pm.evidenceRequirements });
    expect(computeCorpusReadiness(mapOf(m), plan)!.missions?.[0]).toMatchObject({ autonomous: direct.autonomous, cardClears: direct.cardClears, tryOnlySources: direct.tryOnlySources });
  });

  it("a mission checked from a link has no line: it is not judged against what Sage saw", () => {
    const m = mission("frameworks");
    const r = computeCorpusReadiness(mapOf(m), planOf(m, "url-verifiable"))!;
    expect(r).toEqual({ observation: false, sources: 0, autonomous: true });
  });

  it("a product too thin to pay at all says so once, not again on every mission", () => {
    const m = mission("frameworks");
    const thin = { fieldTest: { ...m.fieldTest, pages: m.fieldTest.pages.slice(0, 1), docs: [] } } as unknown as ProductMapV1;
    const r = computeCorpusReadiness(thin, planOf(m))!;
    expect(r.autonomous).toBe(false);
    expect(r.missions?.[0]?.line).toBeNull();
  });
});
