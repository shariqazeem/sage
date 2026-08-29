import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RailChoice } from "./rail-choice";

describe("the founder's rail choice", () => {
  it("offers two options and marks the current one", () => {
    render(<RailChoice value="evm" onChange={() => {}} />);
    const opts = screen.getAllByRole("radio");
    expect(opts).toHaveLength(2);
    expect(opts[0]?.getAttribute("aria-checked")).toBe("true");
    expect(opts[1]?.getAttribute("aria-checked")).toBe("false");
  });

  it("reports the founder's choice", async () => {
    const onChange = vi.fn();
    render(<RailChoice value="evm" onChange={onChange} />);
    await userEvent.click(screen.getAllByRole("radio")[1]!);
    expect(onChange).toHaveBeenCalledWith("starknet");
  });

  /**
   * Once a plan is approved the budget is committed to a specific rail, so changing it would mean
   * a campaign funded on one and settled on another.
   */
  it("cannot be changed once the plan is locked", async () => {
    const onChange = vi.fn();
    render(<RailChoice value="evm" onChange={onChange} disabled />);
    await userEvent.click(screen.getAllByRole("radio")[1]!);
    expect(onChange).not.toHaveBeenCalled();
  });

  /**
   * BOTH OPTIONS MUST STATE THEIR COST. Public exposes a tester's income; private settles somewhere
   * fewer venues list and leaves the privacy for the worker to use. A chooser that lists only
   * benefits is a recommendation wearing the clothes of a choice.
   */
  it("states the trade-off on both options, not just the benefit", () => {
    render(<RailChoice value="evm" onChange={() => {}} />);
    const trades = screen.getAllByText(/The trade:/);
    expect(trades).toHaveLength(2);
    expect(screen.getByText(/earnings are visible to anyone/i)).toBeTruthy();
    expect(screen.getByText(/not automatic/i)).toBeTruthy();
  });

  /**
   * It must not ask a chain question. A founder hiring testing has no way to evaluate "GOAT or
   * Starknet?" — they can answer "should the amounts be public?" immediately, and the chain follows.
   */
  it("never names a chain in the choice a founder reads", () => {
    render(<RailChoice value="evm" onChange={() => {}} />);
    const headings = screen.getAllByRole("radio").map((e) => e.querySelector(".lx-rail-h")?.textContent ?? "");
    for (const h of headings) expect(h).not.toMatch(/GOAT|Metis|chain/i);
  });
});
