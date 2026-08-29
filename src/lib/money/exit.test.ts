import { describe, expect, it } from "vitest";
import { exitPicture, exitSummary } from "./exit";
import { toUsdBase, type RateQuote } from "./currency";

/**
 * A PAYMENT RAIL THAT ENDS IN AN UNSPENDABLE ASSET HAS NOT MOVED CAPITAL.
 *
 * The honest finding from the first cohort: people were paid and then struggled to move the money.
 * Sage settles on GOAT, which works reliably and is listed almost nowhere — so the recipient hits
 * one more hop that nobody warned them about. Telling them plainly, before they withdraw, is the
 * whole point; a rail that hides its own last mile is selling a number, not a payment.
 */
const jmd: RateQuote = { base: "USD", currency: "JMD", rate: 158.20882, source: "test", asOf: 1 };
const usdc = (n: number) => BigInt(Math.round(n * 1_000_000));

describe("the exit picture is honest about the last mile", () => {
  it("says plainly that GOAT is thinly listed instead of implying it is easy", () => {
    const p = exitPicture(usdc(31.6), 2345);
    expect(p.constrained).toBe(true);
    expect(p.liquidity).toBe("limited");
    expect(p.reach).toMatch(/few exchanges list this network/i);
    // and it names the step people actually get stuck on
    expect(p.steps.join(" ")).toMatch(/bridge/i);
  });

  it("tells the recipient the amount in their OWN currency, not only in dollars", () => {
    // Feed the REAL conversion output, not a hand-rounded dollar figure: rounding to cents first
    // loses precision and reads back as J$4,999.40, which is what production would never do
    // because production keeps the base units the converter produced.
    const p = exitPicture(toUsdBase(5000, jmd), 2345, jmd);
    expect(p.localCurrency).toBe("JMD");
    expect(p.localAmount).toBeCloseTo(5000, 1);
    expect(exitSummary(p)).toContain("J$5,000.00");
  });

  it("reminds them they need no crypto of their own — Sage covers the gas", () => {
    expect(exitPicture(usdc(10), 2345).steps.join(" ")).toMatch(/covers the gas/i);
  });

  /** Testnet money is not money. Saying so prevents the cruellest possible confusion. */
  it("refuses to describe test funds as withdrawable", () => {
    const p = exitPicture(usdc(999), 59902);
    expect(p.liquidity).toBe("testnet");
    expect(p.reach).toMatch(/not real money/i);
    expect(p.steps.join(" ")).toMatch(/nothing to withdraw/i);
  });

  it("drops the local line rather than inventing one when no rate was stamped", () => {
    const p = exitPicture(usdc(31.6), 2345, null);
    expect(p.localAmount).toBeNull();
    expect(exitSummary(p)).not.toMatch(/about /);
  });

  /** It must never turn into a recommendation: services differ by country and go stale, and a
   *  stale recommendation about someone's money is worse than none. */
  it("names no exchange, bridge or service anywhere in its output", () => {
    const text = [2345, 1088, 59902]
      .map((c) => { const p = exitPicture(usdc(50), c, jmd); return `${p.reach} ${p.steps.join(" ")} ${exitSummary(p)}`; })
      .join(" ");
    for (const brand of ["binance", "coinbase", "kraken", "okx", "stargate", "wormhole", "wise", "moncash"])
      expect(text.toLowerCase(), brand).not.toContain(brand);
  });
});
