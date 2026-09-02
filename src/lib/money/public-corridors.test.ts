import { describe, expect, it } from "vitest";
import { allCorridorReadings, benchmarkFor, corridorReadingFor, PUBLIC_CORRIDOR_SOURCE, REGIONAL_BENCHMARK_PCT } from "./public-corridors";

describe("public corridor costs — a vendored, dated reading, never an invented one", () => {
  it("maps a Caribbean obligation currency to its receiving country's public reading", () => {
    expect(corridorReadingFor("JMD")).toMatchObject({ country: "JM", pct: 3.59, year: 2023 });
    expect(corridorReadingFor("jmd")?.country).toBe("JM");
    expect(corridorReadingFor("USD")).toBeNull();
    expect(corridorReadingFor("EUR")).toBeNull();
  });
  it("uses the published rate where one exists and says so; falls back to the brief's 8% and says that too", () => {
    const jm = benchmarkFor("JMD");
    expect(jm.published).toBe(true);
    expect(jm.rate).toBeCloseTo(0.0359, 6);
    const tt = benchmarkFor("TTD");
    expect(tt.published).toBe(false);
    expect(tt.rate).toBe(REGIONAL_BENCHMARK_PCT / 100);
    expect(tt.reading?.countryName).toBe("Trinidad and Tobago");
    const usd = benchmarkFor("USD");
    expect(usd.published).toBe(false);
    expect(usd.reading).toBeNull();
  });
  it("carries its source and date, and lists published readings first", () => {
    expect(PUBLIC_CORRIDOR_SOURCE.url).toMatch(/worldbank/);
    expect(PUBLIC_CORRIDOR_SOURCE.fetchedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const all = allCorridorReadings();
    expect(all[0].pct).not.toBeNull();
    expect(all[all.length - 1].pct).toBeNull();
    expect(all.length).toBe(9);
  });
});
