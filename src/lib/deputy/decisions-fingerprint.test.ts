import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { missions } from "@/lib/db/schema";
import { createSubmission, getDecisionBySubmission, listSubmissionsForDedup } from "@/lib/db/campaigns";
import { seedV2Campaign } from "@/lib/campaigns/campaign-v2.fixture";
import { ensureDecision } from "./decisions";
import { findCopiedArtifact } from "./dedup";
import { NEAR_DUP_THRESHOLD } from "./dedup";

/**
 * THE JOIN, against the real database: an artifact_url deliverable is verified by the real
 * work-proof lane (fetch stubbed), the decision row stores the fingerprint, the dedup query returns
 * it, and a marker-swapped copy from a second wallet is recognised. Every piece has its own unit
 * test; this is the one that proves they are wired to each other. No model is reached: every
 * non-artifact host is refused by the stub, so the brain degrades to its heuristic (never pays).
 */
const A = "0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6";
const B = "0x9a8B7c6D5e4F3a2B1c0D9e8F7a6B5c4D3e2F1a0B";
const page = (w: string, tail = "") =>
  `<html><body><h1>API write-up</h1><p>Written for the Sage gig by ${w}. Bearer authentication, the campaigns list, the submit endpoint with an evidence link and a note, the proof endpoint keyed by transaction hash, per-wallet daily rate limits, error codes with a public detail line, and examples for curl and browser fetch.${tail}</p><p>Marker: ${w}</p></body></html>`;

let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = {};
  for (const k of ["LLM_API_KEY", "COMMONSTACK_API_KEY", "PAYOUT_API_KEY", "PAYOUT_BASE_URL", "PAYOUT_MODEL", "GITHUB_TOKEN"]) { saved[k] = process.env[k]; delete process.env[k]; }
  vi.stubGlobal("fetch", (async (input: string | URL | Request) => {
    const u = String(input);
    if (u.startsWith("https://api.github.com/")) return new Response("{}", { status: 403 }); // rate-limited → no provenance signal
    if (u.startsWith("https://github.com/one/")) return new Response(page(A), { status: 200, headers: { "content-type": "text/html" } });
    if (u.startsWith("https://github.com/two/")) return new Response(page(B, " Minor wording change."), { status: 200, headers: { "content-type": "text/html" } });
    throw new Error(`unexpected fetch in test: ${u}`);
  }) as unknown as typeof fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe("copied deliverable — wired end to end through the real decision path and database", () => {
  it("stores the honest fingerprint, then recognises the marker-swapped copy from a second wallet", async () => {
    const f = seedV2Campaign();
    db.update(missions)
      // the decision path binds only to a LOCKED, targetable mission — the fixture's rows carry neither a
      // target surface nor a contract, so both are set BEFORE any submission captures its spec digest
      .set({
        targetSurface: "https://github.com/",
        objective: "Publish a public API write-up on GitHub, marked with your wallet.",
        instructions: "1. Create a public repository. 2. Write the API guide in its README. 3. Put your wallet address on the page. 4. Submit the repository link.",
        criteria: ["The README documents authentication, campaigns, submit and proof.", "The page carries the submitter's wallet address."],
        evidenceRequirements: "The public repository URL.",
        evidenceList: ["The public repository URL."],
        verificationContract: { kind: "artifact_url", allowedHosts: ["github.com"], markerKind: "wallet" },
      })
      .where(eq(missions.id, f.mission.id))
      .run();
    const a = createSubmission({ campaignId: f.campaign.id, wallet: A, missionIdHash: f.mission.missionIdHash, evidenceUrl: "https://github.com/one/api-writeup", note: "my write-up" });
    const b = createSubmission({ campaignId: f.campaign.id, wallet: B, missionIdHash: f.mission.missionIdHash, evidenceUrl: "https://github.com/two/api-writeup", note: "here is my own version" });
    if (!a.ok || !b.ok) throw new Error("fixture submissions failed");

    await ensureDecision(a.submission.id);
    const rowA = getDecisionBySubmission(a.submission.id);
    expect(rowA?.artifactFingerprint).toBeTruthy();
    expect(rowA?.engine).not.toBe("llm"); // no model was reached: the row is a heuristic receipt, which the gate never auto-pays

    await ensureDecision(b.submission.id);
    const rowB = getDecisionBySubmission(b.submission.id);
    expect(rowB?.artifactFingerprint).toBeTruthy();

    const prior = listSubmissionsForDedup(f.campaign.id, b.submission.id);
    expect(prior.some((p) => p.artifactFingerprint === rowA!.artifactFingerprint)).toBe(true);
    const hit = findCopiedArtifact({ note: b.submission.note, contentSha256: rowB!.contentSha256, artifactFingerprint: rowB!.artifactFingerprint }, prior);
    expect(hit).not.toBeNull();
    expect(hit!.similarity).toBeGreaterThanOrEqual(NEAR_DUP_THRESHOLD);
  });
});
