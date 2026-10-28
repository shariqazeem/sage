import { describe, expect, it, vi } from "vitest";
import { readHandedOver, MAX_SOURCE_CHARS } from "./handed-over";
import type { EvidenceResult } from "@/lib/deputy/evidence";

/**
 * HAND IT TO SAGE: Sage reads the link the founder pasted before it drafts the job. A GitHub issue is read
 * through GitHub's API (the words, not the site around them), a Google Doc as its plain-text export, and
 * any other page with the judge's own fetcher. What it could not read, it says why, in plain words.
 */
const ok = (text: string): EvidenceResult => ({ text, contentSha256: null, fetchedAt: 0, ok: true });
const fail = (failReason: string): EvidenceResult => ({ text: "", contentSha256: null, fetchedAt: 0, ok: false, failReason });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const LONG = "The upload page crashes when a PDF is over 10 MB. Steps: open upload, pick a 12 MB file, press send.";

describe("reading what was handed over", () => {
  it("has nothing to read when there is no link", async () => {
    expect(await readHandedOver("Pay my designer $50 when the landing page is live")).toBeNull();
  });

  it("reads a GitHub issue through GitHub's API: its title, labels and body", async () => {
    const fetchImpl = vi.fn(async () => json({ title: "Crash on large PDFs", body: LONG, state: "open", labels: [{ name: "bug" }] }));
    const r = await readHandedOver("fix https://github.com/acme/app/issues/42 please", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe("https://api.github.com/repos/acme/app/issues/42");
    expect(r).toMatchObject({ url: "https://github.com/acme/app/issues/42", label: "github.com/acme/app/issues/42", read: true, reason: null });
    expect(r?.text).toContain("Issue #42 in acme/app: Crash on large PDFs");
    expect(r?.text).toContain("Labels: bug");
    expect(r?.text).toContain(LONG);
  });

  it("says a private or missing issue plainly", async () => {
    const r = await readHandedOver("https://github.com/acme/secret/issues/7", { fetchImpl: (async () => json({}, 404)) as unknown as typeof fetch });
    expect(r).toMatchObject({ read: false, reason: "the issue wasn't found, or the repository is private" });
  });

  it("reads a Google Doc as its plain-text export, and knows a doc nobody shared", async () => {
    const fetchEvidence = vi.fn(async () => ok(LONG));
    const r = await readHandedOver("https://docs.google.com/document/d/AbC_12-x/edit?usp=sharing", { fetchEvidence });
    expect(fetchEvidence).toHaveBeenCalledWith("https://docs.google.com/document/d/AbC_12-x/export?format=txt");
    expect(r?.read).toBe(true);
    const signIn = await readHandedOver("https://docs.google.com/document/d/AbC/edit", { fetchEvidence: async () => ok("Sign in - Google Accounts. Use your Google Account to continue to Docs. " + "x".repeat(80)) });
    expect(signIn).toMatchObject({ read: false, reason: "the doc isn't shared with anyone who has the link" });
  });

  it("reads any other page with the judge's own fetcher, capped", async () => {
    const fetchEvidence = vi.fn(async () => ok("y".repeat(MAX_SOURCE_CHARS + 500)));
    const r = await readHandedOver("https://acme.com/brief", { fetchEvidence });
    expect(fetchEvidence).toHaveBeenCalledWith("https://acme.com/brief");
    expect(r?.text.length).toBe(MAX_SOURCE_CHARS);
  });

  it("names why it could not read a page, in words a founder uses", async () => {
    const reason = async (failReason: string) => (await readHandedOver("https://acme.com/x", { fetchEvidence: async () => fail(failReason) }))?.reason;
    expect(await reason("blocked url: private address")).toBe("it isn't a public address");
    expect(await reason("timeout")).toBe("it took too long to open");
    expect(await reason("http 403")).toBe("it needs a sign-in");
    expect(await reason("http 404")).toBe("the page wasn't found");
    expect(await reason("fetch error: ECONNRESET")).toBe("it couldn't be opened");
  });

  it("does not count a page with no words as read", async () => {
    const r = await readHandedOver("https://acme.com/app", { fetchEvidence: async () => ok("Loading…") });
    expect(r).toMatchObject({ read: false, reason: "it had no readable text (it may need a sign-in)" });
  });
});
