import { describe, expect, it } from "vitest";
import { waitSummary } from "./marketplace";
import { axisMax, humanWait, place } from "@/components/marketplace/wait-strip";

/**
 * The measured submit→paid wait. This is the marketplace's strongest claim and the only one that is
 * derived rather than written, so the derivation is held here: what counts as a sample, what the
 * median is over an even count, and that an unmeasurable row is absent rather than zero.
 */
const row = (waitSeconds: number | null, txHash = `0x${Math.random().toString(16).slice(2)}`) => ({
  waitSeconds,
  txHash,
  usd: 1,
});

describe("waitSummary", () => {
  it("has no median at all before anything measurable has settled", () => {
    expect(waitSummary([])).toEqual({ medianSeconds: null, measured: 0, dots: [] });
    expect(waitSummary([row(null), row(null)])).toEqual({ medianSeconds: null, measured: 0, dots: [] });
  });

  it("takes the middle sample, not the mean — one overnight hold must not describe everyone's wait", () => {
    const s = waitSummary([row(60), row(90), row(120), row(150), row(50_000)]);
    expect(s.medianSeconds).toBe(120);
    expect(s.measured).toBe(5);
  });

  it("averages the two middles on an even count, to a whole second", () => {
    expect(waitSummary([row(100), row(200), row(300), row(400)]).medianSeconds).toBe(250);
    expect(waitSummary([row(100), row(201)]).medianSeconds).toBe(151);
  });

  it("a row whose submit time is unknown is excluded from the count, never counted as instant", () => {
    const s = waitSummary([row(200), row(null), row(400)]);
    expect(s.measured).toBe(2);
    expect(s.medianSeconds).toBe(300);
    expect(s.dots.map((d) => d.seconds)).toEqual([200, 400]);
  });

  it("caps the drawn dots but still counts every measurement", () => {
    const s = waitSummary(Array.from({ length: 90 }, (_, i) => row(60 + i)));
    expect(s.measured).toBe(90);
    expect(s.dots).toHaveLength(40);
  });
});

describe("the strip's own arithmetic", () => {
  it("places a faster-than-floor payout at the left edge instead of off the axis", () => {
    expect(place(1, 3600)).toBe(0);
    expect(place(-5, 3600)).toBe(0);
  });

  it("never places a dot past the right edge", () => {
    expect(place(999_999, 3600)).toBe(1);
  });

  it("is logarithmic — one-to-ten minutes takes the same width as ten-to-a-hundred", () => {
    const a = place(600, 36_000) - place(60, 36_000);
    const b = place(6000, 36_000) - place(600, 36_000);
    expect(Math.abs(a - b)).toBeLessThan(0.001);
  });

  it("clamps anything under the floor to the left edge rather than stretching the axis for it", () => {
    expect(place(6, 36_000)).toBe(place(30, 36_000));
  });

  it("leaves headroom past the slowest payout, so no dot sits welded to the right edge", () => {
    expect(place(3400, axisMax([3400]))).toBeLessThan(0.97);
    // an all-fast board still shows the hour mark it beat, rather than rescaling to hide it
    expect(axisMax([90, 140])).toBe(3600);
  });

  it("reads a duration the way a person says it", () => {
    expect(humanWait(18)).toBe("18s");
    expect(humanWait(144)).toBe("2m 24s");
    expect(humanWait(120)).toBe("2m");
    expect(humanWait(3900)).toBe("1h 05m");
    expect(humanWait(7200)).toBe("2h");
  });
});
