import { describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";

import {
  campaignVaultAbi,
  makeCampaignVaultAdapter,
  campaignFailedCheckReason,
  resolveCanonicalOutcome,
  type CampaignPayoutOutcome,
} from "./campaign-vault";

/**
 * The CampaignVault V2 adapter decode path, exercised against the REAL Foundry ABI
 * via an INJECTED transport (a fake viem client) + an injected signer (a fake
 * broadcast). This proves the exact things the money path depends on:
 *   - requestPayout is called with FOUR args and NO amount (the vault derives it);
 *   - PayoutSettled / PayoutRejected decode correctly, including the exact reward;
 *   - a receipt whose event was emitted by a DIFFERENT contract is refused;
 *   - the V2 reject-reason map speaks mission language (1..10).
 */

const VAULT = getAddress("0x1111111111111111111111111111111111111111");
const OTHER = getAddress("0x2222222222222222222222222222222222222222");
const RECIPIENT = getAddress("0x3333333333333333333333333333333333333333");
const MISSION = `0x${"a".repeat(64)}` as Hash;
const INTENT = `0x${"b".repeat(64)}` as Hash;
const DIGEST = `0x${"c".repeat(64)}` as Hash;
const TX = `0x${"d".repeat(64)}` as Hash;

/** Build a REAL PayoutSettled log (topics + data) from the checked-in ABI. */
function settledLog(over: { amount?: bigint; vault?: Address } = {}) {
  const topics = encodeEventTopics({
    abi: campaignVaultAbi,
    eventName: "PayoutSettled",
    args: { missionId: MISSION, recipient: RECIPIENT, intentHash: INTENT },
  });
  const data = encodeAbiParameters(
    [
      { type: "bytes32" }, // decisionDigest
      { type: "uint256" }, // amount
      { type: "uint256" }, // timestamp
      { type: "uint256" }, // totalSpentAfter
      { type: "uint256" }, // budgetRemaining
    ],
    [DIGEST, over.amount ?? BigInt(500_000), BigInt(1_700_000_000), BigInt(500_000), BigInt(1_500_000)],
  );
  return { address: over.vault ?? VAULT, topics, data, blockNumber: BigInt(4242) };
}

/** Build a REAL PayoutRejected log with a given failedCheckIndex. */
function rejectedLog(failedCheckIndex: number) {
  const topics = encodeEventTopics({
    abi: campaignVaultAbi,
    eventName: "PayoutRejected",
    args: { missionId: MISSION, recipient: RECIPIENT, intentHash: INTENT },
  });
  const data = encodeAbiParameters(
    [
      { type: "bytes32" }, // decisionDigest
      { type: "uint256" }, // amount
      { type: "uint256" }, // timestamp
      { type: "uint8" }, // failedCheckIndex
      { type: "uint256" }, // totalSpentSoFar
      { type: "uint256" }, // budgetRemaining
    ],
    [DIGEST, BigInt(500_000), BigInt(1_700_000_000), failedCheckIndex, BigInt(0), BigInt(2_000_000)],
  );
  return { address: VAULT, topics, data, blockNumber: BigInt(4243) };
}

/** A fake viem client that returns a canned receipt with the given logs. */
function fakeClient(receipt: {
  status?: "success" | "reverted";
  to?: Address;
  logs: ReturnType<typeof settledLog>[];
}): PublicClient {
  return {
    waitForTransactionReceipt: vi.fn(async () => ({
      status: receipt.status ?? "success",
      to: receipt.to ?? VAULT,
      logs: receipt.logs,
      blockNumber: BigInt(4242),
    })),
  } as unknown as PublicClient;
}

describe("CampaignVault adapter — injected transport, real ABI decode", () => {
  it("requestPayout sends FOUR args (no amount) and decodes the settled reward", async () => {
    const broadcast = vi.fn<
      (
        chainId: number,
        req: { address: Address; functionName: string; args: readonly unknown[] },
      ) => Promise<Hash>
    >(async () => TX);
    const adapter = makeCampaignVaultAdapter({
      client: () => fakeClient({ logs: [settledLog({ amount: BigInt(500_000) })] }),
      broadcast,
      factoryAddress: () => OTHER,
    });

    const onBroadcast = vi.fn();
    const out = await adapter.requestPayout({
      vault: VAULT,
      missionId: MISSION,
      recipient: RECIPIENT,
      decisionDigest: DIGEST,
      intentHash: INTENT,
      chainId: 59902,
      onBroadcast,
    });

    // the write carried requestPayout(missionId, recipient, decisionDigest, intentHash) — NO amount.
    expect(broadcast).toHaveBeenCalledTimes(1);
    const req = broadcast.mock.calls[0][1];
    expect(req.functionName).toBe("requestPayout");
    expect(req.args).toEqual([MISSION, RECIPIENT, DIGEST, INTENT]);
    expect(req.args).toHaveLength(4);
    // the tx hash was surfaced the instant it broadcast (durable-persist hook).
    expect(onBroadcast).toHaveBeenCalledWith(TX);

    expect(out.status).toBe("settled");
    expect(out.amountBase).toBe(500_000);
    expect(out.missionId).toBe(MISSION);
    expect(getAddress(out.recipient)).toBe(RECIPIENT);
    expect(out.intentHash).toBe(INTENT);
    expect(out.decisionDigest).toBe(DIGEST);
    expect(getAddress(out.vault)).toBe(VAULT);
    expect(out.txHash).toBe(TX);
  });

  it("decodes a PayoutRejected with a mission-language reason (1..10)", async () => {
    const adapter = makeCampaignVaultAdapter({
      client: () => fakeClient({ logs: [rejectedLog(6)] }),
      broadcast: async () => TX,
      factoryAddress: () => OTHER,
    });
    const out = await adapter.awaitOutcome(TX, 59902, VAULT);
    expect(out.status).toBe("rejected");
    expect(out.failedCheckIndex).toBe(6);
    expect(campaignFailedCheckReason(out.failedCheckIndex)).toContain("already been paid");
  });

  it("REFUSES a receipt whose event came from a different contract", async () => {
    const adapter = makeCampaignVaultAdapter({
      client: () => fakeClient({ logs: [settledLog({ vault: OTHER })] }),
      broadcast: async () => TX,
      factoryAddress: () => OTHER,
    });
    // the only log is from OTHER, not VAULT → no trusted event → throws.
    await expect(adapter.awaitOutcome(TX, 59902, VAULT)).rejects.toThrow();
  });

  it("REFUSES a receipt sent to the wrong contract address", async () => {
    const adapter = makeCampaignVaultAdapter({
      client: () => fakeClient({ to: OTHER, logs: [settledLog()] }),
      broadcast: async () => TX,
      factoryAddress: () => OTHER,
    });
    await expect(adapter.awaitOutcome(TX, 59902, VAULT)).rejects.toThrow(/expected vault/);
  });

  it("REFUSES a reverted requestPayout tx", async () => {
    const adapter = makeCampaignVaultAdapter({
      client: () => fakeClient({ status: "reverted", logs: [] }),
      broadcast: async () => TX,
      factoryAddress: () => OTHER,
    });
    await expect(adapter.awaitOutcome(TX, 59902, VAULT)).rejects.toThrow(/reverted/);
  });

  it("persists the broadcast IDENTITY (onPreflight) BEFORE it submits (onBroadcast)", async () => {
    const order: string[] = [];
    const adapter = makeCampaignVaultAdapter({
      client: () => fakeClient({ logs: [settledLog()] }),
      broadcast: async () => {
        order.push("submit");
        return TX;
      },
      operatorAddress: () => OTHER,
      factoryAddress: () => OTHER,
    });
    await adapter.requestPayout({
      vault: VAULT,
      missionId: MISSION,
      recipient: RECIPIENT,
      decisionDigest: DIGEST,
      intentHash: INTENT,
      chainId: 59902,
      onPreflight: () => {
        order.push("preflight");
      },
      onBroadcast: () => {
        order.push("broadcast-hash");
      },
    });
    // identity is durable BEFORE the RPC can accept anything.
    expect(order).toEqual(["preflight", "submit", "broadcast-hash"]);
  });
});

/* ── canonical outcome resolution: a settlement is never overridden ────────── */

function outcome(over: Partial<CampaignPayoutOutcome>): CampaignPayoutOutcome {
  return {
    status: "settled",
    txHash: `0x${"a".repeat(64)}` as Hash,
    blockNumber: 1,
    vault: VAULT,
    chainId: 59902,
    missionId: MISSION,
    recipient: RECIPIENT,
    intentHash: INTENT,
    decisionDigest: DIGEST,
    amountBase: 500_000,
    failedCheckIndex: null,
    explorerUrl: "x",
    ...over,
  };
}

describe("resolveCanonicalOutcome — a settlement is the economic truth", () => {
  const settled = outcome({ status: "settled", txHash: `0x${"1".repeat(64)}` as Hash });
  const replayReject = outcome({
    status: "rejected",
    txHash: `0x${"2".repeat(64)}` as Hash,
    failedCheckIndex: 8,
    blockNumber: 2,
  });
  const budgetReject = outcome({
    status: "rejected",
    txHash: `0x${"3".repeat(64)}` as Hash,
    failedCheckIndex: 9,
  });

  it("settlement only → settled", () => {
    expect(resolveCanonicalOutcome([settled])).toEqual({ kind: "settled", outcome: settled });
  });
  it("non-replay rejection only → rejected (our tx genuinely failed)", () => {
    expect(resolveCanonicalOutcome([budgetReject]).kind).toBe("rejected");
  });
  it("settlement THEN replay rejection → settled wins", () => {
    expect(resolveCanonicalOutcome([settled, replayReject]).kind).toBe("settled");
  });
  it("logs returned in REVERSE order → still settled (order-independent)", () => {
    expect(resolveCanonicalOutcome([replayReject, settled]).kind).toBe("settled");
  });
  it("a replay rejection with NO settlement → HOLD (never conceal a settlement)", () => {
    expect(resolveCanonicalOutcome([replayReject]).kind).toBe("replay_no_settlement");
  });
  it("TWO settlements for one intent → a critical invariant violation", () => {
    const dup = outcome({ status: "settled", txHash: `0x${"9".repeat(64)}` as Hash });
    expect(resolveCanonicalOutcome([settled, dup]).kind).toBe("duplicate_settlement");
  });
  it("no relevant outcomes → none", () => {
    expect(resolveCanonicalOutcome([]).kind).toBe("none");
  });
});
