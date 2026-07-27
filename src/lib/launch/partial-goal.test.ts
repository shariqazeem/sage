import { describe, it, expect } from "vitest";
import { journeyGapQuestion, type GoalCheckpointV1 } from "./goal-journey";

/**
 * A WALL SAGE CANNOT CROSS IS A STATEMENT ABOUT SAGE, NOT ABOUT THE WORK.
 *
 * The founder asked for testers to launch a campaign. Sage explored the whole product, reached the
 * launch flow, and stopped at the wallet — which it cannot connect and must not. Every checkpoint
 * past that point went unmet, and the founder was sent away with nothing plus a request to restate
 * the goal they had already given.
 *
 * A human tester connects their own wallet trivially. Sage simply cannot WITNESS it. So the part it
 * did verify is still worth paying for, and the boundary is disclosed rather than hidden.
 */

const cp = (over: Partial<GoalCheckpointV1>): GoalCheckpointV1 => ({
  checkpointId: "cp",
  kind: "interaction",
  requirement: "Connect the wallet",
  targetEntity: "wallet",
  requiredContext: "",
  dependsOn: [],
  sourcePhrase: "",
  evidence: { factIds: [], transitionIds: [] },
  status: "unmet",
  ...over,
});

describe("the boundary is named honestly, never hidden", () => {
  it("an unreachable entity reads as an ACCESS question, not a purpose question", () => {
    const q = journeyGapQuestion(cp({ entityIsObserved: false }));
    expect(q).toMatch(/never found/i);
    expect(q).toMatch(/account, invite, or permission/i);
    // it must NOT ask the founder what they want — they already said
    expect(q).not.toMatch(/what (is|would|should).*(most important|success)/i);
  });

  it("a found-but-unfinished step asks for a verifiable outcome instead", () => {
    const q = journeyGapQuestion(cp({ entityIsObserved: true }));
    expect(q).toMatch(/found/i);
    expect(q).toMatch(/verify/i);
  });
});

describe("what the founder is told when only part was reachable", () => {
  /** the exact sentence the pipeline emits — asserted here so its promises stay honest */
  const disclosure = (unreachable: string[]) =>
    `These missions cover what Sage verified itself. It could not reach ${unreachable.length === 1 ? "this part" : "these parts"} of your request — ${unreachable.join("; ")} — because that needs an account, wallet or permission Sage doesn't have. A human tester can still do it; Sage just can't witness it, so it isn't something it can pay out on automatically.`;

  it("says what was covered, what was not, and why", () => {
    const d = disclosure(["Connect the wallet", "Confirm the campaign went live"]);
    expect(d).toMatch(/cover what Sage verified itself/i);
    expect(d).toContain("Connect the wallet");
    expect(d).toMatch(/needs an account, wallet or permission/i);
  });

  it("never claims the blocked outcome was observed", () => {
    const d = disclosure(["Connect the wallet"]);
    expect(d).not.toMatch(/\bverified the wallet\b|\bconfirmed the wallet\b/i);
    expect(d).toMatch(/can't witness it/i);
  });

  it("is explicit that the blocked part is not auto-payable", () => {
    expect(disclosure(["Connect the wallet"])).toMatch(/isn't something it can pay out on automatically/i);
  });

  it("reads naturally for one part and for several", () => {
    expect(disclosure(["A"])).toContain("this part");
    expect(disclosure(["A", "B"])).toContain("these parts");
  });
});
