import { describe, expect, it } from "vitest";
import { cap, short, shortDateUTC, since, usd } from "./format";

describe("usd", () => {
  it("renders whole amounts without cents", () => {
    expect(usd(500)).toBe("$500");
    expect(usd(25)).toBe("$25");
    expect(usd(0)).toBe("$0");
  });

  it("renders fractional amounts with exactly two decimals", () => {
    // The bug this guards: $459.4 / $40.6 must never show a dangling tenth.
    expect(usd(459.4)).toBe("$459.40");
    expect(usd(40.6)).toBe("$40.60");
    expect(usd(0.05)).toBe("$0.05");
  });

  it("adds thousands separators", () => {
    expect(usd(1000)).toBe("$1,000");
    expect(usd(1234.5)).toBe("$1,234.50");
  });

  it("sheds floating-point dust before deciding whole vs fractional", () => {
    expect(usd(0.1 + 0.2)).toBe("$0.30"); // 0.30000000000000004
    expect(usd(500.000000001)).toBe("$500");
  });
});

describe("short", () => {
  it("shortens an address to head…tail", () => {
    expect(short("0x52A7000000000000000000000000000000006279")).toBe(
      "0x52A7…6279",
    );
  });
});

describe("cap", () => {
  it("capitalizes the first letter", () => {
    expect(cap("active")).toBe("Active");
    expect(cap("revoked")).toBe("Revoked");
  });

  it("is a no-op on the empty string", () => {
    expect(cap("")).toBe("");
  });
});

describe("since", () => {
  const now = 1_700_000_000_000; // fixed ms, injected for determinism
  const ago = (seconds: number) => Math.floor(now / 1000) - seconds;

  it("buckets recent times into compact labels", () => {
    expect(since(ago(10), now)).toBe("just now");
    expect(since(ago(120), now)).toBe("2m ago");
    expect(since(ago(3 * 3600), now)).toBe("3h ago");
    expect(since(ago(2 * 86400), now)).toBe("2d ago");
  });

  it("never returns a negative duration for a future-ish timestamp", () => {
    expect(since(ago(-5), now)).toBe("just now");
  });

  it("formats old dates deterministically (UTC + fixed month names, no locale drift)", () => {
    const old = Math.floor(Date.UTC(2023, 6, 1, 12, 0, 0) / 1000); // Jul 1 2023
    expect(since(old, Date.UTC(2023, 7, 1, 12, 0, 0))).toBe("Jul 1");
  });
});

describe("shortDateUTC", () => {
  it("is deterministic regardless of locale/timezone (server === client)", () => {
    const ts = Math.floor(Date.UTC(2026, 6, 1, 23, 30, 0) / 1000);
    expect(shortDateUTC(ts)).toBe("Jul 1");
    expect(shortDateUTC(ts, true)).toBe("Jul 1, 2026");
  });
});
