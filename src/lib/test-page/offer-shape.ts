/**
 * THE OFFER, AS NUMBERS (relaunch, 20 Nov 2026). Safe for a browser: no database, no compiler.
 *
 * A builder decides two things on a test's offer card: how many people, and what each one earns. The
 * total is their product, in whole base units (USDC has 6 decimals), never a float that is rounded.
 * The server compiles the same two numbers into the plan (`src/lib/launch/offer.ts`) and refuses
 * anything this file would refuse, so the card and the compiler cannot disagree about what is allowed.
 */
import { isCoreMission } from "@/lib/core-test/shape";

export const PEOPLE_PRESETS = [5, 10, 20] as const;
export const EACH_PRESETS_USD = [1, 2, 5] as const;
/** The default test: 10 people, $2.00 each (the founder's decision, 20 Nov 2026). */
export const DEFAULT_PEOPLE = 10;
export const DEFAULT_EACH_BASE = 2_000_000;
/** One mission holds at most 50 paid places (the budget compiler's own cap). */
export const MAX_PLACES_PER_MISSION = 50;
/** The compiler's floor and ceiling for one person's reward: $0.50 and $50.00. */
export const MIN_EACH_BASE = 500_000;
export const MAX_EACH_BASE = 50_000_000;
/** Above this, a tester is asked for a one-time World ID check before they can take a place. */
export const WORLD_ID_ABOVE_BASE = 5_000_000;

export interface OfferShape {
  /** paid places across every mission */
  people: number;
  /** what each place pays, when every place pays the same; null when the missions pay differently */
  eachBase: number | null;
  minEachBase: number;
  maxEachBase: number;
  /** Σ(reward × places), in base units */
  totalBase: number;
  missions: number;
}

type Econ = { rewardBase: string | number | bigint; maxCompletions: string | number | bigint };

/** What a plan offers, read from its missions. */
export function offerOf(missions: readonly Econ[]): OfferShape {
  let people = 0;
  let total = 0;
  let min = Infinity;
  let max = 0;
  for (const m of missions) {
    const reward = Number(m.rewardBase);
    const places = Number(m.maxCompletions);
    people += places;
    total += reward * places;
    min = Math.min(min, reward);
    max = Math.max(max, reward);
  }
  if (missions.length === 0) min = 0;
  return { people, eachBase: min === max ? min : null, minEachBase: min, maxEachBase: max, totalBase: total, missions: missions.length };
}

/** Dollars as typed ("2", "2.5", "$2.50") to base units, or null. Whole cents only. */
export function usdToBase(raw: string | number): number | null {
  const text = String(raw).trim().replace(/^\$/, "");
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, cents = ""] = text.split(".");
  return Number(whole) * 1_000_000 + Number(cents.padEnd(2, "0")) * 10_000;
}

export function baseToUsd(base: number | bigint): string {
  const b = BigInt(base);
  const cents = (b / BigInt(10_000)) % BigInt(100);
  return `$${(b / BigInt(1_000_000)).toString()}.${cents.toString().padStart(2, "0")}`;
}

/** Why these two numbers can't be a test, in plain words, or null when they can. */
export function offerProblem(people: number, eachBase: number, missions: number): string | null {
  if (!Number.isInteger(people) || people < 1) return "Choose how many people.";
  if (people < missions) return `This test has ${missions} missions, so it needs at least ${missions} people.`;
  if (people > missions * MAX_PLACES_PER_MISSION) return `At most ${missions * MAX_PLACES_PER_MISSION} people for this test.`;
  if (!Number.isInteger(eachBase) || eachBase % 10_000 !== 0) return "Use dollars and whole cents.";
  if (eachBase < MIN_EACH_BASE) return `Each person earns at least ${baseToUsd(MIN_EACH_BASE)}.`;
  if (eachBase > MAX_EACH_BASE) return `Each person earns at most ${baseToUsd(MAX_EACH_BASE)}.`;
  return null;
}

/**
 * N places over a test's missions, as evenly as they go, the extra ones to the first missions. The
 * caller passes the missions in the compiler's own order (most important first), so the first mission
 * never holds fewer places than a later one.
 */
export function splitPlaces(people: number, missions: number): number[] {
  if (missions <= 0) return [];
  const base = Math.floor(people / missions);
  const extra = people - base * missions;
  return Array.from({ length: missions }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * The same split, for a test that carries the core mission (`src/lib/core-test/shape.ts`).
 *
 * The core mission is where "6 of 10 understood it" comes from, and a person takes one place per
 * test, so its count is only worth reading when most of the people are on it. It takes half the
 * places, rounded up (never fewer than an even share, never more than one mission holds), and the
 * rest are split evenly over the other missions, each keeping at least one. A test with no core
 * mission, or with only one mission, splits exactly as before.
 */
export function placesFor(people: number, missionKeys: readonly string[]): number[] {
  const n = missionKeys.length;
  const at = missionKeys.findIndex(isCoreMission);
  if (at < 0 || n <= 1 || people < n) return splitPlaces(people, n);
  const others = n - 1;
  const core = Math.min(MAX_PLACES_PER_MISSION, people - others, Math.max(Math.ceil(people / 2), Math.ceil(people / n)));
  const rest = splitPlaces(people - core, others);
  // more people than the other missions can hold: the even split is the one that fits
  if (rest.some((p) => p > MAX_PLACES_PER_MISSION)) return splitPlaces(people, n);
  return [...rest.slice(0, at), core, ...rest.slice(at)];
}
