import { describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";

import { computeDomainSeparator, splitSignature, withdrawRecipientEarnings } from "./recipient-withdraw";
import type { RecipientWallet } from "@/lib/db/schema";

/**
 * WALLETLESS RECIPIENT WITHDRAWAL — the recipient signs (free, gasless), the operator submits and
 * pays. What these tests pin is the safety, not the plumbing: a signature is never produced under a
 * domain the token would reject, the amount and destination are inside the signed message, and
 * every refusal happens BEFORE anything irreversible.
 */

const GOAT = 2345;
const USDC = "0x3022b87ac063DE95b1570F46f5e470F8B53112D8";
const NAME = "Bridged USDC (Stargate)";
const VERSION = "2";

const wallet = {
  chatId: "chat-1",
  privyWalletId: "pw-1",
  address: "0x00000000000000000000000000000000000000aa",
} as unknown as RecipientWallet;

const TARGET = "0x00000000000000000000000000000000000000bb" as const;
const SIG = `0x${"11".repeat(32)}${"22".repeat(32)}1b` as Hex;

function deps(over: Partial<Parameters<typeof withdrawRecipientEarnings>[4]> = {}) {
  const signTypedData = vi.fn(async () => SIG);
  const submit = vi.fn(async () => `0x${"cd".repeat(32)}` as Hex);
  return {
    signTypedData,
    submit,
    readToken: async () => ({
      name: NAME,
      version: VERSION,
      domainSeparator: computeDomainSeparator(NAME, VERSION, GOAT, USDC),
      balance: BigInt(5_000_000),
    }),
    randomNonce: () => `0x${"ab".repeat(32)}` as Hex,
    now: () => 1_700_000_000_000,
    ...over,
  } as Parameters<typeof withdrawRecipientEarnings>[4] & { signTypedData: typeof signTypedData; submit: typeof submit };
}

describe("withdrawRecipientEarnings", () => {
  it("computeDomainSeparator matches the REAL on-chain separator for GOAT USDC", () => {
    // read from the live contract 2026-08-28 — if the token is ever migrated this breaks loudly
    expect(computeDomainSeparator(NAME, VERSION, GOAT, USDC).toLowerCase()).toBe(
      "0x7ce5afae4ffe3406ed14664a422cc32d14e9688b26cc3a4172e8e2a4f0dc3b99",
    );
  });

  it("signs an authorization pinning from, to and value, then submits it", async () => {
    const d = deps();
    const out = await withdrawRecipientEarnings(wallet, TARGET, BigInt(1_500_000), GOAT, d);
    expect(out.amountBase).toBe(BigInt(1_500_000));

    const typed = (d.signTypedData.mock.calls[0] as unknown as [string, { primary_type: string; domain: Record<string, unknown>; types: Record<string, unknown>; message: Record<string, unknown> }])[1];
    expect(typed.primary_type).toBe("TransferWithAuthorization");
    expect(typed.domain).toMatchObject({ name: NAME, version: VERSION, chainId: GOAT });
    // Privy needs EIP712Domain present in types or it refuses the payload
    expect(typed.types.EIP712Domain).toBeTruthy();
    // the money is IN the signature — the submitter cannot change either of these
    expect(String(typed.message.value)).toBe("1500000");
    expect(String(typed.message.to).toLowerCase()).toBe(TARGET);
    expect(String(typed.message.from).toLowerCase()).toBe(wallet.address.toLowerCase());

    const args = (d.submit.mock.calls[0] as unknown as [number, { args: unknown[] }])[1].args;
    expect(args[2]).toBe(BigInt(1_500_000)); // value
    expect(args[6]).toBe(27); // v normalised from 0x1b
  });

  it("REFUSES to sign when the token's domain does not match — before any signature exists", async () => {
    const d = deps({
      readToken: async () => ({
        name: NAME,
        version: VERSION,
        domainSeparator: `0x${"ff".repeat(32)}` as Hex, // contract disagrees
        balance: BigInt(5_000_000),
      }),
    });
    await expect(withdrawRecipientEarnings(wallet, TARGET, BigInt(1_000_000), GOAT, d)).rejects.toThrow(/domain/i);
    expect(d.signTypedData).not.toHaveBeenCalled();
    expect(d.submit).not.toHaveBeenCalled();
  });

  it("refuses an over-balance withdrawal, a zero amount, and a self-send — none of them sign", async () => {
    const d1 = deps();
    await expect(withdrawRecipientEarnings(wallet, TARGET, BigInt(9_000_000), GOAT, d1)).rejects.toThrow(/balance/i);
    expect(d1.signTypedData).not.toHaveBeenCalled();

    const d2 = deps();
    await expect(withdrawRecipientEarnings(wallet, TARGET, BigInt(0), GOAT, d2)).rejects.toThrow(/positive/i);
    expect(d2.signTypedData).not.toHaveBeenCalled();

    const d3 = deps();
    await expect(
      withdrawRecipientEarnings(wallet, wallet.address as `0x${string}`, BigInt(1_000_000), GOAT, d3),
    ).rejects.toThrow(/same wallet/i);
    expect(d3.signTypedData).not.toHaveBeenCalled();
  });

  it("normalises both signature v conventions", () => {
    expect(splitSignature(`0x${"11".repeat(32)}${"22".repeat(32)}00` as Hex).v).toBe(27);
    expect(splitSignature(`0x${"11".repeat(32)}${"22".repeat(32)}01` as Hex).v).toBe(28);
    expect(splitSignature(`0x${"11".repeat(32)}${"22".repeat(32)}1c` as Hex).v).toBe(28);
  });

  it("a refused signature never reaches submission", async () => {
    const d = deps({ signTypedData: vi.fn(async () => { throw new Error("privy refused"); }) as never });
    await expect(withdrawRecipientEarnings(wallet, TARGET, BigInt(1_000_000), GOAT, d)).rejects.toThrow(/refused/i);
    expect(d.submit).not.toHaveBeenCalled();
  });
});
