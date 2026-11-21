import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PurposeLine } from "./purpose-line";

describe("what Sage thinks you want", () => {
  it("says Sage's read, what it did because of it, and why", () => {
    render(<PurposeLine purpose={{ line: "You most likely want the checkout tested first.", rank: "yield", why: "You named the checkout." }} />);
    expect(screen.getByText("What Sage thinks you want")).toBeTruthy();
    expect(screen.getByText("You most likely want the checkout tested first.")).toBeTruthy();
    expect(screen.getByText(/the flow you named comes first\. On a small budget, the first-try mission is the one that waits\. You named the checkout\./i)).toBeTruthy();
  });

  it("each rank says plainly where the first-try mission stands", () => {
    const { rerender } = render(<PurposeLine purpose={{ line: "You most likely want to know whether strangers get it.", rank: "lead", why: null }} />);
    expect(screen.getByText(/every tester starts with the first-try mission/)).toBeTruthy();
    rerender(<PurposeLine purpose={{ line: "You most likely want both.", rank: "alongside", why: null }} />);
    expect(screen.getByText(/sits beside the flows you named/)).toBeTruthy();
  });
});
