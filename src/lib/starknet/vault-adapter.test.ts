import { beforeEach, describe, expect, it, vi } from "vitest";

const getClassHashAt = vi.fn();
const call = vi.fn();

vi.mock("starknet", () => ({
  RpcProvider: class {
    getClassHashAt = (...a: unknown[]) => getClassHashAt(...a);
  },
  Contract: class {
    call = (...a: unknown[]) => call(...a);
  },
}));
vi.mock("./config", () => ({
  starknetAddresses: () => ({ rpcUrl: "https://rpc", claims: "0x1", token: "0x2" }),
  starknetVaultClassHash: () => classHash,
}));

let classHash: string | null = "0x603be1eb";

/**
 * PROVENANCE ON STARKNET IS THE CLASS HASH.
 *
 * On EVM a vault is trusted because a known factory made it. The Universal Deployer vouches for
 * nobody, so what proves a Starknet vault is Sage's is that its code IS Sage's code — a stronger
 * statement than factory membership, since a factory can be asked to make something unexpected.
 */
const VALUES: Record<string, unknown> = {
  get_owner: BigInt("0x4f1f"),
  get_operator: BigInt("0x46a1"),
  get_token: BigInt("0x330"),
  get_status: { variant: { Active: {} } },
  get_budget_ceiling: BigInt(1_000_000),
  get_campaign_id_hash: BigInt("0xaaa"),
  get_mission_plan_digest: BigInt("0xbbb"),
};

beforeEach(() => {
  classHash = "0x603be1eb";
  getClassHashAt.mockReset().mockResolvedValue("0x603be1eb");
  call.mockReset().mockImplementation((fn: string, args: unknown[]) => {
    if (fn === "get_mission") {
      return Promise.resolve({ exists: true, reward: BigInt(500_000), max_completions: BigInt(1) });
    }
    if (fn in VALUES) return Promise.resolve(VALUES[fn]);
    throw new Error(`unexpected call ${fn}`);
  });
});

const read = async (missionIds: string[] = ["0xm1"]) => {
  const { readStarknetSnapshot } = await import("./vault-adapter");
  return readStarknetSnapshot("0xvault" as never, 900_001, missionIds as never);
};

describe("readStarknetSnapshot", () => {
  it("recognises a vault whose code is Sage's declared class", async () => {
    expect((await read()).factoryRecognizes).toBe(true);
  });

  it("REFUSES a vault of any other class, however well it answers", async () => {
    // The whole point: a contract can implement the same getters and return anything it likes.
    getClassHashAt.mockResolvedValue("0xdeadbeef");
    expect((await read()).factoryRecognizes).toBe(false);
  });

  it("compares class hashes numerically, not as strings", async () => {
    // The same class, spelled with a leading zero, is the same class.
    getClassHashAt.mockResolvedValue("0x0603be1eb");
    expect((await read()).factoryRecognizes).toBe(true);
  });

  it("throws rather than reporting a snapshot when no class is declared", async () => {
    // "Cannot check provenance" must never read as "checked and fine".
    classHash = null;
    await expect(read()).rejects.toThrow(/CLASS_HASH/i);
  });

  it("throws when there is no contract at the address", async () => {
    getClassHashAt.mockRejectedValue(new Error("not found"));
    await expect(read()).rejects.toThrow(/no contract/i);
  });

  it("reads the plan the vault was funded for", async () => {
    const s = await read();
    expect(s.campaignIdHash).toBe("0xaaa");
    expect(s.missionPlanDigest).toBe("0xbbb");
  });

  it("reads the real status rather than defaulting", async () => {
    expect((await read()).state).toBe("active");
    VALUES.get_status = { variant: { Revoked: {} } };
    expect((await read()).state).toBe("revoked");
    VALUES.get_status = { variant: { Active: {} } };
  });

  it("records an unreadable mission as ABSENT with zero terms, never as present", async () => {
    // Absent fails the agreement check. Present-with-unknown-terms would let a campaign attach to
    // a mission the vault cannot actually pay.
    call.mockImplementation((fn: string) => {
      if (fn === "get_mission") throw new Error("rpc blip");
      return Promise.resolve(VALUES[fn]);
    });
    const m = (await read(["0xm1"])).missions["0xm1"];
    expect(m).toEqual({ exists: false, rewardBase: BigInt(0), maxCompletions: BigInt(0) });
  });

  it("reports no guardian as zero, which the agreement check reads as 'none'", async () => {
    expect(BigInt((await read()).guardian)).toBe(BigInt(0));
  });

  it("declares replay protection, which the Cairo vault enforces itself", async () => {
    expect((await read()).replaySupport).toBe("supported");
  });
});
