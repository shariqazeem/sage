import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Ticket } from "./ticket";

describe("the tester ticket, on a test the builder checks", () => {
  it("says the builder is reading the answer, never that Sage is", () => {
    render(<Ticket handle="Tester 1" state="checking" amount="$2.00" byBuilder />);
    expect(screen.getByText("Waiting for the builder to read the answer")).toBeTruthy();
    expect(screen.queryByText("Sage is checking the answer")).toBeNull();
  });
  it("says who read a paid answer", () => {
    render(<Ticket handle="Tester 1" state="paid" amount="$2.00" byBuilder />);
    expect(screen.getByText("Read by the builder and paid")).toBeTruthy();
  });
  it("is word for word what it was on every other test", () => {
    render(<Ticket handle="Tester 1" state="checking" amount="$2.00" />);
    expect(screen.getByText("Sage is checking the answer")).toBeTruthy();
  });
});
