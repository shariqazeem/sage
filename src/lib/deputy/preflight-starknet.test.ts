import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * THE PRE-FLIGHT A STARKNET SUBMISSION ACTUALLY REACHES.
 *
 * Before this, every Starknet submission entered the EVM pre-flight, whose first statement is
 * `getAddress(campaign.vaultAddress)`. A Starknet address is a felt; viem rejects it and throws
 * SYNCHRONOUSLY, ahead of every try/catch below it. The submission reset to pending and the next
 * sweep retried it — forever — while the rail's own settlement branch, further down the pipeline,
 * was never reached. Nobody was ever paid and nothing said so.
 */

const state = vi.fn();
const balance = vi.fn();

vi.mock("@/lib/starknet/vault", () => ({
  readVaultState: (...a: unknown[]) => state(...a),
  readVaultBalance: (...a: unknown[]) => balance(...a),
}));

const FELT = "0x69c2d2cab84b227c01e07d75f6a065270e610ae490067b8b06f4c07a8af040d";

const campaign = (over: Record<string, unknown> = {}) =>
  ({
    id: "c1",
    vaultAddress: FELT,
    vaultKind: "sage_vault_starknet",
    settlementRail: "starknet",
    rewardAmount: 500_000,
    ...over,
  }) as never;

const active = {
  statusLabel: "active",
  budgetCeilingBase: BigInt(2_000_000),
  totalSpentBase: BigInt(0),
};

beforeEach(() => {
  state.mockReset();
  balance.mockReset();
  state.mockResolvedValue(active);
  balance.mockResolvedValue(BigInt(2_000_000));
});

// The function is module-private, so it is exercised through the module's own export surface.
const load = async () => {
  const mod = await import("./pipeline");
  return mod as unknown as {
    __preflightStarknetForTest?: (c: never) => Promise<{ ok: boolean; reason: string }>;
  };
};

describe("a Starknet address never reaches viem", () => {
  it("does not throw on a felt vault address, as getAddress would", async () => {
    const { getAddress } = await import("viem");
    // The exact failure this pre-flight exists to avoid, pinned so it cannot be mistaken for
    // a hypothetical: viem genuinely rejects a real Starknet address.
    expect(() => getAddress(FELT)).toThrow();
  });
});

describe("preflightStarknet", () => {
  it("passes a live, funded vault", async () => {
    const mod = await load();
    const fn = mod.__preflightStarknetForTest;
    expect(fn).toBeTypeOf("function");
    await expect(fn!(campaign())).resolves.toMatchObject({ ok: true });
  });

  it("holds a paused or revoked vault, naming which", async () => {
    const fn = (await load()).__preflightStarknetForTest!;
    for (const label of ["paused", "revoked"]) {
      state.mockResolvedValue({ ...active, statusLabel: label });
      const r = await fn(campaign());
      expect(r.ok).toBe(false);
      expect(r.reason).toContain(label);
    }
  });

  it("holds when the vault cannot cover this reward", async () => {
    balance.mockResolvedValue(BigInt(100_000));
    const fn = (await load()).__preflightStarknetForTest!;
    const r = await fn(campaign());
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/does not hold enough/i);
  });

  it("holds when the campaign's ceiling is spent, even with money in the vault", async () => {
    // The vault would refuse this anyway; catching it here saves the gas and gives a real reason.
    state.mockResolvedValue({ ...active, totalSpentBase: BigInt(1_900_000) });
    const fn = (await load()).__preflightStarknetForTest!;
    expect((await fn(campaign())).reason).toMatch(/ceiling/i);
  });

  it("holds rather than failing when the chain cannot be read", async () => {
    // Unreadable is not insufficient. The next sweep tries again.
    state.mockRejectedValue(new Error("rpc down"));
    const fn = (await load()).__preflightStarknetForTest!;
    const r = await fn(campaign());
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unreadable/i);
  });

  it("skips the vault read for a direct-pay Starknet campaign, which has none", async () => {
    const fn = (await load()).__preflightStarknetForTest!;
    const r = await fn(campaign({ vaultKind: "policy_v1" }));
    expect(r.ok).toBe(true);
    expect(state).not.toHaveBeenCalled();
  });
});

describe("which pre-flight a campaign is routed to", () => {
  // The routing IS the defect. Testing the Starknet pre-flight in isolation proves it behaves;
  // only this proves a Starknet submission actually reaches it.
  it("sends every Starknet campaign to the Starknet pre-flight", async () => {
    const { preflightStrategy } = await import("./pipeline");
    for (const vaultKind of ["sage_vault_starknet", "policy_v1", "campaign_v2"]) {
      expect(preflightStrategy(campaign({ vaultKind }))).toBe("starknet");
    }
  });

  it("leaves the EVM rails exactly where they were", async () => {
    const { preflightStrategy } = await import("./pipeline");
    expect(preflightStrategy(campaign({ settlementRail: "evm", vaultKind: "campaign_v2" }))).toBe("v2");
    expect(preflightStrategy(campaign({ settlementRail: "evm", vaultKind: "policy_v1" }))).toBe("legacy");
  });
});
