import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { db } from "@/lib/db";
import { campaignFindings } from "@/lib/db/schema";
import { topFindingFor } from "./result-facts";

/** The result post's finding comes from the builder's report: the group most people ran into, never a stored count. */

beforeEach(() => {
  db.delete(campaignFindings).run();
});

const put = (campaignId: string, findings: { title: string; kind: "stuck" | "bug" | "liked" | "idea" | "other"; submissionIds: string[]; quotes: { submissionId: string; text: string }[] }[]) =>
  db.insert(campaignFindings).values({ campaignId, json: { findings }, paidAnswers: 5, engine: "plain", builtAt: 1 }).run();

describe("topFindingFor", () => {
  it("is null without a report", () => {
    expect(topFindingFor("gig-none")).toBeNull();
  });

  it("picks the group the most distinct people ran into, with its first quote", () => {
    put("gig-a", [
      { title: "Liked the garden", kind: "liked", submissionIds: ["s1"], quotes: [{ submissionId: "s1", text: "Lovely." }] },
      { title: "Stuck at the code email", kind: "stuck", submissionIds: ["s2", "s3", "s3", "s4"], quotes: [{ submissionId: "s2", text: "The code email never came, so I stopped." }] },
    ]);
    expect(topFindingFor("gig-a")).toEqual({ finding: "Stuck at the code email", quote: "The code email never came, so I stopped." });
  });

  it("uses Other notes only when there is nothing else", () => {
    put("gig-b", [
      { title: "Other notes", kind: "other", submissionIds: ["s1", "s2", "s3"], quotes: [] },
      { title: "Slow first load", kind: "bug", submissionIds: ["s4"], quotes: [] },
    ]);
    expect(topFindingFor("gig-b")?.finding).toBe("Slow first load");
    put("gig-c", [{ title: "Other notes", kind: "other", submissionIds: ["s1"], quotes: [] }]);
    expect(topFindingFor("gig-c")).toEqual({ finding: "Other notes", quote: null });
  });
});
