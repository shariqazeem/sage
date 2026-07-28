import { describe, it, expect } from "vitest";
import { buildInspectionNotice } from "./concierge";
import type { InspectionView } from "@/lib/agent-api/operations";

/**
 * A PARTIAL plan must confess on the same screen as the missions. Sage now plans the part it
 * verified instead of dead-ending on a goal it couldn't finish itself — which is right, but it puts
 * a new obligation on the founder-facing message: without the boundary, a partial plan is
 * indistinguishable from a complete one, and the founder funds it believing their whole ask is
 * covered. The ready path was discarding that sentence outright (`needsInput` is null once ready).
 *
 * Telegram is the surface where this matters most: there is no plan page in view, just the message.
 */

const view = (over: Partial<InspectionView> = {}): InspectionView =>
  ({
    inspectionId: "abc123",
    stage: "ready",
    ready: true,
    productUrl: "https://sagepays.xyz/launch",
    goal: "make users launch a campaign",
    pagesInspected: 7,
    needsInput: null,
    coverageNote: null,
    failure: null,
    plan: {
      missionCount: 1,
      budgetUsd: 50,
      totalBudgetBase: "50000000",
      missions: [
        {
          title: "Initiate a new product testing campaign",
          objective: "Confirm a founder can start one.",
          rewardUsd: 25,
          rewardBase: "25000000",
          maxCompletions: "2",
        },
      ],
    },
    approvalUrl: "https://sagepays.xyz/launch/abc123",
    approvalNote: null,
    planningRequestId: "req_1",
    fieldTest: null,
    corpusReadiness: null,
    ...over,
  }) as InspectionView;

describe("a partial plan says what it does not cover", () => {
  const note =
    "These missions cover what Sage verified itself. It did not finish this part of your request — Connect a wallet — because it needs an account, wallet or permission Sage doesn't have.";
  const out = buildInspectionNotice(view({ coverageNote: note }));

  it("carries the boundary into the message", () => {
    expect(out).toContain(note);
  });

  it("still presents the missions and the budget", () => {
    expect(out).toContain("Initiate a new product testing campaign");
    expect(out).toMatch(/\$50/);
  });

  it("does not claim anything is approved or funded", () => {
    expect(out).toMatch(/Nothing is approved or funded yet/i);
  });
});

describe("a complete plan stays clean", () => {
  const out = buildInspectionNotice(view({ coverageNote: null }));

  it("adds no boundary paragraph when there is no boundary", () => {
    expect(out).not.toMatch(/did not finish|could not reach/i);
  });
});

describe("Sage shows that it browsed, with or without screenshots", () => {
  it("reports field-test pages when the browser ran", () => {
    const out = buildInspectionNotice(
      view({ fieldTest: { pages: 3, screenshots: 3 } }),
    );
    expect(out).toMatch(/clicked through 3 pages/i);
  });

  it("falls back to the pages it read when no screenshot was captured", () => {
    const out = buildInspectionNotice(
      view({ fieldTest: { pages: 3, screenshots: 0 }, pagesInspected: 7 }),
    );
    expect(out).toMatch(/read 7 pages/i);
  });

  it("claims no browsing when there was none", () => {
    const out = buildInspectionNotice(
      view({ fieldTest: null, pagesInspected: 0 }),
    );
    expect(out).not.toMatch(/clicked through|I read \d+ page/i);
  });

  it("keeps the singular honest", () => {
    const out = buildInspectionNotice(
      view({ fieldTest: null, pagesInspected: 1 }),
    );
    expect(out).toMatch(/read 1 page\b/);
    expect(out).not.toMatch(/read 1 pages/);
  });
});
