import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE WHOLE LOOP, END TO END, against the real ledger.
 *
 * `tick.test.ts` mocks the state assembly to pin one behaviour at a time. This does the opposite:
 * everything real — the mandate row, the observations read from real campaigns, the sizing, the
 * model boundary, the proposal, the veto window, the commitment, and the real `startInspection`
 * door with its SSRF guards — and stubs ONLY the two places money would actually move:
 *
 *   1. the treasury's USDC balance, read from the chain
 *   2. the Privy deploy, which is what spends it
 *
 * So the pass criterion is not "the mocks agree with each other". It is: given a funded treasury,
 * does Sage decide, say why, wait to be argued with, and then start real work.
 */
vi.mock("@/lib/telegram/agent-wallet-tools", async (orig) => ({
  ...(await orig<typeof import("@/lib/telegram/agent-wallet-tools")>()),
  usdcBalanceBase: vi.fn(async () => BigInt(60_000_000)),
}));
vi.mock("@/lib/treasury/web", () => ({
  webTreasuryKey: (a: string) => `web:${a}`,
  getWebTreasury: vi.fn(() => ({ chatId: "web:t", founderAddress: "0x", privyWalletId: "pw", privyWalletAddress: `0x${"c".repeat(40)}`, policyId: "p", perCampaignCapBase: 15_000_000, chainId: 2345, createdAt: 0, updatedAt: 0 })),
}));
vi.mock("@/lib/treasury/launch", () => ({ launchFromTreasury: vi.fn(async () => ({ ok: false, reason: "failed", message: "no Privy wallet in this environment" })) }));
vi.mock("@/lib/launch/job", () => ({ runInspectionJob: vi.fn(async () => {}) }));
vi.mock("@/lib/llm/complete", () => ({ llmCompleteJson: vi.fn() }));

const { runOperatorTick } = await import("./tick");
const { upsertMandate, listLaunches, updateLaunch, armedMandates } = await import("@/lib/db/operator");
const { llmCompleteJson } = await import("@/lib/llm/complete");
const { launchFromTreasury } = await import("@/lib/treasury/launch");
const { getInspectionJob, updateInspectionJob } = await import("@/lib/db/inspection");

const NOW = 1_800_000_000;
let seq = 0;
let FOUNDER = "";

const answer = (json: unknown) => ({ json, model: "m", provider: "p", latencyMs: 1, promptTokens: 1, completionTokens: 1 }) as never;

describe("the standing mandate, end to end on a real ledger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // the tick's work list is EVERY armed mandate — correct for running many founders at once, so a
    // test that wants to watch one has to be the only one armed.
    for (const m of armedMandates()) upsertMandate(m.founderAddress, { enabled: 0 }, NOW);
    FOUNDER = `0x${String(++seq).padStart(4, "0").repeat(10)}`;
    upsertMandate(FOUNDER, { enabled: 1, productUrl: "https://acme.io", goal: "get developers through the quickstart", vetoWindowMinutes: 20, probeBase: 5_000_000, minSpacingMinutes: 0 }, NOW);
    vi.mocked(llmCompleteJson).mockResolvedValue(answer({ surface: "acme.io", kind: "testing", goal: "Have real people follow the quickstart on acme.io and report exactly where they got stuck.", reason: "nothing has been run against this product yet" }));
  });

  it("decides, prices it itself, says why, and waits to be argued with", async () => {
    const r = await runOperatorTick(NOW);
    expect(r.proposed).toBe(1);

    const [p] = listLaunches(FOUNDER);
    expect(p.state).toBe("proposed");
    expect(p.surface).toBe("acme.io");
    expect(p.kind).toBe("testing");
    expect(p.decidedBy).toBe("llm");
    // the model never set this: the mandate did, from the policy and the balance
    expect(p.budgetBase).toBe(5_000_000);
    expect(p.reason).toContain("nothing has been run against this product yet");
    expect(p.reason).toMatch(/sized at \$5\.00/);
    expect(p.commitAt).toBe(NOW + 1200);
    // and it has not touched the world yet
    expect(p.jobId).toBeNull();
    expect(launchFromTreasury).not.toHaveBeenCalled();
  });

  it("commits after the window by starting REAL work, then fails honestly when it cannot deploy", async () => {
    await runOperatorTick(NOW);
    const [p] = listLaunches(FOUNDER);

    const committed = await runOperatorTick(NOW + 1300);
    expect(committed.committed).toBe(1);
    const afterCommit = listLaunches(FOUNDER).find((x) => x.id === p.id);
    expect(afterCommit?.state).toBe("committed");

    // a real inspection job exists, carrying the budget the MANDATE chose and the goal the model wrote
    const job = getInspectionJob(afterCommit?.jobId ?? "");
    expect(job).toBeTruthy();
    expect(Number(job?.totalBudgetBase)).toBe(5_000_000);
    expect(job?.productUrl).toContain("acme.io");

    // while the design is still running it WAITS rather than deploying a plan that does not exist
    const waiting = await runOperatorTick(NOW + 1400);
    expect(waiting.launched).toBe(0);
    expect(listLaunches(FOUNDER).find((x) => x.id === p.id)?.state).toBe("committed");

    // once the plan is ready it tries to deploy, and says why it could not instead of retrying forever
    updateInspectionJob(afterCommit?.jobId ?? "", "ready");
    const launched = await runOperatorTick(NOW + 1500);
    expect(launched.launched).toBe(0);
    expect(launchFromTreasury).toHaveBeenCalledWith(FOUNDER, afterCommit?.jobId);
    const final = listLaunches(FOUNDER).find((x) => x.id === p.id);
    expect(final?.state).toBe("abandoned");
    expect(final?.reason).toMatch(/abandoned: no Privy wallet/);
  });

  it("gives up on a design that never finishes, rather than holding the week's budget forever", async () => {
    await runOperatorTick(NOW);
    await runOperatorTick(NOW + 1300);
    const [p] = listLaunches(FOUNDER);
    expect(p.state).toBe("committed");
    const later = await runOperatorTick(NOW + 1300 + 61 * 60);
    expect(later.launched).toBe(0);
    const final = listLaunches(FOUNDER).find((x) => x.id === p.id);
    expect(final?.state).toBe("abandoned");
    expect(final?.reason).toMatch(/did not finish in an hour/);
  });

  it("a founder's veto inside the window stops it for good, and no work is ever started", async () => {
    await runOperatorTick(NOW);
    const [p] = listLaunches(FOUNDER);
    updateLaunch(p.id, { state: "vetoed", vetoReason: "not this product" });

    const after = await runOperatorTick(NOW + 5000);
    expect(after.committed).toBe(0);
    expect(listLaunches(FOUNDER).find((x) => x.id === p.id)?.state).toBe("vetoed");
    // vetoed money is released, so the agent is free to propose something else
    expect(after.proposed).toBe(1);
  });

  it("refuses to spend at all when the treasury cannot cover the floor, and names the reason", async () => {
    upsertMandate(FOUNDER, { reserveFloorBase: 100_000_000 }, NOW);
    const r = await runOperatorTick(NOW);
    expect(r.proposed).toBe(0);
    expect(r.held.join(" ")).toMatch(/reserve floor/);
  });
});
