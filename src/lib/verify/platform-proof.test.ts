import { describe, expect, it, vi } from "vitest";
import { verifyArtifactUrl } from "./verifiers";
import type { ArtifactUrlContract } from "./contract";
import { fetchEvidence } from "@/lib/deputy/evidence";

/**
 * PLATFORM PROOFS — the proof real work actually comes in (Sage Bench, 200 scenarios: 56 docs or sheets,
 * 17 merged PRs, 13 videos, 10 posts). A platform link is read through its platform's public door, the
 * worker's wallet binds it to them, and the platform's own facts are checked before any model reads it.
 */
const W = "0x1234567890abcdef1234567890abcdef12345678";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const text = (b: string, type = "text/plain") => new Response(b, { status: 200, headers: { "content-type": type } });
const artifact = (over: Partial<ArtifactUrlContract>): ArtifactUrlContract => ({ kind: "artifact_url", allowedHosts: [], markerKind: "wallet", ...over });
const lookup = async () => [{ address: "93.184.216.34", family: 4 }];

function githubPr(merged: boolean, body: string) {
  return vi.fn(async (u: string) => {
    if (u.includes("/pulls/")) return json({ merged, merged_at: merged ? "2026-11-06T10:00:00Z" : null, base: { ref: "main" } });
    if (u.endsWith("/comments?per_page=8")) return json([]);
    return json({ title: "Fix the PDF upload crash", body, state: merged ? "closed" : "open", user: { login: "worker" }, comments: 0 });
  }) as unknown as typeof fetch;
}

