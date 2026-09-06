import { describe, expect, it } from "vitest";
import type { Mission } from "@/lib/db/schema";
import { priorMilestoneUnpaid } from "./milestone-order";

const m = (key: string, title: string) => ({ missionKey: key, title, missionIdHash: `0x${key}` }) as unknown as Mission;
const ordered = [m("m1", "Catalogue page online"), m("m2", "First customer review")];

describe("priorMilestoneUnpaid — a grant's milestones release one by one", () => {
  it("the first milestone is always open", () => {
    expect(priorMilestoneUnpaid("grant", ordered, ordered[0]!, () => false)).toBeNull();
  });
  it("the second is locked until the first has paid to this person", () => {
    expect(priorMilestoneUnpaid("grant", ordered, ordered[1]!, () => false)?.missionKey).toBe("m1");
    expect(priorMilestoneUnpaid("grant", ordered, ordered[1]!, (p) => p.missionKey === "m1")).toBeNull();
  });
  it("gigs and testing campaigns are unordered", () => {
    expect(priorMilestoneUnpaid("gig", ordered, ordered[1]!, () => false)).toBeNull();
    expect(priorMilestoneUnpaid("testing", ordered, ordered[1]!, () => false)).toBeNull();
  });
});
