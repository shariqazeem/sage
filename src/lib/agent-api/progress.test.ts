import { describe, it, expect } from "vitest";
import { inspectionProgress, START_INSPECTION_ESTIMATE } from "./progress";

/**
 * OKX rejected the listing once for "results don't match the description". This is the other half of
 * that: the description promises an async flow, and a caller polling it saw only
 * `stage: "generating_missions"`, `pagesInspected: 0`, `plan: null` — for ten minutes, with no way to
 * distinguish work from a hang. Measured on prod: a bot-walled SaaS site took 633s and produced a
 * good plan from 12 browser states.
 */

const RUNNING = [
  "queued",
  "fetching",
  "field_test",
  "mapping",
  "analyzing",
  "generating_missions",
  "reviewing",
];

describe("every running stage tells the caller something true", () => {
  it.each(RUNNING)("%s has a note, a step, and a poll interval", (stage) => {
    const p = inspectionProgress(stage, 42)!;
    expect(p).not.toBeNull();
    expect(p.note.length).toBeGreaterThan(20);
    expect(p.step).toBeGreaterThanOrEqual(1);
    expect(p.step).toBeLessThanOrEqual(p.totalSteps);
    expect(p.nextPollSeconds).toBeGreaterThan(0);
  });

  it("orders the steps the way the pipeline actually stamps them", () => {
    const steps = RUNNING.map((s) => inspectionProgress(s, 0)!.step);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(new Set(steps).size).toBe(RUNNING.length); // no two stages share a step
  });

  it("names the browser stage as the long one, since that is where the ten minutes go", () => {
    expect(inspectionProgress("field_test", 0)!.note).toMatch(/real browser/i);
    expect(inspectionProgress("field_test", 0)!.note).toMatch(/longer|long part/i);
  });
});

describe("terminal stages have nothing to wait for", () => {
  it.each(["ready", "needs_input", "failed", "superseded", "nonsense", ""])(
    "%s returns null",
    (stage) => {
      expect(inspectionProgress(stage, 10)).toBeNull();
    },
  );
});

describe("the poll interval backs off once it is clearly a long job", () => {
  it("polls sooner at the start than deep into the run", () => {
    const early = inspectionProgress("field_test", 5)!.nextPollSeconds;
    const late = inspectionProgress("field_test", 600)!.nextPollSeconds;
    expect(late).toBeGreaterThan(early);
  });

  it("never returns a zero or negative interval, whatever elapsed it is handed", () => {
    for (const e of [-100, 0, NaN, Infinity, 1e9]) {
      const p = inspectionProgress("analyzing", e)!;
      expect(p.nextPollSeconds).toBeGreaterThan(0);
      expect(p.elapsedSeconds).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(p.elapsedSeconds)).toBe(true);
    }
  });
});

describe("the stated expectation covers what prod actually does", () => {
  it("the typical range includes the 633s job that triggered this", () => {
    const [lo, hi] = inspectionProgress("queued", 0)!.typicalTotalSeconds.split("-").map(Number);
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThanOrEqual(633);
  });

  it("agrees EXACTLY with the range sage_start_inspection advertises", () => {
    // This shipped as 120-660 while the async contract and the marketplace listing both said
    // 240-660. One service quoting two waits is the self-contradiction that got the listing
    // rejected, and it survived a review that only checked the tool DESCRIPTIONS.
    const [lo, hi] = inspectionProgress("field_test", 30)!.typicalTotalSeconds.split("-").map(Number);
    expect({ lo, hi }).toEqual({ lo: START_INSPECTION_ESTIMATE.typical, hi: START_INSPECTION_ESTIMATE.upTo });
  });

  it("every running stage quotes the same range — a caller must not see it change mid-poll", () => {
    const ranges = new Set(RUNNING.map((s) => inspectionProgress(s, 100)!.typicalTotalSeconds));
    expect(ranges.size).toBe(1);
  });
});
