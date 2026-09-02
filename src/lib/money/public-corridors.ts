/**
 * PUBLIC CORRIDOR COSTS — the track's "required data layer", vendored and dated.
 *
 * The brief benchmarks the region at 7–9% and asks that solutions work with publicly available
 * datasets (remittance flows and transaction costs among them). This is that dataset, as a
 * snapshot: the World Bank WDI indicator SI.RMT.COST.IB.ZS — "Average transaction cost of sending
 * remittances to a specific country (%)", the cost of a $200 transfer INTO the country, the same
 * series Remittance Prices Worldwide feeds. Vendored (never a runtime call on a money path, the same
 * rule as the sanctions snapshot), source-attributed, and dated. Countries the series has no reading
 * for fall back to the brief's own 8% and SAY so — a missing number is reported, never invented.
 *
 * Fetched 2026-09-03:
 *   https://api.worldbank.org/v2/country/JM;HT;DO;GY/indicator/SI.RMT.COST.IB.ZS?format=json&mrv=4
 */
export const PUBLIC_CORRIDOR_SOURCE = {
  name: "World Bank, World Development Indicators — SI.RMT.COST.IB.ZS",
  url: "https://data.worldbank.org/indicator/SI.RMT.COST.IB.ZS",
  fetchedOn: "2026-09-03",
} as const;

/** The brief's regional benchmark, used where the public series has no reading for a country. */
export const REGIONAL_BENCHMARK_PCT = 8;

export interface CorridorReading {
  /** ISO 3166-1 alpha-2 of the RECEIVING country. */
  country: string;
  countryName: string;
  /** percent of a $200 transfer, per the WDI series; null when the series has no reading. */
  pct: number | null;
  /** the year of the latest reading, or null. */
  year: number | null;
}

const READINGS: Record<string, CorridorReading> = {
  JM: { country: "JM", countryName: "Jamaica", pct: 3.59, year: 2023 },
  HT: { country: "HT", countryName: "Haiti", pct: 4.7, year: 2023 },
  DO: { country: "DO", countryName: "Dominican Republic", pct: 2.52, year: 2023 },
  GY: { country: "GY", countryName: "Guyana", pct: 7.92, year: 2023 },
  TT: { country: "TT", countryName: "Trinidad and Tobago", pct: null, year: null },
  BB: { country: "BB", countryName: "Barbados", pct: null, year: null },
  BS: { country: "BS", countryName: "Bahamas", pct: null, year: null },
  BZ: { country: "BZ", countryName: "Belize", pct: null, year: null },
  SR: { country: "SR", countryName: "Suriname", pct: null, year: null },
};

/** The receiving country an obligation currency implies — the Caribbean currencies Sage prices in. */
const CURRENCY_COUNTRY: Record<string, string> = {
  JMD: "JM", HTG: "HT", DOP: "DO", GYD: "GY", TTD: "TT", BBD: "BB", BSD: "BS", BZD: "BZ", SRD: "SR",
};

/** The public reading for a currency's receiving country, or null when the currency is not a Caribbean receiver. */
export function corridorReadingFor(currency: string): CorridorReading | null {
  const cc = CURRENCY_COUNTRY[currency.toUpperCase()];
  return cc ? READINGS[cc] : null;
}

/**
 * The benchmark rate (as a fraction) to hold a settled obligation against: the country's public
 * reading when the series has one, else the brief's regional 8% — with `published` saying which.
 */
export function benchmarkFor(currency: string): { rate: number; published: boolean; reading: CorridorReading | null } {
  const r = corridorReadingFor(currency);
  if (r && r.pct !== null) return { rate: r.pct / 100, published: true, reading: r };
  return { rate: REGIONAL_BENCHMARK_PCT / 100, published: false, reading: r };
}

/** Every reading, for a table: published corridors first, then the ones the series does not cover. */
export function allCorridorReadings(): CorridorReading[] {
  return Object.values(READINGS).sort((a, b) => Number(b.pct !== null) - Number(a.pct !== null) || a.countryName.localeCompare(b.countryName));
}
