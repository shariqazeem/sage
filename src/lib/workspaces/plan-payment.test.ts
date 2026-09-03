import { describe, expect, it } from "vitest";
import { encodeEventTopics, encodeAbiParameters, keccak256, toHex } from "viem";
import { extendedUntil, findUsdcPayment } from "./plan-payment";

const USDC = "0x3022b87ac063DE95b1570F46f5e470F8B53112D8";
const OPERATOR = "0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6";
const PAYER = "0xDF70b3e2A1c1c8E2e4A9A6f2B3c4D5e6F7a8b9E3";
const TRANSFER = keccak256(toHex("Transfer(address,address,uint256)"));
const pad = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}` as `0x${string}`;
const log = (from: string, to: string, value: bigint, address = USDC) => ({
  address: address as `0x${string}`,
  topics: [TRANSFER, pad(from), pad(to)] as [`0x${string}`, ...`0x${string}`[]],
  data: encodeAbiParameters([{ type: "uint256" }], [value]),
});

describe("Pro plan payment proof", () => {
  it("accepts a USDC transfer of at least the price from the payer to the operator", () => {
    const r = findUsdcPayment([log(PAYER, OPERATOR, BigInt(29_000_000))], { usdc: USDC, to: OPERATOR, from: PAYER, minBase: BigInt(29_000_000) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amountBase).toBe(BigInt(29_000_000));
  });
  it("refuses a short payment, a payment from someone else, to someone else, or in another token", () => {
    const base = { usdc: USDC, to: OPERATOR, from: PAYER, minBase: BigInt(29_000_000) };
    expect(findUsdcPayment([log(PAYER, OPERATOR, BigInt(28_990_000))], base)).toMatchObject({ ok: false, reason: expect.stringMatching(/28\.99 USDC; Pro is 29\.00/) });
    expect(findUsdcPayment([log("0x1111111111111111111111111111111111111111", OPERATOR, BigInt(29_000_000))], base).ok).toBe(false);
    expect(findUsdcPayment([log(PAYER, "0x2222222222222222222222222222222222222222", BigInt(29_000_000))], base).ok).toBe(false);
    expect(findUsdcPayment([log(PAYER, OPERATOR, BigInt(29_000_000), "0x3333333333333333333333333333333333333333")], base).ok).toBe(false);
    expect(findUsdcPayment([], base).ok).toBe(false);
  });
  it("a malformed log is skipped, not fatal", () => {
    const bad = { address: USDC as `0x${string}`, topics: [TRANSFER] as [`0x${string}`], data: "0x" as `0x${string}` };
    expect(findUsdcPayment([bad, log(PAYER, OPERATOR, BigInt(30_000_000))], { usdc: USDC, to: OPERATOR, from: PAYER, minBase: BigInt(29_000_000) }).ok).toBe(true);
    expect(encodeEventTopics({ abi: [{ type: "event", name: "Transfer", inputs: [{ indexed: true, name: "from", type: "address" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "value", type: "uint256" }] }], eventName: "Transfer" })[0]).toBe(TRANSFER);
  });
  it("paying early extends from the current expiry, paying late extends from now", () => {
    const now = 1_800_000_000;
    expect(extendedUntil(now + 100, now, 30)).toBe(now + 130);
    expect(extendedUntil(now - 100, now, 30)).toBe(now + 30);
    expect(extendedUntil(null, now, 30)).toBe(now + 30);
  });
});
