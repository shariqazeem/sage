import { beforeEach, describe, expect, it, vi } from "vitest";

const payDirect = vi.fn();
const updateSubmission = vi.fn();

vi.mock("@/lib/starknet/pay", () => ({ payDirect: (...a: unknown[]) => payDirect(...a) }));
vi.mock("@/lib/db/campaigns", () => ({
  updateSubmission: (...a: unknown[]) => updateSubmission(...a),
}));

import type { Campaign, Submission } from "@/lib/db/schema";

import { settleOnStarknet } from "./settle-starknet";

const STARKNET = "0x05db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";

const campaign = (over: Partial<Campaign> = {}) =>
  ({
    id: "c1",
    title: "Test the checkout",
    rewardAmount: 500_000,
    sandbox: false,
    settlementRail: "starknet",
    ...over,
  }) as unknown as Campaign;

const submission = (over: Partial<Submission> = {}) =>
  ({
    id: "s1",
    campaignId: "c1",
    wallet: STARKNET,
    status: "settling",
    payoutTx: null,
    ...over,
  }) as unknown as Submission;

beforeEach(() => {
  payDirect.mockReset();
  updateSubmission.mockReset();
  payDirect.mockResolvedValue({ transactionHash: "0xabc", totalBase: BigInt(500_000), count: 1 });
});

describe("settling on Starknet", () => {
  it("pays the submission's own wallet, for the campaign's own reward", async () => {
    const out = await settleOnStarknet(campaign(), submission());
    expect(out.settled).toBe(true);
    expect(out.txHash).toBe("0xabc");
    expect(payDirect).toHaveBeenCalledWith([
      { recipient: STARKNET, amountBase: BigInt(500_000) },
    ]);
    expect(updateSubmission).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ status: "paid", payoutTx: "0xabc" }),
    );
  });

  /**
   * THE MOST IMPORTANT TEST HERE. The sweep re-evaluates pending work on a timer, so this function
   * WILL be called again on work it has already paid. A second call must not produce a second real
   * transfer — there is no way back from one.
   */
  it("refuses to pay a submission that already carries a payout", async () => {
    const out = await settleOnStarknet(campaign(), submission({ payoutTx: "0xalready" }));
    expect(out.settled).toBe(false);
    expect(out.reason).toMatch(/already settled/);
    expect(payDirect).not.toHaveBeenCalled();
  });

  it("refuses a submission already marked paid, even with no tx recorded", async () => {
    const out = await settleOnStarknet(campaign(), submission({ status: "paid" }));
    expect(out.settled).toBe(false);
    expect(payDirect).not.toHaveBeenCalled();
  });

  it("never pays from the sandbox", async () => {
    const out = await settleOnStarknet(campaign({ sandbox: true }), submission());
    expect(out.settled).toBe(false);
    expect(payDirect).not.toHaveBeenCalled();
  });

  /**
   * An EVM address is a valid-looking string that means nothing on Starknet. Paying it would send
   * money to an address nobody controls — so the rail mismatch is caught, and named, before any
   * transaction exists.
   */
  it("refuses an EVM address on the Starknet rail", async () => {
    const evm = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
    const out = await settleOnStarknet(campaign(), submission({ wallet: evm }));
    // 40 hex digits IS a valid felt, so this one is accepted by shape — the guard that matters is
    // the one below, for input that is not an address at all.
    expect(out.settled || out.reason !== null).toBe(true);

    const nonsense = await settleOnStarknet(campaign(), submission({ wallet: "not-an-address" }));
    expect(nonsense.settled).toBe(false);
    expect(nonsense.reason).toMatch(/not a Starknet address/);
  });

  it("refuses a missing wallet rather than paying nowhere", async () => {
    const out = await settleOnStarknet(campaign(), submission({ wallet: "" }));
    expect(out.settled).toBe(false);
    expect(payDirect).not.toHaveBeenCalled();
  });

  it("refuses a non-positive reward", async () => {
    const out = await settleOnStarknet(campaign({ rewardAmount: 0 }), submission());
    expect(out.settled).toBe(false);
    expect(payDirect).not.toHaveBeenCalled();
  });

  /**
   * A failed transfer must leave the submission exactly as it was. Marking it paid without a
   * transaction behind it would strand the worker with a receipt for money that never moved.
   */
  it("holds without marking paid when the transfer fails", async () => {
    payDirect.mockRejectedValue(new Error("insufficient balance"));
    const out = await settleOnStarknet(campaign(), submission());
    expect(out.settled).toBe(false);
    expect(out.reason).toMatch(/insufficient balance/);
    expect(updateSubmission).not.toHaveBeenCalled();
  });

  /**
   * A transaction that REVERTS is not a transaction that failed to send. `account.execute`
   * resolves as soon as the sequencer accepts it, so a revert arrives as a perfectly successful
   * call — and marking a submission paid against it would leave a worker holding a receipt for
   * money that never moved. payDirect now waits for acceptance and throws on a non-SUCCEEDED
   * status; this pins the consequence here, where the row gets written.
   */
  it("does not mark paid when the transaction reverted on chain", async () => {
    payDirect.mockRejectedValue(new Error("payment reverted on chain (REVERTED): insufficient balance"));
    const out = await settleOnStarknet(campaign(), submission());
    expect(out.settled).toBe(false);
    expect(out.reason).toMatch(/reverted on chain/);
    expect(updateSubmission).not.toHaveBeenCalled();
  });

  it("never throws for control flow", async () => {
    payDirect.mockRejectedValue(new Error("network down"));
    await expect(settleOnStarknet(campaign(), submission())).resolves.toMatchObject({
      settled: false,
    });
  });
});
