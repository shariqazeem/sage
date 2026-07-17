import { describe, expect, it } from "vitest";
import { putPendingReview, consumePendingReview } from "./pending-review";

describe("pending-review — the confirm-release two-step store", () => {
  it("consumes a pending release EXACTLY once (a second confirm gets nothing)", () => {
    putPendingReview("chatA", "camp1", "sub1");
    expect(consumePendingReview("chatA")).toEqual({ campaignId: "camp1", submissionId: "sub1" });
    expect(consumePendingReview("chatA")).toBeNull();
  });

  it("returns null when there's nothing prepared to confirm", () => {
    expect(consumePendingReview("neverRequested")).toBeNull();
  });

  it("a fresh request replaces the prior one for the same chat", () => {
    putPendingReview("chatB", "camp1", "subOLD");
    putPendingReview("chatB", "camp2", "subNEW");
    expect(consumePendingReview("chatB")).toEqual({ campaignId: "camp2", submissionId: "subNEW" });
  });
});
