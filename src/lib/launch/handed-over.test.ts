import { describe, expect, it, vi } from "vitest";
import { readHandedOver, MAX_SOURCE_CHARS } from "./handed-over";
import type { Lookup } from "@/lib/net/guarded-fetch";

/**
 * HAND IT TO SAGE: Sage reads the link the founder pasted before it drafts the job. A GitHub issue is read
 * through GitHub's API (the words, not the site around them), a Google Doc as its plain-text export, and
 * any other page through the guarded read. What it could not read, it says why, in plain words.
 */
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const html = (b: string, status = 200, type = "text/html") => new Response(b, { status, headers: { "content-type": type } });
const LONG = "The upload page crashes when a PDF is over 10 MB. Steps: open upload, pick a 12 MB file, press send.";
const publicDns: Lookup = async () => [{ address: "93.184.216.34", family: 4 }];
const noRender = { render: null } as const;

describe("reading what was handed over", () => {
  it("has nothing to read when there is no link", async () => {
    expect(await readHandedOver("Pay my designer $50 when the landing page is live")).toBeNull();
  });

  it("reads a GitHub issue through GitHub's API: its title, labels, body and comments", async () => {
    const fetchImpl = vi.fn(async (u: string) =>
      u.endsWith("/comments?per_page=8")
        ? json([{ user: { login: "maintainer" }, body: "Also handle files over 50 MB." }])
        : json({ title: "Crash on large PDFs", body: LONG, state: "open", labels: [{ name: "bug" }], comments: 1, user: { login: "reporter" } }),
    );
    const r = await readHandedOver("fix https://github.com/acme/app/issues/42 please", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe("https://api.github.com/repos/acme/app/issues/42");
    expect(r).toMatchObject({ url: "https://github.com/acme/app/issues/42", label: "github.com/acme/app/issues/42", read: true, reason: null, kind: "github_issue" });
    expect(r?.text).toContain("Issue #42 in acme/app: Crash on large PDFs");
    expect(r?.text).toContain("Labels: bug");
    expect(r?.text).toContain(LONG);
    expect(r?.text).toContain("Also handle files over 50 MB.");
  });

  it("says a private or missing issue plainly", async () => {
    const r = await readHandedOver("https://github.com/acme/secret/issues/7", { fetchImpl: (async () => json({}, 404)) as unknown as typeof fetch });
    expect(r).toMatchObject({ read: false, reason: "the issue wasn't found, or the repository is private" });
  });

  it("reads a whole repository as its description and README", async () => {
    const fetchImpl = vi.fn(async (u: string) =>
      u.endsWith("/readme") ? html(`# Acme app\n\n${LONG}`, 200, "text/plain") : json({ full_name: "acme/app", description: "Invoices for small teams", language: "TypeScript" }),
    );
    const r = await readHandedOver("make https://github.com/acme/app better", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toMatchObject({ read: true, kind: "github_repo" });
    expect(r?.text).toContain("Repository acme/app: Invoices for small teams");
    expect(r?.text).toContain(LONG);
  });

  it("reads a Google Doc as its plain-text export, and knows a doc nobody shared", async () => {
    const fetchImpl = vi.fn(async () => html(LONG, 200, "text/plain"));
    const r = await readHandedOver("https://docs.google.com/document/d/AbC_12-x/edit?usp=sharing", { fetchImpl: fetchImpl as unknown as typeof fetch, lookup: publicDns });
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe("https://docs.google.com/document/d/AbC_12-x/export?format=txt");
    expect(r?.read).toBe(true);
    const signIn = await readHandedOver("https://docs.google.com/document/d/AbC/edit", {
      fetchImpl: (async () => html("Sign in - Google Accounts. Use your Google Account to continue to Docs. " + "x".repeat(80))) as unknown as typeof fetch,
      lookup: publicDns,
    });
    expect(signIn).toMatchObject({ read: false, reason: "the doc isn't shared with anyone who has the link" });
  });

  it("reads a Google Sheet as CSV and counts its rows", async () => {
    const csv = ["name,email,company", "Ana,ana@acme.com,Acme", "Bo,bo@beta.io,Beta", "Cy,cy@gamma.dev,Gamma"].join("\n");
    const fetchImpl = vi.fn(async () => html(csv, 200, "text/csv"));
    const r = await readHandedOver("https://docs.google.com/spreadsheets/d/1Sheet_id/edit#gid=0", { fetchImpl: fetchImpl as unknown as typeof fetch, lookup: publicDns });
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe("https://docs.google.com/spreadsheets/d/1Sheet_id/export?format=csv&gid=0");
    expect(r).toMatchObject({ read: true, kind: "google_sheet" });
    expect(r?.text).toContain("4 non-empty rows");
  });

  it("reads any other page through the guarded read, capped", async () => {
    const fetchImpl = vi.fn(async () => html(`<p>${"y".repeat(MAX_SOURCE_CHARS + 500)}</p>`));
    const r = await readHandedOver("https://acme.com/brief", { fetchImpl: fetchImpl as unknown as typeof fetch, lookup: publicDns, ...noRender });
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe("https://acme.com/brief");
    expect(r?.text.length).toBe(MAX_SOURCE_CHARS);
  });

  it("reads an http:// link as https:// instead of refusing it", async () => {
    const fetchImpl = vi.fn(async () => html(`<p>${LONG} ${LONG} ${LONG} ${LONG} ${LONG}</p>`));
    const r = await readHandedOver("http://acme.com/brief", { fetchImpl: fetchImpl as unknown as typeof fetch, lookup: publicDns, ...noRender });
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe("https://acme.com/brief");
    expect(r?.read).toBe(true);
  });

  it("names why it could not read a page, in words a founder uses", async () => {
    const reason = async (res: () => Response | Promise<Response>, lookup: Lookup = publicDns) =>
      (await readHandedOver("https://acme.com/x", { fetchImpl: (async () => res()) as unknown as typeof fetch, lookup, ...noRender }))?.reason;
    expect(await reason(() => html("x"), async () => [{ address: "10.0.0.1", family: 4 }])).toBe("it isn't a public address");
    expect(await reason(() => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); })).toBe("it took too long to open");
    expect(await reason(() => html("no", 403))).toBe("it needs a sign-in");
    expect(await reason(() => html("no", 404))).toBe("the page wasn't found");
    expect(await reason(() => { throw new Error("ECONNRESET"); })).toBe("it couldn't be reached");
    expect(await reason(() => html("%PDF-1.4", 200, "application/pdf"))).toMatch(/PDF/);
  });

  it("does not count a page with no words as read", async () => {
    const r = await readHandedOver("https://acme.com/app", { fetchImpl: (async () => html("<div id=root>Loading…</div>")) as unknown as typeof fetch, lookup: publicDns, ...noRender });
    expect(r).toMatchObject({ read: false, reason: "it had no readable text (it may need a sign-in)" });
  });

  it("reads a page that only exists after JavaScript runs, in the guarded browser", async () => {
    const r = await readHandedOver("https://acme.notion.site/Brief-123", {
      fetchImpl: (async () => html("<div id=notion-app></div>")) as unknown as typeof fetch,
      lookup: publicDns,
      render: async () => ({ text: `Project brief. ${LONG} ${LONG} ${LONG}` }),
    });
    expect(r).toMatchObject({ read: true });
    expect(r?.text).toContain("Project brief.");
  });

  it("reads an X post through X's embed data: the words, the author and when it was posted", async () => {
    const fetchImpl = vi.fn(async () => json({ text: "We're hiring a translator for our docs, reply with your portfolio.", created_at: "2026-11-05T10:00:00.000Z", user: { screen_name: "acme", name: "Acme" } }));
    const r = await readHandedOver("see https://x.com/acme/status/1790000000000000001", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toMatch(/^https:\/\/cdn\.syndication\.twimg\.com\/tweet-result\?id=1790000000000000001/);
    expect(r).toMatchObject({ read: true, kind: "social_post" });
    expect(r?.text).toContain("hiring a translator");
    expect(r?.text).toContain("@acme");
  });

  it("falls back to X's oEmbed when the embed data is missing", async () => {
    const fetchImpl = vi.fn(async (u: string) =>
      u.includes("syndication") ? json({}, 404) : json({ author_name: "Acme", html: `<blockquote><p>We're hiring a translator for our docs, reply with your portfolio.</p>&mdash; Acme (@acme)</blockquote>` }),
    );
    const r = await readHandedOver("see https://x.com/acme/status/1790000000000000001", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(String((fetchImpl.mock.calls[1] as unknown[])[0])).toMatch(/^https:\/\/publish\.x\.com\/oembed\?/);
    expect(r).toMatchObject({ read: true, kind: "social_post" });
  });

  it("never mistakes a login screen for the work", async () => {
    const r = await readHandedOver("https://linear.app/acme/issue/ACM-12", {
      fetchImpl: (async () => html("<h1>Log in to Linear</h1><button>Continue with Google</button><p>Continue with email</p>")) as unknown as typeof fetch,
      lookup: publicDns,
      ...noRender,
    });
    expect(r).toMatchObject({ read: false, reason: "it needs a sign-in" });
  });
});
