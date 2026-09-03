import { describe, expect, it } from "vitest";
import { allocate, DEFAULT_POLICY, exposureBase, stalled, surfaceScale, type CampaignObservation, type MandateState, type OperatorPolicy } from "./policy";

const $ = (n: number) => Math.round(n * 1e6);

const policy = (over: Partial<OperatorPolicy> = {}): OperatorPolicy => ({
  ...DEFAULT_POLICY,
  enabled: true,
  weeklyCapBase: $(50),
  perCampaignCapBase: $(15),
  reserveFloorBase: 0,
  probeBase: $(5),
  maxScale: 3,
  maxConcurrent: 3,
  maxExposure: 0.6,
  minSpacingMinutes: 90,
  stallAfterMinutes: 2880,
  minCampaignBase: $(1),
  ...over,
});

const obs = (over: Partial<CampaignObservation> = {}): CampaignObservation => ({
  campaignId: "c1",
  surface: "acme.io",
  kind: "testing",
  budgetBase: $(5),
  slots: 10,
  paid: 0,
  submissions: 0,
  ageMinutes: 30,
  status: "live",
  unclaimedBase: $(5),
  ...over,
});

const state = (over: Partial<MandateState> = {}): MandateState => ({
  policy: policy(),
  balanceBase: $(100),
  committedThisWeekBase: 0,
  minutesSinceLastLaunch: null,
  observations: [],
  ...over,
});

describe("the standing mandate — what the agent may commit", () => {
  it("is off until a founder arms it: a funded treasury is a wallet, not an operator", () => {
    expect(allocate(state({ policy: policy({ enabled: false }) }), "acme.io")).toEqual({ action: "hold", reason: "the standing mandate is off" });
    expect(DEFAULT_POLICY.enabled).toBe(false);
  });

  it("a first campaign against an unproven surface is a probe, not the treasury", () => {
    const v = allocate(state(), "acme.io");
    expect(v).toMatchObject({ action: "launch", budgetBase: $(5), surface: "acme.io" });
    expect(v.action === "launch" && v.reason).toMatch(/probe/i);
  });

  it("RUNS A PORTFOLIO: a second small campaign launches while the first is still live", () => {
    const first = obs({ campaignId: "c1", surface: "acme.io", unclaimedBase: $(5) });
    const v = allocate(state({ observations: [first], minutesSinceLastLaunch: 120 }), "other.dev");
    expect(v.action).toBe("launch");
    expect(v.action === "launch" && v.budgetBase).toBe($(5));
  });

  it("but caps what may sit unclaimed at once — exposure, not spend, is the risk", () => {
    const live = [obs({ campaignId: "c1", unclaimedBase: $(30) }), obs({ campaignId: "c2", surface: "b.io", unclaimedBase: $(30) })];
    const v = allocate(state({ observations: live, minutesSinceLastLaunch: 500 }), "c.io");
    expect(v).toMatchObject({ action: "hold" });
    expect(v.reason).toMatch(/already on the board unclaimed/);
  });

  it("a surface whose work gets claimed earns a bigger allocation; the ceiling still binds", () => {
    const filled = obs({ campaignId: "c0", status: "ended", slots: 10, paid: 9, submissions: 12, unclaimedBase: 0 });
    expect(surfaceScale("acme.io", [filled], policy()).scale).toBe(2);
    const v = allocate(state({ observations: [filled], minutesSinceLastLaunch: 200 }), "acme.io");
    expect(v).toMatchObject({ action: "launch", budgetBase: $(10) });
    expect(v.action === "launch" && v.reason).toMatch(/filled — scaling 2×/);
    const two = [filled, { ...filled, campaignId: "c0b" }, { ...filled, campaignId: "c0c" }];
    expect(surfaceScale("acme.io", two, policy()).scale).toBe(3); // maxScale
  });

  it("a surface that went quiet earns nothing — the agent does not buy the same silence twice", () => {
    const quiet = obs({ campaignId: "c0", status: "ended", submissions: 0, paid: 0, ageMinutes: 4000 });
    const v = allocate(state({ observations: [quiet], minutesSinceLastLaunch: 500 }), "acme.io");
    expect(v).toMatchObject({ action: "hold" });
    expect(v.reason).toMatch(/went unclaimed/);
  });

  it("stops at the reserve floor — that money is the founder's, not the operator's", () => {
    const v = allocate(state({ balanceBase: $(20), policy: policy({ reserveFloorBase: $(19.5) }) }), "acme.io");
    expect(v).toMatchObject({ action: "hold" });
    expect(v.reason).toMatch(/reserve floor/);
  });

  it("respects the weekly ceiling and names it as the binding constraint when it clips a launch", () => {
    const exhausted = allocate(state({ committedThisWeekBase: $(49.5) }), "acme.io");
    expect(exhausted).toMatchObject({ action: "hold" });
    expect(exhausted.reason).toMatch(/this week's ceiling/);
    const clipped = allocate(state({ committedThisWeekBase: $(47) }), "acme.io");
    expect(clipped).toMatchObject({ action: "launch", budgetBase: $(3) });
    expect(clipped.action === "launch" && clipped.reason).toMatch(/this week's remaining ceiling/);
  });

  it("holds at the concurrency cap and while the spacing gap is open", () => {
    const three = [obs({ campaignId: "a" }), obs({ campaignId: "b", surface: "b.io" }), obs({ campaignId: "c", surface: "c.io" })];
    expect(allocate(state({ observations: three, policy: policy({ maxConcurrent: 3, maxExposure: 1 }) }), "d.io").reason).toMatch(/already running/);
    const soon = allocate(state({ minutesSinceLastLaunch: 10 }), "acme.io");
    expect(soon).toMatchObject({ action: "hold" });
    expect(soon.reason).toMatch(/waiting 80 more/);
  });

  it("never commits below the floor for a campaign worth running", () => {
    const v = allocate(state({ balanceBase: $(0.9), policy: policy({ minCampaignBase: $(1) }) }), "acme.io");
    expect(v).toMatchObject({ action: "hold" });
  });

  it("exposure counts only live, unclaimed money", () => {
    expect(exposureBase([obs({ unclaimedBase: $(4) }), obs({ campaignId: "x", status: "ended", unclaimedBase: $(9) })])).toBe($(4));
  });

  it("flags a live campaign nobody came to, so its money returns to the treasury", () => {
    const dead = obs({ campaignId: "dead", ageMinutes: 3000, submissions: 0, unclaimedBase: $(5) });
    const alive = obs({ campaignId: "alive", ageMinutes: 3000, submissions: 4 });
    const out = stalled([dead, alive], policy());
    expect(out.map((s) => s.campaignId)).toEqual(["dead"]);
    expect(out[0].reason).toMatch(/no one submitted in 50 hours — stopping it returns \$5\.00/);
  });
});
