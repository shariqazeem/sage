import { describe, expect, it } from "vitest";
import { decideNativeSend, nativeSendFeeWei } from "./send-native";
import { formatNative, needsFeeMessage, operatorCoversGas } from "./gas-policy";

const GWEI = BigInt(1_000_000_000);
const FROM = "0x2222222222222222222222222222222222222222" as const;
const TO = "0x3333333333333333333333333333333333333333" as const;
const METIS = (n: number) => BigInt(Math.round(n * 1e6)) * BigInt(1e12);

describe("sending METIS out of the account", () => {
  it("lets the balance less the fee leave, and says the most when asked for more", () => {
    const fee = nativeSendFeeWei(BigInt(12) * GWEI);
    expect(decideNativeSend({ chainId: 1088, from: FROM, to: TO, amountWei: METIS(1) - fee, balanceWei: METIS(1), gasPriceWei: BigInt(12) * GWEI })).toEqual({ ok: true, feeWei: fee });
    const over = decideNativeSend({ chainId: 1088, from: FROM, to: TO, amountWei: METIS(1), balanceWei: METIS(1), gasPriceWei: BigInt(12) * GWEI });
    expect(over).toMatchObject({ ok: false, code: "insufficient" });
    expect((over as { message: string }).message).toContain("the most that can leave is 0.9991");
  });
  it("refuses sending to itself, nothing, or on a chain where USDC is the gas", () => {
    expect(decideNativeSend({ chainId: 1088, from: FROM, to: FROM, amountWei: METIS(0.1), balanceWei: METIS(1), gasPriceWei: GWEI })).toMatchObject({ code: "same" });
    expect(decideNativeSend({ chainId: 1088, from: FROM, to: TO, amountWei: BigInt(0), balanceWei: METIS(1), gasPriceWei: GWEI })).toMatchObject({ code: "too_small" });
    expect(decideNativeSend({ chainId: 5042, from: FROM, to: TO, amountWei: METIS(0.1), balanceWei: METIS(1), gasPriceWei: GWEI })).toMatchObject({ code: "not_here" });
  });
});

describe("the account pays its own network fee", () => {
  it("is the default; only OPERATOR_COVERS_GAS=1 brings the operator's cover back", () => {
    expect(operatorCoversGas({})).toBe(false);
    expect(operatorCoversGas({ OPERATOR_COVERS_GAS: "0" })).toBe(false);
    expect(operatorCoversGas({ OPERATOR_COVERS_GAS: "1" })).toBe(true);
  });
  it("says how much, how much is held, and where METIS comes from", () => {
    const m = needsFeeMessage({ chainId: 1088, action: "withdrawal", needWei: METIS(0.0017), haveWei: BigInt(0), nativeSymbol: "METIS", network: "Metis Andromeda" });
    expect(m).toContain("about 0.0017 METIS");
    expect(m).toContain("holds 0.");
    expect(m).toContain("Binance");
    expect(m).not.toContain("Swap");
  });
  it("formats native amounts in plain digits, and dust as less-than", () => {
    expect(formatNative(METIS(0.05))).toBe("0.05");
    expect(formatNative(METIS(1.23456))).toBe("1.2345");
    expect(formatNative(BigInt(0))).toBe("0");
    expect(formatNative(BigInt(5))).toBe("<0.0001");
  });
});
