import { describe, expect, it } from "vitest";
import { count, dayOf, dollars, hostOf, howLong, whenAgo } from "./when";

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const sec = (ms: number) => Math.floor(ms / 1000);

describe("times and counts, for people", () => {
  it("says how long ago, then the day", () => {
    expect(whenAgo(sec(NOW) - 20, NOW)).toBe("just now");
    expect(whenAgo(sec(NOW) - 12 * 60, NOW)).toBe("12 min ago");
    expect(whenAgo(sec(NOW) - 3 * 3600, NOW)).toBe("3 h ago");
    expect(whenAgo(sec(NOW) - 2 * 86_400, NOW)).toBe("2 d ago");
    expect(whenAgo(sec(Date.UTC(2026, 7, 25)), NOW)).toBe("25 Aug");
  });

  it("names the year only when it is another year", () => {
    expect(dayOf(sec(Date.UTC(2026, 7, 25)), NOW)).toBe("25 Aug");
    expect(dayOf(sec(Date.UTC(2025, 11, 3)), NOW)).toBe("3 Dec 2025");
  });

  it("says how long something took, with units", () => {
    expect(howLong(45)).toBe("45 s");
    expect(howLong(145)).toBe("2 min 25 s");
    expect(howLong(120)).toBe("2 min");
    expect(howLong(3840)).toBe("1 h 4 min");
  });

  it("uses the right plural, money to the cent, and a hostname without www", () => {
    expect(count(1, "person", "people")).toBe("1 person");
    expect(count(25, "person", "people")).toBe("25 people");
    expect(dollars(2)).toBe("$2.00");
    expect(dollars(1204.5)).toBe("$1,204.50");
    expect(hostOf("https://www.yara.garden/path")).toBe("yara.garden");
    expect(hostOf("not a url")).toBeNull();
  });
});
