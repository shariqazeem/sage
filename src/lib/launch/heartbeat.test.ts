import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * "Idle" and "slow" are not the same thing, and the reaper can only tell them apart if a running
 * job says so. P-GEN nonce 55 timed out on nine of thirteen products, clustered at exactly the two
 * long stages, because `updatedAt` moved only on a stage change — so a plan that was progressing
 * looked dead at fifteen minutes and was restarted from the beginning, browser run and all.
 */
describe("an inspection says it is alive while it works", () => {
  const src = readFileSync(resolve(process.cwd(), "src/lib/launch/job.ts"), "utf8");

  it("beats well inside the stall threshold, so a live job is never reaped", () => {
    // numeric separators are idiomatic here (120_000), so the reader has to strip them
    const num = (raw: string) => Number(raw.replace(/_/g, ""));
    const stall = /const STALL_SECONDS = ([\d_]+) \* 60;/.exec(src);
    const beat = /const HEARTBEAT_MS = ([\d_]+);/.exec(src);
    expect(stall).toBeTruthy();
    expect(beat).toBeTruthy();
    const stallMs = num(stall![1]) * 60 * 1000;
    const beatMs = num(beat![1]);
    expect(beatMs).toBeGreaterThan(0);
    // several beats must fit inside the window, or one slow tick still looks like death
    expect(stallMs / beatMs).toBeGreaterThanOrEqual(4);
  });

  it("stops beating when the run ends, so a dead job is still reaped", () => {
    expect(src).toMatch(/finally \{[\s\S]*clearInterval\(beat\)/);
  });

  it("a failing heartbeat can never fail the job it reports on", () => {
    const block = /const beat = setInterval\(\(\) => \{[\s\S]*?\}, HEARTBEAT_MS\);/.exec(src);
    expect(block).toBeTruthy();
    expect(block![0]).toMatch(/try \{[\s\S]*catch/);
  });
});
