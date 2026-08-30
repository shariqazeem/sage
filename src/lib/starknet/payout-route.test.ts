import { beforeEach, describe, expect, it, vi } from "vitest";
import { CallData } from "starknet";
import ABI from "./vault-abi.json";

/**
 * WHICH ENTRYPOINT A PAYOUT USES, AND WHY IT IS NOT A PREFERENCE.
 *
 * `request_payout_to` exists only in the class declared 2026-08-30. A vault deployed before it
 * reverts on that selector, and on the settlement path a revert is a worker whose cleared
 * submission cannot be paid. So the route is read from the vault's CLASS, and the encoding follows
 * the route rather than the other way round.
 */

const getClassHashAt = vi.fn(async (_a: string) => "0x0");
vi.mock("server-only", () => ({}));
vi.mock("starknet", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    RpcProvider: class {
      getClassHashAt = (...a: unknown[]) => getClassHashAt(...(a as [string]));
    },
    Account: class {},
  };
});
/** Flipped by the "unreadable" case, so the provider cannot be built at all. */
const cfg = { configured: true };
vi.mock("./config", () => ({
  starknetConfig: () => ({
    rpcUrl: "https://rpc.test", claimsAddress: "0x6fe", tokenAddress: "0x033",
    accountAddress: "0x46a", privateKey: "0x1",
  }),
  starknetAddresses: () => (cfg.configured ? { claims: "0x6fe", token: "0x033", rpcUrl: "https://rpc.test" } : null),
}));

import { payoutCall, payoutRouteFor } from "./vault";

const SPLIT = "0x715ab98f0d29548209259a6283d1b1db317b07b4f16441b068c02eaa40ffa87";
const LEGACY = "0x2770f9fde4668abd9bfffbf8aeca2ce5d104ed812054afa22cdc78356500e84";
const VAULT = "0x9bd1ea4e66d6b1dd0d92e8e4a4b9ae82df0c260c2a25ce4c0015501d83d3f8";

beforeEach(() => getClassHashAt.mockReset().mockResolvedValue(LEGACY));

describe("the route a vault can serve", () => {
  it("is split for the declared class", async () => {
    getClassHashAt.mockResolvedValue(SPLIT);
    expect(await payoutRouteFor(VAULT)).toBe("split");
  });

  it("is direct for the class the live campaign runs", async () => {
    expect(await payoutRouteFor(VAULT)).toBe("direct");
  });

  it("is direct when the class cannot be read at all", async () => {
    // Stranding a worker is worse than paying one publicly, and the public payout is recoverable
    // in a way a stranded one is not.
    //
    // Unreadability is induced by an UNCONFIGURED provider rather than by making the spy throw:
    // vitest attributes an error raised inside a mock to the test itself, even when the code under
    // test caught it, so that shape reports a failure for the very behaviour being verified.
    cfg.configured = false;
    try {
      await expect(payoutRouteFor(VAULT)).resolves.toBe("direct");
    } finally {
      cfg.configured = true;
    }
  });

  it("is direct for a class hash it cannot parse", async () => {
    getClassHashAt.mockResolvedValue("not-a-class-hash");
    await expect(payoutRouteFor(VAULT)).resolves.toBe("direct");
  });
});

describe("what each route actually encodes", () => {
  // The encoder is exercised through the ABI directly: what matters is that the two entrypoints
  // take their arguments in the order the contract deserialises them.
  it("request_payout_to puts worker BEFORE payout_target", () => {
    const cd = new CallData(ABI).compile("request_payout_to", {
      mission_id: "0x1", worker: "0x2", payout_target: "0x3",
      decision_digest: "0x4", intent_hash: "0x5",
    });
    // One field out of place is a revert with no message — the pool and the vault both
    // deserialise straight into their signature.
    expect(cd.map(String)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("request_payout still takes the worker as the single recipient", () => {
    const cd = new CallData(ABI).compile("request_payout", {
      mission_id: "0x1", recipient: "0x2", decision_digest: "0x3", intent_hash: "0x4",
    });
    expect(cd.map(String)).toEqual(["1", "2", "3", "4"]);
  });
});

describe("which entrypoint a payout is encoded against", () => {
  const base = {
    vaultAddress: VAULT, missionId: "0x1", recipient: "0x2",
    decisionDigest: "0x4", intentHash: "0x5",
  };

  it("uses the LEGACY entrypoint when no separate destination is asked for", () => {
    // A vault predating the split has only this one. Reaching for request_payout_to by default
    // would revert as an unknown selector on every existing campaign.
    expect(payoutCall(base).entrypoint).toBe("request_payout");
  });

  it("uses the legacy entrypoint when the destination IS the worker", () => {
    // Same destination is the public rail, and the public rail must stay on the older selector so
    // a legacy vault keeps working without anyone having to know which class it is.
    expect(payoutCall({ ...base, payoutTarget: "0x2" }).entrypoint).toBe("request_payout");
    expect(payoutCall({ ...base, payoutTarget: "0x002" }).entrypoint).toBe("request_payout");
  });

  it("uses the split entrypoint only when the money goes somewhere else", () => {
    const call = payoutCall({ ...base, payoutTarget: "0x3" });
    expect(call.entrypoint).toBe("request_payout_to");
    expect(call.calldata.map(String)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("puts the WORKER before the destination, which is the order the contract deserialises", () => {
    // One field out of place is a revert with no message.
    const call = payoutCall({ ...base, recipient: "0x7", payoutTarget: "0x9" });
    expect(call.calldata.map(String)).toEqual(["1", "7", "9", "4", "5"]);
  });
});
