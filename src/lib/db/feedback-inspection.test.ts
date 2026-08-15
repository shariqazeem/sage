import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The pair that makes "use Sage, then tell us what you thought" AUTO-PAYABLE: the inspection row
 * proves the run, the feedback row proves the feedback, and both carry the same inspection id. Sage
 * never has to take a tester's word for either half.
 */
const rows: { inspectionId: string | null; createdAt: number }[] = [];
vi.mock("./index", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (pred: { id: string }) => ({
          all: () => rows.filter((r) => r.inspectionId === pred.id),
        }),
      }),
    }),
  },
}));
vi.mock("drizzle-orm", () => ({ desc: (x: unknown) => x, eq: (_c: unknown, v: string) => ({ id: v }) }));
vi.mock("./keys", () => ({ nowSeconds: () => 1000 }));
vi.mock("./schema", () => ({ feedback: { createdAt: "createdAt", inspectionId: "inspectionId" } }));

import { feedbackAtForInspection } from "./feedback";

beforeEach(() => { rows.length = 0; });

describe("feedbackAtForInspection", () => {
  it("is null when nobody has spoken — the marker must never appear on its own", () => {
    rows.push({ inspectionId: "other", createdAt: 500 });
    expect(feedbackAtForInspection("mine")).toBeNull();
  });

  it("returns the EARLIEST feedback — the first time they spoke, not the last", () => {
    rows.push({ inspectionId: "mine", createdAt: 900 });
    rows.push({ inspectionId: "mine", createdAt: 400 });
    rows.push({ inspectionId: "mine", createdAt: 700 });
    expect(feedbackAtForInspection("mine")).toBe(400);
  });

  it("never counts another inspection's feedback — one run, one proof", () => {
    rows.push({ inspectionId: "theirs", createdAt: 100 });
    rows.push({ inspectionId: "mine", createdAt: 800 });
    expect(feedbackAtForInspection("mine")).toBe(800);
  });
});
