import { describe, expect, it } from "vitest";
import { findDuplicate, findNearDuplicate, jaccard, normalizeNote, shingleSet } from "./dedup";

describe("findDuplicate — Sybil / farming dedup", () => {
  it("flags identical evidence content (same sha256) even if the note differs", () => {
    const hit = findDuplicate(
      { note: "a completely different note over here", contentSha256: "abc123" },
      [{ note: "some other unrelated note", contentSha256: "abc123" }],
    );
    expect(hit?.reason).toContain("same evidence");
  });

  it("flags the same report text from a different wallet (case + whitespace insensitive)", () => {
    const note =
      "The proof page showed $0.50 settled on GOAT and the explorer link worked.";
    const hit = findDuplicate(
      { note, contentSha256: null },
      [{ note: `   ${note.toUpperCase()}   `, contentSha256: "unrelated" }],
    );
    expect(hit?.reason).toContain("same report text");
  });

  it("passes genuinely distinct submissions", () => {
    expect(
      findDuplicate(
        {
          note: "I tried the jailbreak box and it held with prompt_injection.",
          contentSha256: "x1",
        },
        [
          {
            note: "The onboarding was smooth and the ring animation is nice.",
            contentSha256: "y2",
          },
        ],
      ),
    ).toBeNull();
  });

  it("does NOT collide on trivially short notes (below the min length)", () => {
    expect(
      findDuplicate(
        { note: "nice app", contentSha256: null },
        [{ note: "nice app", contentSha256: null }],
      ),
    ).toBeNull();
  });

  it("null hashes never match by content", () => {
    expect(
      findDuplicate(
        { note: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", contentSha256: null },
        [{ note: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", contentSha256: null }],
      ),
    ).toBeNull();
  });

  it("returns null against an empty prior set", () => {
    expect(
      findDuplicate({ note: "anything at all here", contentSha256: "z" }, []),
    ).toBeNull();
  });

  it("normalizeNote collapses whitespace and lowercases", () => {
    expect(normalizeNote("  Hello   WORLD  ")).toBe("hello world");
    expect(normalizeNote(null)).toBe("");
  });
});

describe("findNearDuplicate — paraphrase-tolerant farming detection (P18)", () => {
  const ORIGINAL =
    "I completed the signup flow at the pricing page and confirmed the three plan tiers are visible and the get started button works.";

  it("flags a light paraphrase of an earlier report (the cheap multi-wallet farm)", () => {
    const paraphrase =
      "I completed the sign up flow on the pricing page and confirmed the three plan tiers are visible and the get started button works.";
    const hit = findNearDuplicate({ note: paraphrase, contentSha256: null }, [{ note: ORIGINAL, contentSha256: null }]);
    expect(hit).not.toBeNull();
    expect(hit?.reason).toMatch(/multi-wallet farming/i);
    expect(hit?.similarity).toBeGreaterThanOrEqual(0.5);
  });

  it("flags a reordered paraphrase (moving clauses around does not evade it)", () => {
    const reordered =
      "The get started button works and I confirmed the three plan tiers are visible after I completed the signup flow at the pricing page.";
    expect(findNearDuplicate({ note: reordered, contentSha256: null }, [{ note: ORIGINAL, contentSha256: null }])).not.toBeNull();
  });

  it("does NOT flag two honest testers describing the same mission in their own words (false-accusation guard)", () => {
    const honest =
      "Signed up with no issues. The pricing page shows three tiers. I clicked get started and it opened the registration form.";
    expect(findNearDuplicate({ note: honest, contentSha256: null }, [{ note: ORIGINAL, contentSha256: null }])).toBeNull();
  });

  it("does NOT flag genuinely different work on the same campaign", () => {
    const different =
      "I tried the mobile view. The nav collapses into a hamburger and the hero image loads fine on a small screen.";
    expect(findNearDuplicate({ note: different, contentSha256: null }, [{ note: ORIGINAL, contentSha256: null }])).toBeNull();
  });

  it("skips short notes (too few shingles for a stable score) — only exact-match applies there", () => {
    expect(findNearDuplicate({ note: "signup works fine ok", contentSha256: null }, [{ note: "signup works fine ok", contentSha256: null }])).toBeNull();
  });

  it("returns the STRONGEST match when several priors are similar", () => {
    const hit = findNearDuplicate({ note: ORIGINAL, contentSha256: null }, [
      { note: "totally unrelated content about a mobile hamburger menu and hero image loading", contentSha256: null },
      { note: ORIGINAL, contentSha256: null }, // verbatim → 1.0
    ]);
    expect(hit?.similarity).toBe(1);
  });

  it("shingleSet + jaccard: identical text → 1.0, disjoint text → 0", () => {
    expect(jaccard(shingleSet("the quick brown fox jumps"), shingleSet("the quick brown fox jumps"))).toBe(1);
    expect(jaccard(shingleSet("the quick brown fox jumps"), shingleSet("nothing whatsoever alike distinct words here"))).toBe(0);
  });
});
