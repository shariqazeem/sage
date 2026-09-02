import { describe, expect, it } from "vitest";
import { findCopiedArtifact, findNearDuplicate, NEAR_DUP_THRESHOLD } from "./dedup";
import { artifactFingerprint } from "./fingerprint";
import { matchArtifact, markerVariants } from "@/lib/verify/verifiers";
import type { ArtifactUrlContract } from "@/lib/verify/contract";

/**
 * The copied-deliverable vector, end to end at the unit level: an honest artifact page verifies and
 * yields a fingerprint; a fork with the marker swapped verifies for the second wallet and yields a
 * near-identical fingerprint; the dedup layer holds it. A genuinely different deliverable does not
 * collide, and a public_url lane (the shared product page) never carries a fingerprint at all.
 */
const A = "0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6";
const B = "0x9a8B7c6D5e4F3a2B1c0D9e8F7a6B5c4D3e2F1a0B";
const contract: ArtifactUrlContract = { kind: "artifact_url", allowedHosts: ["github.com"], markerKind: "wallet" };
const page = (wallet: string, tail = "") =>
  `Sage gig deliverable — API write-up by ${wallet}. This document explains the public API: authentication with a bearer
token, the campaigns endpoint that lists live work, the submit endpoint that takes an evidence link and a note, and the
proof endpoint that returns the settlement receipt for a transaction hash. Rate limits are per wallet per day. Errors
come back as JSON with a code and a public detail line. Examples are given for curl and for fetch in the browser.${tail}
Marker: ${wallet}`;
const other = (wallet: string) =>
  `Write-up for ${wallet}: I documented the SDK instead of the raw endpoints. Install the package, create a client with
your session, call listCampaigns and submitWork; the client retries transient failures and exposes the receipt URL.
I added a section on Starknet claims and a troubleshooting table for the three errors I actually hit while testing.
Marker: ${wallet}`;

describe("copied deliverable across wallets", () => {
  it("the artifact verifier returns a fingerprint for a marked page, and none for a page too short to fingerprint", () => {
    const ok = matchArtifact({ status: 200, finalUrl: "https://github.com/a/repo", bodyText: page(A) }, contract, A);
    expect(ok.verified).toBe(true);
    expect(ok.artifactFingerprint).toBeTruthy();
    const short = matchArtifact({ status: 200, finalUrl: "https://github.com/a/repo", bodyText: `Marker: ${A}` }, contract, A);
    expect(short.verified).toBe(true);
    expect(short.artifactFingerprint).toBeNull();
  });

  it("a fork with the marker swapped is held as copied work; a different deliverable is not", () => {
    const honest = artifactFingerprint(page(A), markerVariants(A));
    const forked = artifactFingerprint(page(B, " Minor edit."), markerVariants(B));
    const different = artifactFingerprint(other(B), markerVariants(B));
    const prior = [{ note: "done", contentSha256: "aa", artifactFingerprint: honest }];
    const hit = findCopiedArtifact({ note: "my write-up", contentSha256: "bb", artifactFingerprint: forked }, prior);
    expect(hit).not.toBeNull();
    expect(hit!.similarity).toBeGreaterThanOrEqual(NEAR_DUP_THRESHOLD);
    expect(hit!.reason).toMatch(/possible copied work/);
    expect(findCopiedArtifact({ note: "my write-up", contentSha256: "cc", artifactFingerprint: different }, prior)).toBeNull();
  });

  it("no fingerprint on either side means no verdict — public_url lanes and legacy rows never collide", () => {
    const honest = artifactFingerprint(page(A), markerVariants(A));
    expect(findCopiedArtifact({ note: "x", contentSha256: null, artifactFingerprint: null }, [{ note: "y", contentSha256: null, artifactFingerprint: honest }])).toBeNull();
    expect(findCopiedArtifact({ note: "x", contentSha256: null, artifactFingerprint: honest }, [{ note: "y", contentSha256: null }])).toBeNull();
    // the report detector is untouched by the new field
    expect(findNearDuplicate({ note: "short", contentSha256: null, artifactFingerprint: honest }, [{ note: "short", contentSha256: null }])).toBeNull();
  });
});
