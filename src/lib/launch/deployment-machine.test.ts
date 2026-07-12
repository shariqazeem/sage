import { describe, expect, it } from "vitest";
import {
  transition,
  canTransition,
  guardStepBroadcast,
  hasOnChainVault,
  isTerminal,
  DEPLOYMENT_STATES,
  type DeploymentState,
} from "./deployment-machine";

/**
 * The deployment machine encodes the money-safety invariants of 04B. These tests assert
 * them exhaustively: the happy path walks cleanly, the terminal states are dead ends, and
 * — the load-bearing property — once a real vault exists on-chain, NO path leads back to
 * deploying or funding a second vault. A failed attach can only be re-attached.
 */

describe("deployment machine — the happy path walks straight to live", () => {
  const HAPPY: DeploymentState[] = [
    "prepared", "claimed", "preflight_ready", "deploying", "deployed", "approving",
    "approved", "funding", "funded", "activating", "active", "attaching", "live",
  ];
  it("every adjacent happy-path transition is legal", () => {
    for (let i = 0; i < HAPPY.length - 1; i++) {
      const r = transition(HAPPY[i], HAPPY[i + 1]);
      expect(r, `${HAPPY[i]} → ${HAPPY[i + 1]}`).toEqual({ ok: true, next: HAPPY[i + 1] });
    }
  });
  it("live and failed are terminal (no outgoing edges)", () => {
    expect(isTerminal("live")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    for (const s of DEPLOYMENT_STATES) {
      expect(transition("live", s === "live" ? "failed" : s).ok, `live → ${s}`).toBe(false);
      if (s !== "failed") expect(transition("failed", s).ok, `failed → ${s}`).toBe(false);
    }
  });
});

describe("deployment machine — no second vault (attachment failure never redeploys)", () => {
  it("recovery_required can ONLY re-attach or fail — never deploy/approve/fund/activate", () => {
    const forbidden: DeploymentState[] = ["prepared", "claimed", "preflight_ready", "deploying", "deployed", "approving", "approved", "funding", "funded", "activating", "active"];
    for (const to of forbidden) {
      expect(canTransition("recovery_required", to), `recovery_required → ${to} must be illegal`).toBe(false);
    }
    // the only legal exits:
    expect(canTransition("recovery_required", "attaching")).toBe(true);
    expect(canTransition("recovery_required", "live")).toBe(true);
    expect(canTransition("recovery_required", "failed")).toBe(true);
  });

  it("a post-vault failure cannot become `failed` — it must become recovery_required", () => {
    // once a vault exists, "failed" (which implies nothing to clean up) is refused.
    for (const from of ["deployed", "approving", "approved", "funding", "funded", "activating", "active", "attaching"] as DeploymentState[]) {
      expect(hasOnChainVault(from), `${from} has a vault`).toBe(true);
      const r = transition(from, "failed");
      expect(r.ok, `${from} → failed must be refused`).toBe(false);
      // ...but recovery_required is available from every post-vault state.
      expect(transition(from, "recovery_required").ok, `${from} → recovery_required`).toBe(true);
    }
  });

  it("a pre-vault failure CAN become `failed` (nothing on-chain yet)", () => {
    for (const from of ["prepared", "claimed", "preflight_ready", "deploying"] as DeploymentState[]) {
      expect(transition(from, "failed").ok, `${from} → failed`).toBe(true);
    }
    expect(hasOnChainVault("deploying")).toBe(false); // create tx may have reverted with no vault
    expect(hasOnChainVault("deployed")).toBe(true);
  });
});

describe("deployment machine — no blind resend (write-once tx per step)", () => {
  it("broadcasts a step only from its own state and only once", () => {
    // create is broadcast from `deploying`, and only if not already sent.
    expect(guardStepBroadcast("deploying", "create", null)).toEqual({ broadcast: true });
    expect(guardStepBroadcast("deploying", "create", "0xabc").broadcast).toBe(false); // already sent → poll
    // wrong step for the state is refused.
    expect(guardStepBroadcast("deploying", "fund", null).broadcast).toBe(false);
    expect(guardStepBroadcast("funding", "fund", null)).toEqual({ broadcast: true });
    expect(guardStepBroadcast("activating", "activate", null)).toEqual({ broadcast: true });
    expect(guardStepBroadcast("approving", "approve", "").broadcast).toBe(true); // empty string = not sent
  });
});

describe("deployment machine — illegal jumps are rejected", () => {
  it("cannot skip steps", () => {
    expect(transition("prepared", "deploying").ok).toBe(false); // must claim + preflight first
    expect(transition("claimed", "funded").ok).toBe(false);
    expect(transition("deployed", "funded").ok).toBe(false); // must approve first
    expect(transition("active", "live").ok).toBe(false); // must attach first
  });
  it("same-state is an idempotent no-op", () => {
    expect(transition("funding", "funding")).toEqual({ ok: true, next: "funding" });
  });
});
