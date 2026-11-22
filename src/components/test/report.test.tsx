import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import type { FindingsView } from "@/lib/report";
import { Report } from "./report";

/**
 * The report draws only what it is given: a count is "A of B", a group of people carries its title
 * and where they stopped, and the comparison with the last test never says more than its numbers.
 */
type View = Parameters<typeof Report>[0]["view"];

const finding = (over: Partial<FindingsView["findings"][number]>): FindingsView["findings"][number] => ({
  title: "The Continue button did nothing",
  kind: "stuck",
  count: 3,
  of: 10,
  stoppedOn: "Started, couldn't finish",
  people: [],
  quotes: [
    { submissionId: "a", text: "Pressed Continue and nothing happened." },
    { submissionId: "b", text: "The Continue button did nothing." },
    { submissionId: "c", text: "Continue does not respond." },
  ],
  fix: "People pressed this and saw nothing happen.",
  sageSaw: false,
  sageTitle: null,
  ...over,
});

const view = (over: Partial<View> = {}): View => ({ findings: [finding({})], core: null, fixFirst: [], paid: { answers: 10, people: 10, totalBase: 0, totalUsd: "0.00" }, changed: null, ...over });

describe("the report", () => {
  it("shows a group as A of B, with its title, where they stopped and two of their quotes", () => {
    render(<Report view={view()} />);
    const row = screen.getByRole("article");
    expect(within(row).getByLabelText("3 of 10 people")).toBeTruthy();
    expect(within(row).getByRole("heading", { level: 4 }).textContent).toContain("The Continue button did nothing");
    expect(within(row).getByText("Started, couldn't finish")).toBeTruthy();
    expect(within(row).getByText("Got stuck")).toBeTruthy();
    expect(within(row).getByText("1 more in their own words")).toBeTruthy();
  });

  it("does not repeat one person's own first words as a title", () => {
    render(<Report view={view({ findings: [finding({ count: 1, of: 4, stoppedOn: null, kind: "other", quotes: [{ submissionId: "a", text: "The page looked fine to me." }], title: "The page looked fine to me", fix: null })] })} />);
    expect(screen.queryByRole("heading", { level: 4 })).toBeNull();
    expect(screen.getByText("The page looked fine to me.")).toBeTruthy();
  });

  it("sets the last test beside this one, and says when the numbers are small", () => {
    const changed: NonNullable<View["changed"]> = {
      previous: { id: "c1", title: "Try Drops", path: "/t/c1" },
      live: true,
      people: { then: 10, now: 3 },
      small: "Small numbers: 10 people then, 3 now. Read this as a direction, not as proof.",
      lines: [{ key: "finished", label: "Finished the main action", then: { n: 3, of: 10 }, now: { n: 2, of: 3 } }],
      problems: [
        { title: "The Continue button did nothing", then: { n: 3, of: 10 }, now: { n: 0, of: 3 }, change: "gone", caution: "Too few people to call it fixed." },
        { title: "It wants a wallet first", then: { n: 4, of: 10 }, now: { n: 2, of: 3 }, change: "still", caution: null },
      ],
    };
    render(<Report view={view({ findings: [], changed })} />);
    const section = screen.getByRole("region", { name: "Since your last test" });
    expect(within(section).getByRole("link", { name: "your last test of this product" }).getAttribute("href")).toBe("/t/c1");
    expect(within(section).getByLabelText("3 of 10 then, 2 of 3 now")).toBeTruthy();
    expect(within(section).getByLabelText("3 of 10 then, 0 of 3 now")).toBeTruthy();
    expect(within(section).getByText("Gone this time")).toBeTruthy();
    expect(within(section).getByText("Still hit")).toBeTruthy();
    expect(within(section).getByText("Too few people to call it fixed.")).toBeTruthy();
    expect(within(section).getByText(/Small numbers: 10 people then, 3 now/)).toBeTruthy();
    expect(section.textContent).toContain("so far");
  });

  it("draws no comparison when there is no earlier test", () => {
    render(<Report view={view()} />);
    expect(screen.queryByText("Since your last test")).toBeNull();
  });
});
