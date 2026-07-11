import { describe, expect, it } from "vitest";
import { findDuplicate, normalizeNote } from "./dedup";

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
