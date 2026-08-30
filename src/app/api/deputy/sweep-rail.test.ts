import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE MANUALLY-APPROVED PATH IS THE LIKELIEST PATH OF ALL RIGHT NOW.
 *
 * Autopay holds anything below the bar, and a held submission is exactly what a founder reviews
 * and approves by hand. The sweep then settles it — and it called the EVM settle flow for every
 * approved submission whatever chain its campaign pays on. That flow's first act is
 * `getAddress(campaign.vaultAddress)`, which throws on a felt, so a founder who approved a held
 * Starknet submission got nothing: counted as "other", retried on every tick, forever.
 */

const settleApprovedSubmission = vi.fn(async (_c?: unknown, _s?: unknown) => ({ outcome: { settled: true } }));
const settleOnStarknet = vi.fn(async (_c?: unknown, _s?: unknown) => ({ settled: true }));

vi.mock("@/lib/campaigns/settle-flow", () => ({
  settleApprovedSubmission: (...a: unknown[]) => settleApprovedSubmission(...(a as [])),
}));
vi.mock("@/lib/campaigns/settle-starknet", () => ({
  settleOnStarknet: (...a: unknown[]) => settleOnStarknet(...(a as [])),
}));

/** The routing rule under test, extracted exactly as the sweep applies it. */
const settleFor = async (campaign: { settlementRail?: string }, sub: unknown) =>
  campaign.settlementRail === "starknet"
    ? await settleOnStarknet(campaign as never, sub as never)
    : (await settleApprovedSubmission(campaign as never, sub as never)).outcome;

beforeEach(() => {
  settleApprovedSubmission.mockClear();
  settleOnStarknet.mockClear();
});

describe("settling a founder-approved submission", () => {
  it("pays a Starknet campaign through the Cairo vault", async () => {
    await settleFor({ settlementRail: "starknet" }, { id: "s1" });
    expect(settleOnStarknet).toHaveBeenCalledTimes(1);
    expect(settleApprovedSubmission).not.toHaveBeenCalled();
  });

  it("pays an EVM campaign exactly as before", async () => {
    await settleFor({ settlementRail: "evm" }, { id: "s1" });
    expect(settleApprovedSubmission).toHaveBeenCalledTimes(1);
    expect(settleOnStarknet).not.toHaveBeenCalled();
  });

  it("treats an absent rail as EVM, so no existing campaign changes behaviour", async () => {
    await settleFor({}, { id: "s1" });
    expect(settleApprovedSubmission).toHaveBeenCalledTimes(1);
    expect(settleOnStarknet).not.toHaveBeenCalled();
  });

  it("never sends one campaign's approval down both rails", async () => {
    // Paying twice is the failure this ordering exists to make impossible.
    await settleFor({ settlementRail: "starknet" }, { id: "s1" });
    expect(settleOnStarknet.mock.calls.length + settleApprovedSubmission.mock.calls.length).toBe(1);
  });
});

describe("the sweep source itself", () => {
  it("routes by rail rather than calling the EVM flow unconditionally", async () => {
    const src = (await import("node:fs")).readFileSync(
      "src/app/api/deputy/sweep/route.ts",
      "utf8",
    );
    expect(src).toMatch(/settlementRail === "starknet"[\s\S]{0,120}settleOnStarknet/);
  });
});
