import { describe, expect, it } from "vitest";
import {
  allowlistItemState,
  batchAllowlistPhase,
  formatCountdown,
} from "./allowlist-state";

describe("allowlistItemState", () => {
  const now = 1_000_000;

  it("approved short-circuits", () => {
    expect(allowlistItemState({ approved: true, pendingReadyAt: 0, now }).phase).toBe(
      "approved",
    );
  });

  it("unqueued when not approved and nothing pending", () => {
    expect(allowlistItemState({ approved: false, pendingReadyAt: 0, now }).phase).toBe(
      "unqueued",
    );
  });

  it("waiting inside the timelock, with seconds left", () => {
    const s = allowlistItemState({ approved: false, pendingReadyAt: now + 120, now });
    expect(s.phase).toBe("waiting");
    expect(s.secondsLeft).toBe(120);
  });

  it("ready once the timelock has matured", () => {
    expect(
      allowlistItemState({ approved: false, pendingReadyAt: now, now }).phase,
    ).toBe("ready");
    expect(
      allowlistItemState({ approved: false, pendingReadyAt: now - 5, now }).phase,
    ).toBe("ready");
  });
});

describe("batchAllowlistPhase", () => {
  it("all approved → approved; any waiting dominates; else ready; else unqueued", () => {
    expect(batchAllowlistPhase(["approved", "approved"])).toBe("approved");
    expect(batchAllowlistPhase(["approved", "waiting", "ready"])).toBe("waiting");
    expect(batchAllowlistPhase(["approved", "ready", "unqueued"])).toBe("ready");
    expect(batchAllowlistPhase(["unqueued", "unqueued"])).toBe("unqueued");
    expect(batchAllowlistPhase([])).toBe("approved");
  });
});

describe("formatCountdown", () => {
  it("formats minutes+seconds and clamps negatives", () => {
    expect(formatCountdown(598)).toBe("9m 58s");
    expect(formatCountdown(45)).toBe("45s");
    expect(formatCountdown(-3)).toBe("0s");
  });
});
