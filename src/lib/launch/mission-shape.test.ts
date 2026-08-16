import { describe, it, expect } from "vitest";
import { extractMissionArray } from "./mission-brain";

/**
 * A SHAPE WE DO NOT RECOGNISE COSTS A FOUNDER THEIR WHOLE INSPECTION.
 *
 * Four minutes of real browsing thrown away and "Sage's reviewer returned an unusable response" on
 * their screen. Measured on prod 2026-08-16: four such failures in twelve hours (~18% of runs),
 * including www.jumia.com.ng. Retrying cannot help — the gateway's shape preference is per-PROMPT,
 * so five attempts return the same wrapper five times.
 *
 * Strictness is untouched: every element still passes coerceMission and then the deterministic
 * gate, which is where a bad mission is actually stopped. This only decides where to LOOK.
 */
const m = (title: string) => ({ title, objective: "o", instructions: "i", targetSurface: "/x" });

describe("extractMissionArray", () => {
  it("the documented shape", () => {
    expect(extractMissionArray({ missions: [m("a")] })).toHaveLength(1);
  });

  it("a bare array", () => {
    expect(extractMissionArray([m("a"), m("b")])).toHaveLength(2);
  });

  it("nested one level under a wrapper key", () => {
    expect(extractMissionArray({ plan: { missions: [m("a")] } })).toHaveLength(1);
    expect(extractMissionArray({ data: { testingMissions: [m("a")] } })).toHaveLength(1);
  });

  it("an UNKNOWN key holding mission-shaped objects is still found", () => {
    expect(extractMissionArray({ suggestedTestPlan: [m("a"), m("b")] })).toHaveLength(2);
  });

  it("an unknown key nested inside another unknown key is still found", () => {
    expect(extractMissionArray({ payload: { theMissions: [m("a")] } })).toHaveLength(1);
  });

  it("a single bare mission object is wrapped", () => {
    expect(extractMissionArray(m("solo"))).toHaveLength(1);
  });

  it("accepts a mission with instructions but no objective — the gate decides, not the reader", () => {
    expect(extractMissionArray({ missions: [{ title: "t", instructions: "i" }] })).toHaveLength(1);
  });

  it("IGNORES arrays that are not missions — an unrelated list must not be mistaken for a plan", () => {
    expect(extractMissionArray({ notes: ["a", "b"], pages: [{ url: "/x" }] })).toHaveLength(0);
  });

  it("returns empty for genuinely unusable output, so the caller still fails honestly", () => {
    expect(extractMissionArray({ error: "I cannot help" })).toHaveLength(0);
    expect(extractMissionArray(null)).toHaveLength(0);
    expect(extractMissionArray("some prose")).toHaveLength(0);
  });
});
