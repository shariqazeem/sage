import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CURRENCIES, currencyOf, isSupportedCurrency, toUsdBase, fromUsdBase,
  formatLocal, corridorCost, isQuoteFresh, RATE_MAX_AGE_SEC, type RateQuote,
} from "./currency";
import { quoteFor, __clearRateCache } from "./rates";

const q = (currency: string, rate: number, asOf = 1_787_961_751): RateQuote =>
  ({ base: "USD", currency, rate, source: "test", asOf });

afterEach(() => { __clearRateCache(); vi.restoreAllMocks(); });

describe("the corridors this product exists for", () => {
  it("covers the Caribbean receivers the track names", () => {
    for (const code of ["JMD", "TTD", "XCD", "BBD", "HTG", "DOP", "GYD", "BSD", "BZD", "SRD"])
      expect(isSupportedCurrency(code), code).toBe(true);
  });

  it("covers the diaspora senders", () => {
    for (const code of ["USD", "CAD", "GBP", "EUR"]) expect(isSupportedCurrency(code), code).toBe(true);
  });

  it("lists receiving currencies before sending ones — the person being PAID matters most", () => {
    const firstCaribbean = CURRENCIES.findIndex((c) => c.region === "caribbean");
    const firstSender = CURRENCIES.findIndex((c) => c.region === "sender");
    expect(firstCaribbean).toBeLessThan(firstSender);
  });
});

describe("conversion never mints money", () => {
  /**
   * The vault must always hold at least what the quote promised, so rounding goes DOWN. The
   * discarded fraction is worth less than one millionth of a dollar; the direction is what matters.
   */
  it("rounds DOWN so a conversion cannot exceed what was funded", () => {
    // 1 JMD at 158.20882/USD is 0.00632...  USD → 6320 base units, never 6321.
    const base = toUsdBase(1, q("JMD", 158.20882));
    expect(base).toBe(BigInt(6320));
    expect(Number(base) / 1e6).toBeLessThanOrEqual(1 / 158.20882);
  });

  it("returns zero for nonsense rather than NaN base units", () => {
    expect(toUsdBase(0, q("JMD", 158))).toBe(BigInt(0));
    expect(toUsdBase(-5, q("JMD", 158))).toBe(BigInt(0));
    expect(toUsdBase(100, q("JMD", 0))).toBe(BigInt(0));
  });

  it("round-trips a realistic grant closely enough to read back the same", () => {
    const jmd = q("JMD", 158.20882);
    const base = toUsdBase(5000, jmd);           // J$5,000 grant
    expect(base).toBe(BigInt(31_603_800));       // ≈ $31.60 USDC
    expect(fromUsdBase(base, jmd)).toBeCloseTo(5000, 1);
  });

  it("USD is exact — the settlement asset converts to itself", () => {
    expect(toUsdBase(31.6, q("USD", 1))).toBe(BigInt(31_600_000));
  });
});

describe("a rate must be attributable and fresh", () => {
  it("rejects a quote older than the max age", () => {
    const now = 1_800_000_000;
    expect(isQuoteFresh(q("JMD", 158, now - 60), now)).toBe(true);
    expect(isQuoteFresh(q("JMD", 158, now - RATE_MAX_AGE_SEC - 1), now)).toBe(false);
  });

  it("rejects a zero or negative rate however fresh", () => {
    const now = 1_800_000_000;
    expect(isQuoteFresh(q("JMD", 0, now), now)).toBe(false);
  });

  /** REFUSING BEATS GUESSING. A grant sized by an invented rate is wrong invisibly. */
  it("returns null rather than inventing a rate when the source is unreachable", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    expect(await quoteFor("JMD", { fetchImpl })).toBeNull();
  });

  it("still resolves USD when the source is unreachable — it is the settlement asset", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    const usd = await quoteFor("USD", { fetchImpl });
    expect(usd?.rate).toBe(1);
  });

  it("never approximates an unpublished currency from a neighbouring peg", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true, json: async () => ({ result: "success", time_last_update_unix: 1, rates: { JMD: 158 } }),
    })) as unknown as typeof fetch;
    expect((await quoteFor("JMD", { fetchImpl }))?.rate).toBe(158);
    expect(await quoteFor("XCD", { fetchImpl })).toBeNull(); // pegged to USD in reality — still not invented
  });

  it("carries the provider's publication time, not our read time", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true, json: async () => ({ result: "success", time_last_update_unix: 1_787_961_751, rates: { JMD: 158 } }),
    })) as unknown as typeof fetch;
    expect((await quoteFor("JMD", { fetchImpl }))?.asOf).toBe(1_787_961_751);
  });
});

describe("what the corridor costs", () => {
  /** The track names the number to beat: remittance fees averaging 7-9%. */
  it("computes a saving against a stated benchmark, never a buried constant", () => {
    const c = corridorCost(100, 0.08, 0.01);
    expect(c.benchmarkCostUsd).toBeCloseTo(8, 6);
    expect(c.savedUsd).toBeCloseTo(7.99, 6);
    expect(c.savedPct).toBeCloseTo(7.99, 6);
  });

  it("counts Sage's own cost honestly, even though the recipient never pays it", () => {
    expect(corridorCost(100, 0.08, 2).savedUsd).toBeCloseTo(6, 6);
  });

  it("reports no percentage on a zero amount rather than dividing by nothing", () => {
    expect(corridorCost(0, 0.08, 0).savedPct).toBeNull();
  });
});

describe("formatting reads like the currency it is", () => {
  it("uses each currency's own symbol", () => {
    expect(formatLocal(5000, "JMD")).toBe("J$5,000.00");
    expect(formatLocal(31.6, "USD")).toBe("$31.60");
    expect(currencyOf("jmd")?.name).toBe("Jamaican Dollar");
  });

  it("degrades to a plain code for anything unsupported", () => {
    expect(formatLocal(10, "ZZZ")).toBe("10.00 ZZZ");
  });
});
