import { describe, expect, it } from "vitest";

import { mergeObservationSets } from "./observed-facts";
import type { ObservationSetV1 } from "./observed-facts";

/**
 * A RE-RUN MUST NEVER SEE LESS THAN THE RUN BEFORE IT.
 *
 * Browsing is not deterministic. Measured across every production job, the same url with the same
 * goal produced anywhere from 0 to 36 browser states and 0 to 301 observed facts on different runs.
 * Both a retry and a founder's answer to a clarifying question re-run the whole pipeline, and the
 * set was REPLACED each time — so a founder who answered Sage's question could be handed a thinner
 * plan than the one that prompted the question, and no one would ever know why.
 *
 * A fact Sage observed on the first look is not un-observed on the second. Ids are content-derived,
 * so the union is idempotent: it cannot duplicate one screen into two, and it cannot invent
 * anything neither run saw.
 */

const fact = (id: string) =>
  ({ id, kind: "seen", text: `fact ${id}`, stateId: `s-${id}`, source: "field_test" }) as never;
const trans = (id: string) =>
  ({ id, kind: "safe", fromStateId: "a", toStateId: "b", action: `act ${id}` }) as never;

const set = (facts: string[], transitions: string[], captureVersion = 1): ObservationSetV1 => ({
  version: "obs-set-v1" as ObservationSetV1["version"],
  facts: facts.map(fact),
  transitions: transitions.map(trans),
  captureVersion,
  digest: `d-${facts.join("")}-${transitions.join("")}`,
});

describe("carrying observations across runs", () => {
  it("a thin re-run keeps everything the rich first run saw", () => {
    // The exact failure: run 1 saw a lot, run 2 saw almost nothing, and run 2 used to win.
    const rich = set(["a", "b", "c", "d"], ["t1", "t2"]);
    const thin = set(["a"], []);
    const merged = mergeObservationSets(rich, thin)!;
    expect(merged.facts.map((f) => f.id).sort()).toEqual(["a", "b", "c", "d"]);
    expect(merged.transitions.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  });

  it("a richer re-run adds to what the first run saw", () => {
    const merged = mergeObservationSets(set(["a"], []), set(["b", "c"], ["t1"]))!;
    expect(merged.facts.map((f) => f.id).sort()).toEqual(["a", "b", "c"]);
    expect(merged.transitions.map((t) => t.id)).toEqual(["t1"]);
  });

  it("merging the same set twice changes nothing", () => {
    // Content-derived ids are what make this safe to run on every retry.
    const one = set(["a", "b"], ["t1"]);
    const merged = mergeObservationSets(one, one)!;
    expect(merged.facts).toHaveLength(2);
    expect(merged.transitions).toHaveLength(1);
    expect(mergeObservationSets(merged, one)!.facts).toHaveLength(2);
  });

  it("the digest changes when the evidence changes, and only then", () => {
    // A widened corpus MUST get a new digest: verdict reuse keys off it, so a submission judged
    // against less evidence is correctly re-judged rather than silently reused.
    const a = set(["a"], []);
    const widened = mergeObservationSets(a, set(["b"], []))!;
    const same = mergeObservationSets(a, set(["a"], []))!;
    expect(widened.digest).not.toBe(same.digest);
    expect(same.digest).toBe(mergeObservationSets(a, a)!.digest);
  });

  it("is order-independent — the same two looks merge to the same key either way", () => {
    const x = set(["a", "b"], ["t1"]);
    const y = set(["b", "c"], ["t2"]);
    expect(mergeObservationSets(x, y)!.digest).toBe(mergeObservationSets(y, x)!.digest);
  });

  it("keeps the more recent capture version", () => {
    expect(mergeObservationSets(set(["a"], [], 1), set(["b"], [], 7))!.captureVersion).toBe(7);
    expect(mergeObservationSets(set(["a"], [], 9), set(["b"], [], 2))!.captureVersion).toBe(9);
  });

  it("handles a missing side without inventing one", () => {
    const a = set(["a"], []);
    expect(mergeObservationSets(a, null)).toBe(a);
    expect(mergeObservationSets(null, a)).toBe(a);
    expect(mergeObservationSets(null, null)).toBeNull();
  });
});
