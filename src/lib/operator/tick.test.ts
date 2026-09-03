import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The tick's money-relevant behaviour: a proposal is arguable for its whole veto window, a vetoed
 * proposal never becomes a design job, and a matured one commits exactly once.
 */
vi.mock("./state", () => ({ mandateStateFor: vi.fn() }));
vi.mock("@/lib/launch/start", () => ({ startInspection: vi.fn() }));
vi.mock("@/lib/launch/job", () => ({ runInspectionJob: vi.fn() }));
vi.mock("@/lib/treasury/launch", () => ({ launchFromTreasury: vi.fn() }));
vi.mock("@/lib/treasury/web", () => ({ getWebTreasury: vi.fn(() => null) }));
vi.mock("@/lib/privy/stop-campaign", () => ({ stopCampaignViaPrivy: vi.fn() }));
vi.mock("./decide", async (orig) => ({ ...(await orig<typeof import("./decide")>()), choosePosition: vi.fn() }));

const { runOperatorTick, allowedSurfaces } = await import("./tick");
const { mandateStateFor } = await import("./state");
const { startInspection } = await import("@/lib/launch/start");
const { choosePosition } = await import("./decide");
const { upsertMandate, listLaunches, updateLaunch, armedMandates } = await import("@/lib/db/operator");
const { DEFAULT_POLICY } = await import("./policy");

const $ = (n: number) => Math.round(n * 1e6);
const NOW = 1_800_000_000;
// one founder per test: armedMandates() is the tick's work list, so a mandate left armed by an
// earlier test would be ticked again here and mask the behaviour under test.
let seq = 0;
let FOUNDER = "";

const state = (over: Record<string, unknown> = {}) => ({
  policy: { ...DEFAULT_POLICY, enabled: true, minSpacingMinutes: 0, probeBase: $(5), minCampaignBase: $(1) },
  balanceBase: $(100),
  committedThisWeekBase: 0,
  minutesSinceLastLaunch: null,
  observations: [],
  treasuryAddress: `0x${"9".repeat(40)}`,
  productUrl: "https://acme.io",
  goal: "get developers through the quickstart",
  ...over,
});

describe("the operator tick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const m of armedMandates()) upsertMandate(m.founderAddress, { enabled: 0 }, NOW);
    FOUNDER = `0x${String(++seq).padStart(2, "0").repeat(20)}`;
    upsertMandate(FOUNDER, { enabled: 1, productUrl: "https://acme.io", goal: "g", vetoWindowMinutes: 20 }, NOW);
    vi.mocked(mandateStateFor).mockResolvedValue(state() as never);
    vi.mocked(choosePosition).mockResolvedValue({ surface: "acme.io", kind: "testing", goal: "Have real people use acme.io.", reason: "nothing has run here yet", decidedBy: "llm" });
  });

  it("proposes before it commits: the founder sees the move, its reason and its price first", async () => {
    const r = await runOperatorTick(NOW);
    expect(r.proposed).toBe(1);
    expect(r.committed).toBe(0);
    expect(startInspection).not.toHaveBeenCalled();
    const [l] = listLaunches(FOUNDER);
    expect(l).toMatchObject({ state: "proposed", surface: "acme.io", kind: "testing", budgetBase: $(5), decidedBy: "llm" });
    expect(l.commitAt).toBe(NOW + 20 * 60);
    expect(l.reason).toMatch(/nothing has run here yet · sized at \$5\.00 because/);
  });

  it("does not commit while the window is open, and proposes nothing new on top of it", async () => {
    await runOperatorTick(NOW);
    const r = await runOperatorTick(NOW + 10 * 60);
    expect(r.committed).toBe(0);
    expect(r.proposed).toBe(0);
    expect(listLaunches(FOUNDER)).toHaveLength(1);
  });

  it("commits once the window has run out, and only once", async () => {
    await runOperatorTick(NOW);
    vi.mocked(startInspection).mockReturnValue({ ok: true, created: true, job: { id: "job_1" } } as never);
    const r = await runOperatorTick(NOW + 21 * 60);
    expect(r.committed).toBe(1);
    expect(vi.mocked(startInspection).mock.calls[0][0]).toMatchObject({ founder: FOUNDER, budgetUsd: 5, surface: "operator" });
    expect(listLaunches(FOUNDER)[0]).toMatchObject({ state: "committed", jobId: "job_1" });
    const again = await runOperatorTick(NOW + 40 * 60);
    expect(again.committed).toBe(0);
  });

  it("A VETOED PROPOSAL NEVER BECOMES A JOB — the founder's stop is final", async () => {
    await runOperatorTick(NOW);
    const [l] = listLaunches(FOUNDER);
    updateLaunch(l.id, { state: "vetoed", vetoReason: "not this product" });
    const r = await runOperatorTick(NOW + 60 * 60);
    expect(startInspection).not.toHaveBeenCalled();
    expect(r.committed).toBe(0);
    expect(listLaunches(FOUNDER).find((x) => x.id === l.id)?.state).toBe("vetoed");
  });

  it("holds with a readable reason instead of proposing when the mandate says no", async () => {
    vi.mocked(mandateStateFor).mockResolvedValue(state({ policy: { ...DEFAULT_POLICY, enabled: true, reserveFloorBase: $(999) } }) as never);
    const r = await runOperatorTick(NOW);
    expect(r.proposed).toBe(0);
    expect(r.held[0]).toMatch(/reserve floor/);
  });

  it("chooses only among the founder's own surface and places it has already worked", () => {
    expect(allowedSurfaces("https://www.acme.io/docs", [{ surface: "other.dev" }, { surface: "unknown" }])).toEqual(["acme.io", "other.dev"]);
    expect(allowedSurfaces(null, [])).toEqual([]);
  });
});
