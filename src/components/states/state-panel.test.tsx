import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { VerdictBadge } from "@/components/verdict-badge";
import { VERDICTS } from "@/lib/verdicts";
import { StatePanel } from "./state-panel";

describe("StatePanel", () => {
  it("renders the loading state with busy semantics", () => {
    render(<StatePanel status="loading" />);
    const panel = screen.getByRole("status");
    expect(panel).toHaveAttribute("data-state", "loading");
    expect(panel).toHaveAttribute("aria-busy", "true");
  });

  it("renders the empty state with title and description", () => {
    render(
      <StatePanel
        status="empty"
        title="No investigations"
        description="Run one to begin."
      />,
    );
    expect(screen.getByText("No investigations")).toBeInTheDocument();
    expect(screen.getByText("Run one to begin.")).toBeInTheDocument();
    expect(
      screen.getByText("No investigations").closest("[data-slot]"),
    ).toHaveAttribute("data-state", "empty");
  });

  it("renders the error state as an alert", () => {
    render(<StatePanel status="error" title="Investigation failed" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-state", "error");
    expect(screen.getByText("Investigation failed")).toBeInTheDocument();
  });

  it("renders the success state", () => {
    render(<StatePanel status="success" title="Verdict issued" />);
    const panel = screen.getByRole("status");
    expect(panel).toHaveAttribute("data-state", "success");
    expect(screen.getByText("Verdict issued")).toBeInTheDocument();
  });
});

describe("VerdictBadge", () => {
  it.each(VERDICTS)("renders the %s verdict", (verdict) => {
    render(<VerdictBadge verdict={verdict} />);
    const badge = screen.getByText(verdict);
    expect(badge.closest('[data-slot="verdict-badge"]')).toHaveAttribute(
      "data-verdict",
      verdict,
    );
  });
});
