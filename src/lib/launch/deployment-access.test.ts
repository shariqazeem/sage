import { describe, expect, it } from "vitest";
import { deploymentNextAction, deploymentView } from "./deployment-access";
import type { DeploymentState } from "./deployment-machine";
import type { Deployment } from "@/lib/db/schema";

/**
 * The next-action map is what the founder UI is driven by, so it must map EVERY durable
 * state to exactly one safe next move — a wrong mapping could re-broadcast a step or skip
 * verification. deploymentView is the refresh-safe projection the client resumes from.
 */

describe("deploymentNextAction — every state maps to one safe move", () => {
  const cases: [DeploymentState, string, string | undefined, string | undefined][] = [
    ["prepared", "claim", undefined, undefined],
    ["claimed", "limits", undefined, undefined],
    ["preflight_ready", "execute", "create", "broadcast"],
    ["deploying", "execute", "create", "confirm"],
    ["deployed", "execute", "approve", "broadcast"],
    ["approving", "execute", "approve", "confirm"],
    ["approved", "execute", "fund", "broadcast"],
    ["funding", "execute", "fund", "confirm"],
    ["funded", "execute", "activate", "broadcast"],
    ["activating", "execute", "activate", "confirm"],
    ["active", "attach", undefined, undefined],
    ["attaching", "attach", undefined, undefined],
    ["live", "live", undefined, undefined],
    ["recovery_required", "recovery", undefined, undefined],
    ["failed", "failed", undefined, undefined],
  ];
  for (const [state, phase, step, mode] of cases) {
    it(`${state} → ${phase}${step ? `/${step}/${mode}` : ""}`, () => {
      const a = deploymentNextAction(state);
      expect(a.phase).toBe(phase);
      expect(a.step).toBe(step);
      expect(a.mode).toBe(mode);
    });
  }

  it("a broadcast step is NEVER emitted from a post-vault confirmed state (no double-send)", () => {
    // deployed/approved/funded emit the NEXT step's broadcast, never re-broadcast the prior.
    expect(deploymentNextAction("deployed").step).toBe("approve"); // not "create" again
    expect(deploymentNextAction("approved").step).toBe("fund");
    expect(deploymentNextAction("funded").step).toBe("activate");
  });
});

describe("deploymentView — refresh-safe projection", () => {
  function dep(over: Partial<Deployment>): Deployment {
    return {
      id: "d1", jobId: "j1", state: "funded", chainId: 59902, founderWallet: "0xabc",
      predictedVault: "0xvault", deployedVault: "0xvault", attachedCampaignId: null,
      totalBudgetBase: 1_000_000, createTx: "0x1", approveTx: "0x2", fundTx: "0x3", activateTx: null,
      failureReason: null, ...over,
    } as unknown as Deployment;
  }
  it("marks steps done through the current state and carries their tx hashes", () => {
    const v = deploymentView(dep({ state: "funded" }), 6);
    const done = Object.fromEntries(v.steps.map((s) => [s.step, s.done]));
    expect(done).toEqual({ create: true, approve: true, fund: true, activate: false });
    expect(v.next).toEqual({ phase: "execute", step: "activate", mode: "broadcast" });
    expect(v.totalBudgetHuman).toBe("1");
  });
  it("live marks everything done", () => {
    const v = deploymentView(dep({ state: "live", activateTx: "0x4", attachedCampaignId: "c1" }), 6);
    expect(v.steps.every((s) => s.done)).toBe(true);
    expect(v.terminal).toBe(true);
    expect(v.attachedCampaignId).toBe("c1");
  });
});
