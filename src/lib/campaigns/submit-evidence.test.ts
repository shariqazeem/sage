import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEvidenceClaim, postEvidence, signEvmEvidenceClaim, type EvidenceInput } from "./submit-evidence";
import { computeEvidenceDigest, EVIDENCE_CLAIM_TTL_SECONDS } from "./evidence-claim";

/**
 * THE ONE SUBMIT PATH, shared by the mission board and the test page. What is signed and what is sent
 * must be the same evidence, and the server's two "sign in first" answers must reach the page as what
 * they are, so it can open the right door instead of printing an error.
 */
const input: EvidenceInput = {
  campaignId: "launch-acme",
  campaignIdHash: `0x${"a".repeat(64)}`,
  chainId: 1088,
  mission: { missionKey: "signup", missionIdHash: `0x${"b".repeat(64)}`, specDigest: null },
  evidenceUrl: "https://acme.example/p/1",
  note: "I signed up and the code email took two minutes.",
  tester: "0x3A60aF43c67dd9D552f180d30d9A042948078341",
};

afterEach(() => vi.unstubAllGlobals());

describe("buildEvidenceClaim", () => {
  it("stamps the campaign, the mission, the wallet and the digest of exactly what is sent", () => {
    const claim = buildEvidenceClaim(input, 1_800_000_000);
    expect(claim.publicCampaignId).toBe("launch-acme");
    expect(claim.missionKey).toBe("signup");
    expect(claim.tester).toBe(input.tester);
    expect(claim.chainId).toBe(1088);
    expect(claim.evidenceDigest).toBe(computeEvidenceDigest({ evidenceUrl: input.evidenceUrl, note: input.note }));
    expect(claim.missionSpecDigest).toBe(`0x${"0".repeat(64)}`);
    expect(claim.expiry - claim.issuedAt).toBe(EVIDENCE_CLAIM_TTL_SECONDS);
  });

  it("a changed word is a different digest", () => {
    const a = buildEvidenceClaim(input, 1_800_000_000);
    const b = buildEvidenceClaim({ ...input, note: input.note + "!" }, 1_800_000_000);
    expect(a.evidenceDigest).not.toBe(b.evidenceDigest);
  });
});

describe("signEvmEvidenceClaim", () => {
  const claim = buildEvidenceClaim(input, 1_800_000_000);
  const account = input.tester as `0x${string}`;

  it("only a real decline reads as a decline", async () => {
    const declined = await signEvmEvidenceClaim({ signTypedData: () => Promise.reject(Object.assign(new Error("x"), { code: 4001 })) } as never, account, claim);
    expect(declined).toEqual({ ok: false, error: "You declined the signature. Nothing was submitted." });
    const broke = await signEvmEvidenceClaim({ signTypedData: () => Promise.reject(new Error("chain mismatch")) } as never, account, claim);
    expect(broke.ok === false && broke.error).toContain("chain mismatch");
  });

  it("returns the wallet's signature", async () => {
    const signed = await signEvmEvidenceClaim({ signTypedData: () => Promise.resolve("0xsig") } as never, account, claim);
    expect(signed).toEqual({ ok: true, signature: "0xsig" });
  });
});

describe("postEvidence", () => {
  const claim = buildEvidenceClaim(input, 1_800_000_000);
  const answer = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))));

  it("sends the same evidence and note the claim covers", async () => {
    answer(200, { ok: true });
    expect(await postEvidence(input, claim, "0xsig")).toEqual({ ok: true });
    const [url, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("/api/campaigns/launch-acme/submit");
    const body = JSON.parse(String(init.body)) as { missionKey: string; evidence: string; note: string; signature: string };
    expect(body).toMatchObject({ missionKey: "signup", evidence: input.evidenceUrl, note: input.note, signature: "0xsig" });
  });

  it("carries the door's two answers: a Google or X sign-in, and the World ID step", async () => {
    answer(403, { error: "Sign in with Google or X to take a place in this test.", needsSocialSignIn: true });
    expect(await postEvidence(input, claim, "0xsig")).toEqual({ ok: false, error: "Sign in with Google or X to take a place in this test.", needsVerification: false, needsSocialSignIn: true });
    answer(403, { error: "One check first.", needsVerification: true });
    expect(await postEvidence(input, claim, "0xsig")).toMatchObject({ ok: false, needsVerification: true, needsSocialSignIn: false });
  });
});
