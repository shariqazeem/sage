import { describe, expect, it } from "vitest";
import { canDecide, canTransition, isTerminal } from "./status";

describe("submission status machine", () => {
  it("allows pending → approved/rejected and approved → paid", () => {
    expect(canTransition("pending", "approved")).toBe(true);
    expect(canTransition("pending", "rejected")).toBe(true);
    expect(canTransition("approved", "paid")).toBe(true);
  });

  it("forbids transitions out of terminal states", () => {
    expect(canTransition("paid", "approved")).toBe(false);
    expect(canTransition("rejected", "approved")).toBe(false);
    expect(canTransition("pending", "paid")).toBe(false); // must approve first
  });

  it("only pending submissions are decidable", () => {
    expect(canDecide("pending")).toBe(true);
    expect(canDecide("approved")).toBe(false);
    expect(canDecide("paid")).toBe(false);
  });

  it("marks paid and rejected terminal", () => {
    expect(isTerminal("paid")).toBe(true);
    expect(isTerminal("rejected")).toBe(true);
    expect(isTerminal("pending")).toBe(false);
    expect(isTerminal("approved")).toBe(false);
  });
});
