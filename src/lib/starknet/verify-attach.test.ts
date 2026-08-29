import { describe, expect, it } from "vitest";

import { verifyVaultBacksPlan, type AttachInputs, type PlanMission } from "./verify-attach";
import type { MissionTerms, VaultState } from "./vault";

const SAGE = "0x46a1747d854e74e5082c3215841b26dcff182a6a6fd7a1f83c3e1d045996101";
const FOUNDER = "0x05db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";

const state = (over: Partial<VaultState> = {}): VaultState => ({
  owner: FOUNDER,
  operator: SAGE,
  token: "0x33068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb",
  status: 1,
  statusLabel: "active",
  budgetCeilingBase: BigInt(2_000_000),
  dailyCapBase: BigInt(1_000_000),
  totalSpentBase: BigInt(0),
  rollingDailySpendBase: BigInt(0),
  ...over,
});

const terms = (over: Partial<MissionTerms> = {}): MissionTerms => ({
  exists: true,
  rewardBase: BigInt(500_000),
  maxCompletions: 2,
  paidCompletions: 0,
  ...over,
});

const MISSIONS: PlanMission[] = [
  { title: "Sign up and post", missionId: "0xaa", rewardBase: BigInt(500_000), maxCompletions: 2 },
  { title: "Report a bug", missionId: "0xbb", rewardBase: BigInt(500_000), maxCompletions: 2 },
];

const inputs = (over: Partial<AttachInputs> = {}): AttachInputs => ({
  state: state(),
  balanceBase: BigInt(2_000_000),
  onChainMissions: new Map([
    ["0xaa", terms()],
    ["0xbb", terms()],
  ]),
  sageOperator: SAGE,
  claimedOwner: FOUNDER,
  missions: MISSIONS,
  ...over,
});

describe("verifyVaultBacksPlan", () => {
  it("accepts a vault that genuinely backs the plan", () => {
    expect(verifyVaultBacksPlan(inputs())).toEqual({ ok: true });
  });

  it("accepts the same addresses written with different leading zeros", () => {
    // A wallet may return either spelling, and a string comparison would reject a valid vault.
    const padded = `0x${FOUNDER.slice(2).padStart(64, "0")}`;
    expect(verifyVaultBacksPlan(inputs({ claimedOwner: padded })).ok).toBe(true);
  });

  describe("refuses a vault Sage could never pay from", () => {
    it("when the operator is someone else", () => {
      const v = verifyVaultBacksPlan(inputs({ state: state({ operator: "0xdead" }) }));
      expect(v).toMatchObject({ ok: false });
      expect((v as { reason: string }).reason).toMatch(/operator/i);
    });

    it("when the vault is paused or revoked", () => {
      for (const label of ["paused", "revoked", "unknown"] as const) {
        expect(verifyVaultBacksPlan(inputs({ state: state({ statusLabel: label }) })).ok).toBe(false);
      }
    });
  });

  it("refuses a vault owned by someone other than the wallet attaching it", () => {
    // Otherwise a stranger attaches a founder's vault, and can then revoke their campaign.
    const v = verifyVaultBacksPlan(inputs({ claimedOwner: "0xbeef" }));
    expect((v as { reason: string }).reason).toMatch(/owned by a different wallet/i);
  });

  describe("refuses a vault that cannot cover the work", () => {
    it("when the ceiling is below the plan", () => {
      const v = verifyVaultBacksPlan(
        inputs({ state: state({ budgetCeilingBase: BigInt(1_500_000) }) }),
      );
      expect((v as { reason: string }).reason).toMatch(/\$1\.50.*below.*\$2\.00/);
    });

    it("when the ceiling is generous but the vault was never funded", () => {
      // The check that a totals-only reading misses: a ceiling is a limit the owner set, and
      // says nothing about whether the money is there.
      const v = verifyVaultBacksPlan(inputs({ balanceBase: BigInt(0) }));
      expect((v as { reason: string }).reason).toMatch(/\$2\.00 short/);
    });

    it("when it is short by only part of the budget", () => {
      const v = verifyVaultBacksPlan(inputs({ balanceBase: BigInt(1_750_000) }));
      expect((v as { reason: string }).reason).toMatch(/\$0\.25 short/);
    });
  });

  describe("refuses a vault whose missions disagree with the plan", () => {
    it("when a mission was never written into it", () => {
      const v = verifyVaultBacksPlan(inputs({ onChainMissions: new Map([["0xaa", terms()]]) }));
      expect((v as { reason: string }).reason).toMatch(/no terms for "Report a bug"/i);
    });

    it("when a mission is written under a DIFFERENT id than settlement will look up", () => {
      // The silent one. Every total agrees, the vault is funded, and every payout would refuse
      // with NO_SUCH_MISSION — after the work was already done.
      const v = verifyVaultBacksPlan(
        inputs({ onChainMissions: new Map([["0xaa", terms()], ["0xcc", terms()]]) }),
      );
      expect(v.ok).toBe(false);
    });

    it("when the vault underpays what the board advertises", () => {
      // The attack this exists to stop: totals pass, and the worker is paid a fraction.
      const v = verifyVaultBacksPlan(
        inputs({
          onChainMissions: new Map([
            ["0xaa", terms({ rewardBase: BigInt(10_000) })],
            ["0xbb", terms()],
          ]),
        }),
      );
      expect((v as { reason: string }).reason).toMatch(/pays \$0\.01.*advertises \$0\.50/);
    });

    it("when the vault allows fewer completions than the plan offers", () => {
      const v = verifyVaultBacksPlan(
        inputs({
          onChainMissions: new Map([["0xaa", terms({ maxCompletions: 1 })], ["0xbb", terms()]]),
        }),
      );
      expect((v as { reason: string }).reason).toMatch(/allows 1 completions.*offers 2/);
    });

    it("when the vault has already paid — a used vault cannot back a new campaign", () => {
      const v = verifyVaultBacksPlan(
        inputs({
          onChainMissions: new Map([["0xaa", terms({ paidCompletions: 1 })], ["0xbb", terms()]]),
        }),
      );
      expect((v as { reason: string }).reason).toMatch(/already paid/i);
    });
  });

  it("refuses a plan with no missions", () => {
    expect(verifyVaultBacksPlan(inputs({ missions: [] })).ok).toBe(false);
  });

  it("names who the vault belongs to before complaining about its balance", () => {
    // "This is not your vault" is a truer answer than "your vault is short $2".
    const v = verifyVaultBacksPlan(inputs({ claimedOwner: "0xbeef", balanceBase: BigInt(0) }));
    expect((v as { reason: string }).reason).toMatch(/owned by a different wallet/i);
  });
});