describe("a merged pull request into the founder's repository", () => {
  const c = artifact({ allowedHosts: ["github.com"], repo: "acme/app", prMerged: true });

  it("pays when it is merged into the named repo and carries the worker's wallet", async () => {
    const r = await verifyArtifactUrl(c, "https://github.com/acme/app/pull/77", W, { fetchImpl: githubPr(true, `Fixes #42.\n\nPayout wallet: ${W}`) });
    expect(r.verified).toBe(true);
  });

  it("waits for the merge: an open PR is not yet paid, and says so", async () => {
    const r = await verifyArtifactUrl(c, "https://github.com/acme/app/pull/77", W, { fetchImpl: githubPr(false, `Payout wallet: ${W}`) });
    expect(r.verified).toBe(false);
    expect(r.publicDetail).toMatch(/isn't merged yet/);
  });

  it("refuses a PR in another repository", async () => {
    const r = await verifyArtifactUrl(c, "https://github.com/someone/fork/pull/3", W, { fetchImpl: githubPr(true, `Payout wallet: ${W}`) });
    expect(r.verified).toBe(false);
    expect(r.publicDetail).toMatch(/isn't in acme\/app/);
  });

  it("refuses a merged PR that doesn't carry the worker's wallet: it isn't provably theirs", async () => {
    const r = await verifyArtifactUrl(c, "https://github.com/acme/app/pull/77", W, { fetchImpl: githubPr(true, "Fixes #42.") });
    expect(r.verified).toBe(false);
    expect(r.detail).toBe("marker absent");
  });
});

describe("a Google Sheet with rows", () => {
  const csv = (n: number) => ["name,company,email", ...Array.from({ length: n }, (_, i) => `Lead ${i},Co ${i},lead${i}@co${i}.com`), `wallet,${W},`].join("\n");
  const c = artifact({ allowedHosts: ["docs.google.com"], minRows: 50 });

  it("pays when the sheet is shared and has the rows asked for", async () => {
    const r = await verifyArtifactUrl(c, "https://docs.google.com/spreadsheets/d/1abcDEF/edit#gid=0", W, { fetchImpl: (async () => text(csv(55), "text/csv")) as unknown as typeof fetch, readImpl: undefined });
    expect(r.verified).toBe(true);
  });

  it("names the shortfall", async () => {
    const r = await verifyArtifactUrl(c, "https://docs.google.com/spreadsheets/d/1abcDEF/edit", W, { fetchImpl: (async () => text(csv(20), "text/csv")) as unknown as typeof fetch });
    expect(r.verified).toBe(false);
    expect(r.publicDetail).toMatch(/at least 50/);
  });
});

describe("a post on X", () => {
  const c = artifact({ postedAfterStart: true });
  const post = (createdAt: string, body: string) => (async () => json({ text: body, created_at: createdAt, user: { screen_name: "worker" } })) as unknown as typeof fetch;
  const JOB_STARTED = Math.floor(Date.parse("2026-11-05T12:00:00Z") / 1000);

  it("pays for a post made for this job that carries the wallet", async () => {
    const r = await verifyArtifactUrl(c, "https://x.com/worker/status/1855000000000000001", W, { fetchImpl: post("2026-11-05T15:00:00Z", `Tried Acme's new invoicing flow, here's my thread 🧵 ${W}`), notBefore: JOB_STARTED });
    expect(r.verified).toBe(true);
  });

  it("refuses a post from before the job went live", async () => {
    const r = await verifyArtifactUrl(c, "https://x.com/worker/status/1855000000000000001", W, { fetchImpl: post("2026-10-01T15:00:00Z", `Old thread about Acme ${W} and more words here`), notBefore: JOB_STARTED });
    expect(r.verified).toBe(false);
    expect(r.publicDetail).toMatch(/before this job went live/);
  });
});

describe("a video", () => {
  it("checks a stated minimum length when the platform reports one", async () => {
    const c = artifact({ minDurationSeconds: 120 });
    const fetchImpl = vi.fn(async (u: string) =>
      u.startsWith("https://vimeo.com/api/oembed") ? json({ title: "Acme walkthrough", author_name: "worker", duration: 95, description: `Walkthrough of Acme. Wallet ${W}` }) : text("<html></html>", "text/html"),
    ) as unknown as typeof fetch;
    const r = await verifyArtifactUrl(c, "https://vimeo.com/123456789", W, { fetchImpl });
    expect(r.verified).toBe(false);
    expect(r.publicDetail).toMatch(/runs 95 seconds/);
  });
});

describe("the judge reads platform links through the same door", () => {
  it("a Google Doc reaches the judge as its text, not the editor shell", async () => {
    const r = await fetchEvidence("https://docs.google.com/document/d/1docID/edit", {
      fetchImpl: (async () => text(`Spanish onboarding guide.\n\nBienvenido a Acme. ${"Esta es la guía. ".repeat(20)}\nWallet: ${W}`)) as unknown as typeof fetch,
      lookup,
    });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("platform");
    expect(r.text).toContain("Bienvenido a Acme");
  });

  it("a pull request reaches the judge with its merge state and the change itself", async () => {
    const fetchImpl = vi.fn(async (u: string) => {
      if (u.includes("/pulls/77/files")) return json([{ filename: "src/upload.ts", additions: 12, deletions: 3, patch: "@@ -1 +1 @@\n-read whole file\n+stream the upload" }]);
      if (u.includes("/pulls/")) return json({ merged: true, merged_at: "2026-11-06T10:00:00Z", base: { ref: "main" } });
      if (u.endsWith("/comments?per_page=8")) return json([]);
      return json({ title: "Stream PDF uploads", body: `Fixes #42. ${W}`, state: "closed", user: { login: "worker" }, comments: 0 });
    }) as unknown as typeof fetch;
    const r = await fetchEvidence("https://github.com/acme/app/pull/77", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("platform");
    expect(r.text).toMatch(/merged: true/);
    expect(r.text).toContain("stream the upload");
  });

  it("a GitHub repository or file page stays on the plain read (GitHub's API is spent where a check needs it)", async () => {
    const r = await fetchEvidence("https://github.com/acme/app/blob/main/README.md", { fetchImpl: (async () => text(`<html><p>Acme app readme, wallet ${W}</p></html>`, "text/html")) as unknown as typeof fetch, lookup });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("static");
  });
});
