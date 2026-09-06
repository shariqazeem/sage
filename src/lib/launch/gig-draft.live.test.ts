import { describe, expect, it } from "vitest";
import { draftDirectCampaign } from "./gig-draft";
import { readStatedTerms } from "./stated-terms";

/**
 * LIVE (`DRAFT_LIVE=1`, run on the VM where the MISSION lane's key lives): does the real model honour
 * the milestone count the founder said out loud? The unit test pins the mechanism with a stub; only
 * this one tells you whether the shipped prompt actually holds a real model to it.
 */
const CASES = [
  ["Pay a market seller in Kingston J$1,600 for her shop in two milestones: first the catalogue page online with her wallet address, then the first customer review posted online.", 2],
  ["fund my cousin's shop $60 in three milestones: the shop page, photos of the stall, and the first three customer reviews", 3],
  ["Pay 5 people $2 each to publish a short setup guide for my product", null],
] as const;

describe.runIf(process.env.DRAFT_LIVE === "1")("the live model honours the stated milestone count", () => {
  for (const [intent, want] of CASES) {
    it(`${want ?? "no count"}: ${intent.slice(0, 52)}…`, { timeout: 180_000 }, async () => {
      expect(readStatedTerms(intent).milestoneCount).toBe(want);
      const t0 = Date.now();
      const r = await draftDirectCampaign({ intent });
      console.log(`  → ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      if (!r.ok) console.log(`  → REFUSED: ${r.error}`);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const got = r.draft.milestones.length;
      console.log(`  → wanted ${want ?? "any"}, got ${got}, kind=${r.draft.kind}, notes=${r.notes.length}`);
      for (const [i, m] of r.draft.milestones.entries()) console.log(`     ${i + 1}. ${m.title}`);
      if (want != null) {
        expect(got).toBe(want);
        expect(r.notes.join(" ")).not.toMatch(/You asked for/);
      }
    });
  }
});
