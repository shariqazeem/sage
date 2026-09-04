import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE OPERATOR UNDER PRESSURE.
 *
 * The happy path is covered elsewhere. These are the situations that actually decide whether an
 * autonomous spender is safe to leave running overnight: several founders at once, a treasury that
 * drains between deciding and acting, a campaign that disappears underneath a commitment, and a
 * model that keeps proposing the same thing. Every one of them once cost somebody real money in some
 * other system.
 */
vi.mock("./state", () => ({ mandateStateFor: vi.fn() }));
vi.mock("@/lib/launch/start", () => ({ startInspection: vi.fn() }));
vi.mock("@/lib/launch/job", () => ({ runInspectionJob: vi.fn() }));
vi.mock("@/lib/treasury/launch", () => ({ launchFromTreasury: vi.fn() }));
vi.mock("@/lib/treasury/web", () => ({ getWebTreasury: vi.fn(() => null) }));
vi.mock("@/lib/privy/stop-campaign", () => ({ stopCampaignViaPrivy: vi.fn() }));
vi.mock("./decide", async (orig) => ({ ...(await orig<typeof import("./decide")>()), choosePosition: vi.fn() }));

const { runOperatorTick } = await import("./tick");
const { mandateStateFor } = await import("./state");
const { startInspection } = await import("@/lib/launch/start");
const { choosePosition } = await import("./decide");
const { upsertMandate, listLaunches, armedMandates, updateLaunch } = await import("@/lib/db/operator");
const { DEFAULT_POLICY } = await import("./policy");

const $ = (n: number) => Math.round(n * 1e6);
const NOW = 1_800_000_000;
let seq = 0;
const founder = () => `0x${String(++seq).padStart(4, "0").repeat(10)}`;

const state = (over: Record<string, unknown> = {}) => ({
  policy: { ...DEFAULT_POLICY, enabled: true, minSpacingMinutes: 0, probeBase: $(5), minCampaignBase: $(1) },
  balanceBase: $(100),
  committedThisWeekBase: 0,
  minutesSinceLastLaunch: null,
  observations: [],
  treasuryAddress: `0x${"9".repeat(40)}`,
  productUrl: "https://acme.io",
  goal: "get developers through the quickstart",
  instruction: null,
  ...over,
});

const position = { surface: "acme.io", kind: "testing" as const, goal: "Have real people use acme.io.", reason: "nothing has run here yet", decidedBy: "llm" as const };

describe("the operator under pressure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const m of armedMandates()) upsertMandate(m.founderAddress, { enabled: 0 }, NOW);
    vi.mocked(choosePosition).mockResolvedValue(position);
  });

  it("RUNS MANY FOUNDERS IN ONE TICK, each sized from its own ceilings", async () => {
    const a = founder(), b = founder(), c = founder();
    upsertMandate(a, { enabled: 1, productUrl: "https://acme.io", probeBase: $(5), vetoWindowMinutes: 20 }, NOW);
    upsertMandate(b, { enabled: 1, productUrl: "https://acme.io", probeBase: $(2), vetoWindowMinutes: 20 }, NOW);
    upsertMandate(c, { enabled: 1, productUrl: "https://acme.io", probeBase: $(9), vetoWindowMinutes: 20 }, NOW);
    vi.mocked(mandateStateFor).mockImplementation(async (addr: string) => {
      const probe = addr === a ? $(5) : addr === b ? $(2) : $(9);
      return state({ policy: { ...DEFAULT_POLICY, enabled: true, minSpacingMinutes: 0, probeBase: probe, minCampaignBase: $(1) } }) as never;
    });

    const r = await runOperatorTick(NOW);
    expect(r.founders).toBe(3);
    expect(r.proposed).toBe(3);
    expect(listLaunches(a)[0].budgetBase).toBe($(5));
    expect(listLaunches(b)[0].budgetBase).toBe($(2));
    expect(listLaunches(c)[0].budgetBase).toBe($(9));
  });

  it("ONE FOUNDER'S FAILURE NEVER TOUCHES ANOTHER'S MONEY", async () => {
    const bad = founder(), good = founder();
    upsertMandate(bad, { enabled: 1, productUrl: "https://acme.io", vetoWindowMinutes: 20 }, NOW);
    upsertMandate(good, { enabled: 1, productUrl: "https://acme.io", vetoWindowMinutes: 20 }, NOW);
    vi.mocked(mandateStateFor).mockImplementation(async (addr: string) => {
      if (addr === bad) throw new Error("chain read exploded");
      return state() as never;
    });

    const r = await runOperatorTick(NOW);
    expect(r.founders).toBe(1); // the healthy one still completed
    expect(listLaunches(good)).toHaveLength(1);
    expect(listLaunches(bad)).toHaveLength(0);
  });

  it("A TREASURY THAT DRAINS BEFORE THE WINDOW CLOSES DOES NOT SPEND", async () => {
    const f = founder();
    upsertMandate(f, { enabled: 1, productUrl: "https://acme.io", vetoWindowMinutes: 20 }, NOW);
    vi.mocked(mandateStateFor).mockResolvedValue(state() as never);
    await runOperatorTick(NOW);
    expect(listLaunches(f)[0].state).toBe("proposed");

    // the founder withdrew between the proposal and its maturity
    vi.mocked(mandateStateFor).mockResolvedValue(state({ balanceBase: 0 }) as never);
    vi.mocked(startInspection).mockReturnValue({ ok: true, created: true, job: { id: "job_x" } } as never);
    const after = await runOperatorTick(NOW + 1300);

    expect(after.committed).toBe(0);
    expect(startInspection).not.toHaveBeenCalled();
    expect(listLaunches(f)[0].state).toBe("proposed");
  });

  it("never stacks a second proposal on top of an open one, however many ticks run", async () => {
    const f = founder();
    upsertMandate(f, { enabled: 1, productUrl: "https://acme.io", vetoWindowMinutes: 20 }, NOW);
    vi.mocked(mandateStateFor).mockResolvedValue(state() as never);
    for (let i = 0; i < 5; i++) await runOperatorTick(NOW + i * 60);
    expect(listLaunches(f)).toHaveLength(1);
  });

  it("a vetoed proposal frees the week's budget again, so one veto does not stall the agent", async () => {
    const f = founder();
    upsertMandate(f, { enabled: 1, productUrl: "https://acme.io", vetoWindowMinutes: 20 }, NOW);
    vi.mocked(mandateStateFor).mockResolvedValue(state() as never);
    await runOperatorTick(NOW);
    updateLaunch(listLaunches(f)[0].id, { state: "vetoed", vetoReason: "not now" });
    const again = await runOperatorTick(NOW + 120);
    expect(again.proposed).toBe(1);
    expect(listLaunches(f).filter((l) => l.state === "proposed")).toHaveLength(1);
  });
});
