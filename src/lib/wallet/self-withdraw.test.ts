import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { getAddress, type Address, type Hex } from "viem";
import { GOAT_USDC } from "@/lib/deputy/networks";
import { computeDomainSeparator } from "@/lib/privy/recipient-withdraw";
import { __clearWithdrawCooldowns, prepareSelfWithdrawal, submitSelfWithdrawal } from "./self-withdraw";

/**
 * A browser-signed, operator-submitted withdrawal: the signature is the money. The wallet signs
 * exactly what `prepare` hands out; `submit` refuses anything that is not that wallet's own
 * signature over a fresh, in-balance authorization — before the operator's gas is touched.
 */
const owner = privateKeyToAccount(`0x${"1".repeat(64)}`);
const stranger = privateKeyToAccount(`0x${"2".repeat(64)}`);
const to = getAddress(`0x${"9".repeat(40)}`);
const NOW = 1_800_000_000_000;
const token = getAddress(GOAT_USDC);
const readToken = async () => ({
  name: "USD Coin",
  version: "2",
  domainSeparator: computeDomainSeparator("USD Coin", "2", 2345, token),
  balance: BigInt(5_000_000),
});
const submit = vi.fn(async () => `0x${"ab".repeat(32)}` as const);

async function signedBy(account: typeof owner, over: Partial<{ amountBase: bigint; to: Address }> = {}) {
  const p = await prepareSelfWithdrawal({ from: owner.address, to: over.to ?? to, amountBase: over.amountBase ?? BigInt(1_000_000) }, { readToken, now: () => NOW, randomNonce: () => `0x${"cd".repeat(32)}` as Hex });
  const signature = await account.signTypedData(p.typedData);
  return { p, signature };
}

describe("self-withdrawal — prepare, sign, submit", () => {
  beforeEach(() => { __clearWithdrawCooldowns(); submit.mockClear(); });

  it("submits an authorization the wallet itself signed, and the operator pays the gas", async () => {
    const { p, signature } = await signedBy(owner);
    const r = await submitSelfWithdrawal({ from: owner.address, to, amountBase: BigInt(p.amountBase), validBefore: p.validBefore, nonce: p.nonce, signature }, { readToken, submit, now: () => NOW });
    expect(r.txHash).toMatch(/^0xabab/);
    expect(submit).toHaveBeenCalledTimes(1);
    const args = (submit.mock.calls[0] as unknown[])[1] as { functionName: string; args: unknown[] };
    expect(args.functionName).toBe("transferWithAuthorization");
    expect(args.args[0]).toBe(owner.address);
    expect(args.args[1]).toBe(to);
    expect(args.args[2]).toBe(BigInt(1_000_000));
  });

  it("refuses a signature that is not this wallet's — before any gas", async () => {
    const { p, signature } = await signedBy(stranger);
    await expect(submitSelfWithdrawal({ from: owner.address, to, amountBase: BigInt(p.amountBase), validBefore: p.validBefore, nonce: p.nonce, signature }, { readToken, submit, now: () => NOW })).rejects.toThrow(/not this wallet's/);
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses a self-send, an over-balance amount and a zero amount", async () => {
    await expect(prepareSelfWithdrawal({ from: owner.address, to: owner.address, amountBase: BigInt(1) }, { readToken })).rejects.toThrow(/same wallet/);
    await expect(prepareSelfWithdrawal({ from: owner.address, to, amountBase: BigInt(6_000_000) }, { readToken })).rejects.toThrow(/less than/);
    await expect(prepareSelfWithdrawal({ from: owner.address, to, amountBase: BigInt(0) }, { readToken })).rejects.toThrow(/positive/);
  });

  it("refuses an expired authorization and one valid for too long", async () => {
    const { p, signature } = await signedBy(owner);
    await expect(submitSelfWithdrawal({ from: owner.address, to, amountBase: BigInt(p.amountBase), validBefore: p.validBefore, nonce: p.nonce, signature }, { readToken, submit, now: () => NOW + 3_600_000 })).rejects.toThrow(/expired/);
    await expect(submitSelfWithdrawal({ from: owner.address, to, amountBase: BigInt(p.amountBase), validBefore: p.validBefore + 7200, nonce: p.nonce, signature }, { readToken, submit, now: () => NOW })).rejects.toThrow(/too long/);
    expect(submit).not.toHaveBeenCalled();
  });

  it("one withdrawal a minute per wallet", async () => {
    const { p, signature } = await signedBy(owner);
    await submitSelfWithdrawal({ from: owner.address, to, amountBase: BigInt(p.amountBase), validBefore: p.validBefore, nonce: p.nonce, signature }, { readToken, submit, now: () => NOW });
    await expect(submitSelfWithdrawal({ from: owner.address, to, amountBase: BigInt(p.amountBase), validBefore: p.validBefore, nonce: p.nonce, signature }, { readToken, submit, now: () => NOW + 10_000 })).rejects.toThrow(/a minute/);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("refuses to prepare when the token's domain is not the contract's own", async () => {
    const badToken = async () => ({ ...(await readToken()), domainSeparator: `0x${"00".repeat(32)}` as Hex });
    await expect(prepareSelfWithdrawal({ from: owner.address, to, amountBase: BigInt(1) }, { readToken: badToken })).rejects.toThrow(/domain/);
  });
});
