import { describe, expect, it } from "vitest";
import { evidenceDedupeKey } from "./campaigns";

/**
 * EVIDENCE UNIQUENESS APPLIES TO EVIDENCE THAT DISTINGUISHES ONE TESTER FROM ANOTHER.
 *
 * The index was unique(campaign_id, evidence_url): one link per campaign, across every wallet.
 * That is right when the link is something the TESTER MADE — a page they published, an artifact
 * carrying their wallet — because reusing one of those across wallets is how a Sybil cluster works.
 *
 * It is wrong when the mission's own target IS the link. "Land on this contract page and report
 * what you see" sends every honest tester to the SAME url. REPORTED live: the second wallet on a
 * two-slot mission was refused for agreeing with the first, so the slot could not be taken at all.
 *
 * A null key means "distinguishes nobody" — SQLite permits many nulls in a unique index.
 */

const TARGET = "https://starkscan.co/contract/0x10398fe631af9ab2311840432d507bf7ef4b959ae967f1507928f5afe888a99";

describe("which evidence has to be unique", () => {
  it("does NOT dedupe a link that is the mission's own target", () => {
    expect(evidenceDedupeKey("c1", TARGET, TARGET)).toBeNull();
  });

  it("still dedupes an artifact the tester made", () => {
    // This is the Sybil case the index exists for: one proof, many wallets.
    expect(evidenceDedupeKey("c1", "https://paste.rs/abc", TARGET)).toBe("c1|https://paste.rs/abc");
  });

  it("scopes uniqueness to the campaign, so two campaigns can use the same artifact", () => {
    expect(evidenceDedupeKey("c1", "https://paste.rs/abc", null)).not.toBe(
      evidenceDedupeKey("c2", "https://paste.rs/abc", null),
    );
  });

  it("compares target and evidence as URLS, not as strings", () => {
    // A trailing slash is the same page; treating it as a different one would hand the second
    // tester the same refusal by another route.
    expect(evidenceDedupeKey("c1", `${TARGET}/`, TARGET)).toBeNull();
    // The HOST is case-insensitive, so this is still the target.
    expect(evidenceDedupeKey("c1", TARGET.replace("starkscan.co", "StarkScan.CO"), TARGET)).toBeNull();
  });

  it("does not fold PATH casing away — a url path is case-sensitive", () => {
    // Tempting, because a hex address reads the same either way. But /Contract/ and /contract/ are
    // different paths on the web generally, and quietly equating them would let a crafted link
    // pass as the mission's target on some other product.
    expect(evidenceDedupeKey("c1", TARGET.replace("/contract/", "/Contract/"), TARGET)).not.toBeNull();
  });

  it("does not treat a DIFFERENT page on the same host as the target", () => {
    expect(evidenceDedupeKey("c1", "https://starkscan.co/contract/0xdead", TARGET)).not.toBeNull();
  });

  it("dedupes normally when the mission has no target surface", () => {
    expect(evidenceDedupeKey("c1", "https://example.com/proof", null)).toBe("c1|https://example.com/proof");
  });

  it("is null when there is no evidence link at all", () => {
    // An observation-only submission carries no link; many of those must coexist.
    expect(evidenceDedupeKey("c1", null, TARGET)).toBeNull();
    expect(evidenceDedupeKey("c1", "   ", TARGET)).toBeNull();
  });
});
