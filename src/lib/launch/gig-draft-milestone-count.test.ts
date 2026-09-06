import { describe, expect, it, vi } from "vitest";
import { draftDirectCampaign, GIG_DRAFT_SYSTEM } from "./gig-draft";
import { readStatedTerms } from "./stated-terms";

/**
 * THE FOUNDER'S STATED MILESTONE COUNT.
 *
 * 7 Sep 2026, found on the live composer: "Pay a market seller in Kingston J$1,600 for her shop in two
 * milestones: first the catalogue page online with her wallet address, then the first customer review
 * posted online." drafted as ONE deliverable paying the whole J$1,600 — schema-valid, so the corrective
 * round (which only fired on schema misses) never saw it, and every gate downstream passed a plan that
 * paid the whole grant for half the work.
 *
 * The count is read deterministically from the founder's own sentence, handed to the model, and then
 * checked against the answer — the same treatment the money already gets.
 */
const DEMO =
  "Pay a market seller in Kingston J$1,600 for her shop in two milestones: first the catalogue page online with her wallet address, then the first customer review posted online.";

const milestone = (title: string) => ({
  title,
  deliverable: `A page showing ${title} is published online and is publicly readable by anyone.`,
  instructions: `1. Do the work. 2. Publish it on a durable public page. 3. Submit the link for ${title}.`,
  criteria: [
    "The page names the shop and the town",
    "At least 150 words in the worker's own words, not copied from another source",
    "The worker's own wallet address appears on the page",
  ],
  evidence: { kind: "artifact_url" as const, allowedHosts: [], minWords: 150 },
  effortMinutes: 30,
});

const draftOf = (n: number, kind: "gig" | "grant" = n > 1 ? "grant" : "gig") => ({
  kind,
  title: "Pay a market seller",
  who: "a market seller in Kingston",
  slots: 1,
  milestones: Array.from({ length: n }, (_, i) => milestone(i === 0 ? "Catalogue page online" : `Stage ${i + 1}`)),
});

describe("the founder's stated milestone count is a fact, not a suggestion", () => {
  it("the deterministic reader sees two milestones in the demo sentence", () => {
    expect(readStatedTerms(DEMO).milestoneCount).toBe(2);
  });

  it("the prompt tells the model the count is the founder's", () => {
    expect(GIG_DRAFT_SYSTEM).toMatch(/MILESTONE COUNT IS THE FOUNDER'S/);
  });

  it("hands the stated count to the model in the request", async () => {
    const complete = vi.fn(async () => ({ json: draftOf(2), model: "test" }));
    const r = await draftDirectCampaign({ intent: DEMO }, { complete });
    expect(r.ok).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0].user).toMatch(/NAMED 2 MILESTONES/);
  });

  it("a one-milestone draft of a two-milestone ask is sent back for a second round", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ json: draftOf(1, "gig"), model: "test" })
      .mockResolvedValueOnce({ json: draftOf(2), model: "test" });
    const r = await draftDirectCampaign({ intent: DEMO }, { complete });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.milestones).toHaveLength(2);
    expect(r.notes.join(" ")).not.toMatch(/Add the missing one/);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][0].user).toMatch(/named 2 milestones and your draft has 1/);
  });

  it("a model that will not comply TELLS the founder — never a quiet one-milestone plan", async () => {
    const complete = vi.fn(async () => ({ json: draftOf(1, "gig"), model: "test" }));
    const r = await draftDirectCampaign({ intent: DEMO }, { complete });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notes.join(" ")).toMatch(/You asked for 2 milestones and Sage drafted 1/);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("says nothing about milestones when the founder named no count — a plain gig is untouched", async () => {
    const complete = vi.fn(async () => ({ json: draftOf(1, "gig"), model: "test" }));
    const r = await draftDirectCampaign({ intent: "Pay 5 people $2 each to publish a short setup guide for my product" }, { complete });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notes.join(" ")).not.toMatch(/milestone/i);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0].user).not.toMatch(/NAMED \d+ MILESTONES/);
  });

  it("reads a count written in words, and the half-and-half shape", async () => {
    expect(readStatedTerms("fund my cousin's shop $60 in three milestones").milestoneCount).toBe(3);
    expect(readStatedTerms("pay her $40 total, half when she publishes the catalogue and half when she posts a review").milestoneCount).toBe(2);
  });
});
