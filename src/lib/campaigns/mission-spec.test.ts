import { describe, expect, it } from "vitest";
import {
  missionSpecDigest,
  normalizeText,
  validateMissionSpec,
  type MissionSpecInput,
} from "./mission-spec";

const CID = `0x${"a".repeat(64)}` as const;
const MID = `0x${"b".repeat(64)}` as const;

function spec(over: Partial<MissionSpecInput> = {}): MissionSpecInput {
  return {
    campaignIdHash: CID,
    missionIdHash: MID,
    title: "Break the signup flow",
    objective: "Find a way to create an account that bypasses email verification.",
    instructions: "1. Open the app.\n2. Start signup.\n3. Try to skip verification.",
    targetSurface: "https://app.example.com/signup",
    criteria: ["Account created without a verified email", "Reproducible in a fresh session"],
    evidenceRequirements: ["A screen recording", "The exact steps"],
    rewardBase: BigInt(500_000),
    maxCompletions: BigInt(4),
    ...over,
  };
}

describe("validateMissionSpec — structured, bounded, deduped", () => {
  it("accepts a well-formed spec", () => {
    expect(validateMissionSpec(spec())).toBeNull();
  });
  it("rejects empty/oversized/duplicate fields", () => {
    expect(validateMissionSpec(spec({ title: "   " }))).toBe("empty_title");
    expect(validateMissionSpec(spec({ objective: "" }))).toBe("empty_objective");
    expect(validateMissionSpec(spec({ instructions: "\n\t " }))).toBe("empty_instructions");
    expect(validateMissionSpec(spec({ targetSurface: "" }))).toBe("empty_target_surface");
    expect(validateMissionSpec(spec({ criteria: [] }))).toBe("no_criteria");
    expect(validateMissionSpec(spec({ evidenceRequirements: [] }))).toBe("no_evidence");
    expect(validateMissionSpec(spec({ criteria: ["a", "a"] }))).toBe("duplicate_criterion");
    expect(validateMissionSpec(spec({ evidenceRequirements: ["x", "x"] }))).toBe("duplicate_evidence");
    expect(validateMissionSpec(spec({ title: "x".repeat(141) }))).toBe("title_too_long");
    expect(validateMissionSpec(spec({ rewardBase: BigInt(0) }))).toBe("zero_reward");
    expect(validateMissionSpec(spec({ maxCompletions: BigInt(0) }))).toBe("zero_max_completions");
    expect(validateMissionSpec(spec({ campaignIdHash: "0xnope" as `0x${string}` }))).toBe("bad_campaign_id_hash");
  });
  it("normalizeText is NFC + outer-trim, never inner rewrite", () => {
    const decomposed = "café"; // 'e' + combining acute
    expect(normalizeText(`  ${decomposed}  `)).toBe(decomposed.normalize("NFC"));
    expect(normalizeText("Keep  inner   spacing")).toBe("Keep  inner   spacing");
  });
});

describe("missionSpecDigest — deterministic; every meaningful field is load-bearing", () => {
  it("GOLDEN vector is stable", () => {
    expect(missionSpecDigest(spec())).toMatchInlineSnapshot(`"0x2b7c5f36963c6e78384805b00f01563b07cf2b746086f4891586d2a8e9836c54"`);
  });
  it("is deterministic", () => {
    expect(missionSpecDigest(spec())).toBe(missionSpecDigest(spec()));
  });
  it("NFC + outer-trim do not change the digest, but inner content does", () => {
    expect(missionSpecDigest(spec({ title: "  Break the signup flow  " }))).toBe(missionSpecDigest(spec()));
    expect(missionSpecDigest(spec({ title: "Break the signup flo" }))).not.toBe(missionSpecDigest(spec()));
  });
  it("REORDERING criteria changes the digest", () => {
    const a = spec({ criteria: ["one", "two"] });
    const b = spec({ criteria: ["two", "one"] });
    expect(missionSpecDigest(a)).not.toBe(missionSpecDigest(b));
  });
  it("REORDERING evidence changes the digest", () => {
    const a = spec({ evidenceRequirements: ["one", "two"] });
    const b = spec({ evidenceRequirements: ["two", "one"] });
    expect(missionSpecDigest(a)).not.toBe(missionSpecDigest(b));
  });
  it("every economically/operationally meaningful field affects the digest", () => {
    const base = missionSpecDigest(spec());
    expect(missionSpecDigest(spec({ objective: "different" }))).not.toBe(base);
    expect(missionSpecDigest(spec({ instructions: "different" }))).not.toBe(base);
    expect(missionSpecDigest(spec({ targetSurface: "https://other" }))).not.toBe(base);
    expect(missionSpecDigest(spec({ rewardBase: BigInt(500_001) }))).not.toBe(base);
    expect(missionSpecDigest(spec({ maxCompletions: BigInt(5) }))).not.toBe(base);
    expect(missionSpecDigest(spec({ missionIdHash: `0x${"c".repeat(64)}` }))).not.toBe(base);
    expect(missionSpecDigest(spec({ campaignIdHash: `0x${"d".repeat(64)}` }))).not.toBe(base);
  });
});

/**
 * The reward/display invariant (02E audit). The economic `rewardBase` (base units)
 * IS load-bearing — one base unit changes the digest. A derived DISPLAY string like
 * "$0.50" is not part of MissionSpecInput at all, so it can never affect the digest;
 * only the exact integer base-unit reward does. `maxCompletions` is likewise
 * load-bearing. This pins the exact invariant so the wording contradiction can't recur.
 */
describe("reward is committed by base units, never by a display string", () => {
  it("ONE base unit of rewardBase changes the digest", () => {
    expect(missionSpecDigest(spec({ rewardBase: BigInt(500_000) }))).not.toBe(
      missionSpecDigest(spec({ rewardBase: BigInt(500_001) })),
    );
  });
  it("maxCompletions is load-bearing", () => {
    expect(missionSpecDigest(spec({ maxCompletions: BigInt(1) }))).not.toBe(
      missionSpecDigest(spec({ maxCompletions: BigInt(2) })),
    );
  });
  it("MissionSpecInput has no display field — display formatting is structurally excluded", () => {
    // The digest input carries only base-unit reward; there is no `displayReward`/
    // `displayOrder` key on the spec, so a display string can never enter the digest.
    const keys = Object.keys(spec());
    expect(keys).not.toContain("displayReward");
    expect(keys).not.toContain("displayOrder");
    expect(keys).toContain("rewardBase");
  });
});
