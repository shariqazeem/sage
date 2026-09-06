import { describe, expect, it } from "vitest";
import { draftDirectCampaign, draftTokenBudget, GIG_DRAFT_SYSTEM } from "./gig-draft";
import { readStatedTerms } from "./stated-terms";

/**
 * THE FOUNDER'S STATED MILESTONE COUNT, AND ROOM FOR THE ANSWER.
 *
 * 7 Sep 2026, both found on the live composer with one sentence: "Pay a market seller in Kingston
 * J$1,600 for her shop in two milestones: first the catalogue page online with her wallet address,
 * then the first customer review posted online."
 *
 *  1. It drafted as ONE deliverable paying the whole J$1,600 — schema-valid, so the corrective round
 *     (which only ever fired on schema misses) never saw it, and every gate downstream passed a plan
 *     that paid the whole grant for half the work.
 *  2. Once the model was held to two milestones, the flat 2,200-token answer budget cut the JSON
 *     mid-object; both rounds burned and the founder was told their sentence "didn't fit the brief
 *     shape". Measured live against the real model, not inferred.
 *
 * The count is read deterministically from their own sentence — the same treatment the money gets —
 * handed to the model, checked against the answer, and given enough room to come back whole.
 */
const DEMO =
  "Pay a market seller in Kingston J$1,600 for her shop in two milestones: first the catalogue page online with her wallet address, then the first customer review posted online.";

interface Call {
  system: string;
  user: string;
  maxTokens: number;
}

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

/** Records what the draft asked the model for, so a test can read the request as well as the answer. */
function recorder(...answers: unknown[]) {
  const calls: Call[] = [];
  const complete = async (o: Call) => {
    calls.push(o);
    return { json: answers[Math.min(calls.length - 1, answers.length - 1)], model: "test" };
  };
  return { calls, complete };
}

describe("the founder's stated milestone count is a fact, not a suggestion", () => {
  it("the deterministic reader sees two milestones in the demo sentence", () => {
    expect(readStatedTerms(DEMO).milestoneCount).toBe(2);
  });

  it("the prompt tells the model the count is the founder's", () => {
    expect(GIG_DRAFT_SYSTEM).toMatch(/MILESTONE COUNT IS THE FOUNDER'S/);
  });

  it("hands the stated count to the model in the request", async () => {
    const { calls, complete } = recorder(draftOf(2));
    const r = await draftDirectCampaign({ intent: DEMO }, { complete });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.user).toMatch(/NAMED 2 MILESTONES/);
  });

  it("a one-milestone draft of a two-milestone ask is sent back for a second round", async () => {
    const { calls, complete } = recorder(draftOf(1, "gig"), draftOf(2));
    const r = await draftDirectCampaign({ intent: DEMO }, { complete });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.milestones).toHaveLength(2);
    expect(r.notes.join(" ")).not.toMatch(/Add the missing one/);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.user).toMatch(/named 2 milestones and your draft has 1/);
  });

  it("a model that will not comply TELLS the founder — never a quiet one-milestone plan", async () => {
    const { calls, complete } = recorder(draftOf(1, "gig"));
    const r = await draftDirectCampaign({ intent: DEMO }, { complete });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notes.join(" ")).toMatch(/You asked for 2 milestones and Sage drafted 1/);
    expect(calls).toHaveLength(2);
  });

  it("says nothing about milestones when the founder named no count — a plain gig is untouched", async () => {
    const { calls, complete } = recorder(draftOf(1, "gig"));
    const r = await draftDirectCampaign(
      { intent: "Pay 5 people $2 each to publish a short setup guide for my product" },
      { complete },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notes.join(" ")).not.toMatch(/milestone/i);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.user).not.toMatch(/NAMED \d+ MILESTONES/);
  });

  it("the answer budget grows with the milestones asked for — a flat 2,200 cut a two-milestone grant mid-JSON", async () => {
    expect(draftTokenBudget(1)).toBeGreaterThan(2200);
    expect(draftTokenBudget(2)).toBeGreaterThan(draftTokenBudget(1));
    expect(draftTokenBudget(3)).toBeGreaterThan(draftTokenBudget(2));
    expect(draftTokenBudget(null)).toBe(draftTokenBudget(1));
    expect(draftTokenBudget(50)).toBeLessThanOrEqual(8000);
    const { calls, complete } = recorder(draftOf(2));
    await draftDirectCampaign({ intent: DEMO }, { complete });
    expect(calls[0]!.maxTokens).toBe(draftTokenBudget(2));
  });

  it("reads a count written in words, and the half-and-half shape", () => {
    expect(readStatedTerms("fund my cousin's shop $60 in three milestones").milestoneCount).toBe(3);
    expect(
      readStatedTerms("pay her $40 total, half when she publishes the catalogue and half when she posts a review")
        .milestoneCount,
    ).toBe(2);
  });
});
