import "server-only";

import { guardedFetchPage, type Lookup } from "@/lib/net/guarded-fetch";
import { stripHtml } from "@/lib/deputy/evidence";
import { labelFor } from "@/lib/launch/hand-over-text";

/**
 * SAGE READS WHAT IT IS HANDED.
 *
 * A team's work is already written down somewhere: an issue, a doc, a sheet, a post, a video, a thread.
 * On 5 Nov 2026 Sage could read a GitHub issue, a gist, a raw file and a plain web page. It failed every
 * other kind of link a team actually has (Sage Bench · reader):
 * - GitHub repos and docs pages ran into the 250 KB cap;
 * - Medium timed out;
 * - Sheets, YouTube, X, Reddit, Hacker News, Notion and Figma had no reader;
 * - an http:// link was refused outright.
 * Each failure sent the founder back to typing out what the link already said: the chore the hand-over
 * exists to remove.
 *
 * So each kind of link is read the way a careful person would read it: through its own public door when
 * it has one (GitHub's API, Google's export links, oEmbed, Reddit's JSON, HN's API, Bluesky's public API),
 * and through the guarded page read otherwise. Every door is a FIXED public endpoint, or the guarded read
 * with its DNS and redirect checks, so no handed link can steer the server to an internal address.
 *
 * What comes back is text plus the facts a verifier needs (author, title, state). It is UNTRUSTED content:
 * the drafter and the judge read it inside their untrusted fences, and nothing here ever sets money.
 */

export type ReadKind =
  | "github_issue"
  | "github_pull"
  | "github_repo"
  | "github_file"
  | "gist"
  | "google_doc"
  | "google_sheet"
  | "google_slides"
  | "video"
  | "social_post"
  | "forum_post"
  | "design"
  | "page";

export interface PageRead {
  url: string;
  /** how the link is named back to the founder: "github.com/acme/app/issues/42" */
  label: string;
  read: boolean;
  kind: ReadKind;
  /** the readable text, capped; empty when unread */
  text: string;
  title?: string;
  /** the author or account that published it, when the platform says (handle, channel, login) */
  author?: string;
  /** facts a verifier can use, e.g. { merged: "true", state: "closed", durationSeconds: "184" } */
  facts?: Record<string, string>;
  /** why it could not be read, in words a founder can act on */
  reason: string | null;
}

export interface ReaderDeps {
  fetchImpl?: typeof fetch;
  lookup?: Lookup;
  /** headless render for pages that only exist after JavaScript runs (Notion, SPAs). Default: the guarded renderer. */
  render?: ((url: string) => Promise<{ text: string | null }>) | null;
  /** the most text to keep */
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 20_000;
const API_TIMEOUT_MS = 8_000;

/**
 * A SIGN-IN PAGE IS NOT THE WORK. A short page whose words are a login form ("Log in to Linear", "Continue
 * with Google") read as a success, and the drafter would have written a job from a login screen.
 */
export function looksLikeSignInWall(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length < 700 && /\b(log ?in|sign ?in|sign up|continue with (google|github|email|apple)|create (an|your) account|enter your (email|password)|forgot (your )?password)\b/i.test(t);
}

const ok = (url: string, kind: ReadKind, text: string, extra: Partial<PageRead> = {}, maxChars = DEFAULT_MAX_CHARS): PageRead => {
  const t = text.replace(/\n{3,}/g, "\n\n").trim();
  if (t.length < 40) return { url, label: labelFor(url), read: false, kind, text: "", reason: "it had no readable text (it may need a sign-in)", ...extra };
  if ((kind === "page" || kind === "google_doc") && looksLikeSignInWall(t)) return { url, label: labelFor(url), read: false, kind, text: "", reason: "it needs a sign-in", ...extra };
  return { url, label: labelFor(url), read: true, kind, text: t.slice(0, maxChars), reason: null, ...extra };
};
const miss = (url: string, kind: ReadKind, reason: string): PageRead => ({ url, label: labelFor(url), read: false, kind, text: "", reason });

/** A JSON GET against a FIXED public API (never the handed URL itself), with a timeout. */
async function getJson<T>(api: string, deps: ReaderDeps, headers: Record<string, string> = {}): Promise<{ status: number; json: T | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await (deps.fetchImpl ?? fetch)(api, { signal: controller.signal, headers: { accept: "application/json", "user-agent": "Sage (+https://sagepays.xyz)", ...headers } });
    if (!res.ok) return { status: res.status, json: null };
    return { status: res.status, json: (await res.json()) as T };
  } catch {
    return { status: 0, json: null };
  } finally {
    clearTimeout(timer);
  }
}

const ghHeaders = (): Record<string, string> => ({
  accept: "application/vnd.github+json",
  ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
});

// ───────────────────────────── GitHub ─────────────────────────────

const GH_ITEM = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)/i;
const GH_REPO = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?(?:[?#].*)?$/i;
const GH_BLOB = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/blob\/([^/]+)\/(.+?)(?:[?#].*)?$/i;
const GIST = /^https:\/\/gist\.github\.com\/(?:[\w.-]+\/)?([0-9a-f]{8,})/i;

async function readGithubItem(url: string, m: RegExpExecArray, deps: ReaderDeps): Promise<PageRead> {
  const [, owner, repo, kind, num] = m;
  const kindOf: ReadKind = kind === "pull" ? "github_pull" : "github_issue";
  const issue = await getJson<{ title?: string; body?: string | null; state?: string; labels?: { name?: string }[]; user?: { login?: string }; comments?: number }>(
    `https://api.github.com/repos/${owner}/${repo}/issues/${num}`,
    deps,
    ghHeaders(),
  );
  if (issue.status === 404) return miss(url, kindOf, "the issue wasn't found, or the repository is private");
  if (!issue.json) return miss(url, kindOf, issue.status === 0 ? "GitHub took too long to answer" : "GitHub didn't answer just now");
  const j = issue.json;
  const facts: Record<string, string> = { repo: `${owner}/${repo}`, number: num, state: j.state ?? "" };
  // The acceptance details often live in the comments ("also handle X", "we decided Y"): read the first few.
  const comments = (j.comments ?? 0) > 0
    ? (await getJson<{ body?: string; user?: { login?: string } }[]>(`https://api.github.com/repos/${owner}/${repo}/issues/${num}/comments?per_page=8`, deps, ghHeaders())).json ?? []
    : [];
  if (kindOf === "github_pull") {
    const pr = await getJson<{ merged?: boolean; merged_at?: string | null; base?: { ref?: string }; head?: { repo?: { full_name?: string } }; additions?: number; deletions?: number; changed_files?: number }>(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${num}`,
      deps,
      ghHeaders(),
    );
    if (pr.json) {
      facts.merged = String(!!pr.json.merged);
      if (pr.json.merged_at) facts.mergedAt = pr.json.merged_at;
      if (pr.json.base?.ref) facts.base = pr.json.base.ref;
      if (pr.json.head?.repo?.full_name) facts.headRepo = pr.json.head.repo.full_name;
      facts.changedFiles = String(pr.json.changed_files ?? "");
      facts.additions = String(pr.json.additions ?? "");
      facts.deletions = String(pr.json.deletions ?? "");
    }
  }
  const labels = (j.labels ?? []).map((l) => l.name).filter(Boolean);
  const text = [
    `${kindOf === "github_pull" ? "Pull request" : "Issue"} #${num} in ${owner}/${repo}: ${j.title ?? ""}`,
    j.state ? `State: ${j.state}${facts.merged === "true" ? " (merged)" : ""}` : "",
    labels.length ? `Labels: ${labels.join(", ")}` : "",
    j.user?.login ? `Opened by: ${j.user.login}` : "",
    "",
    j.body ?? "",
    ...(comments.length ? ["", "Comments:", ...comments.map((c) => `- ${c.user?.login ?? "someone"}: ${(c.body ?? "").replace(/\s+/g, " ").slice(0, 600)}`)] : []),
  ].join("\n");
  return ok(url, kindOf, text, { title: j.title, author: j.user?.login, facts }, deps.maxChars);
}

async function readGithubRepo(url: string, owner: string, repo: string, deps: ReaderDeps): Promise<PageRead> {
  const meta = await getJson<{ full_name?: string; description?: string | null; topics?: string[]; stargazers_count?: number; language?: string | null; default_branch?: string; owner?: { login?: string }; created_at?: string; fork?: boolean }>(
    `https://api.github.com/repos/${owner}/${repo}`,
    deps,
    ghHeaders(),
  );
  if (meta.status === 404) return miss(url, "github_repo", "the repository wasn't found, or it is private");
  if (!meta.json) return miss(url, "github_repo", meta.status === 0 ? "GitHub took too long to answer" : "GitHub didn't answer just now");
  const readme = await (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const r = await (deps.fetchImpl ?? fetch)(`https://api.github.com/repos/${owner}/${repo}/readme`, {
        signal: controller.signal,
        headers: { ...ghHeaders(), accept: "application/vnd.github.raw", "user-agent": "Sage (+https://sagepays.xyz)" },
      });
      return r.ok ? (await r.text()).slice(0, 30_000) : "";
    } catch {
      return "";
    } finally {
      clearTimeout(timer);
    }
  })();
  const m = meta.json;
  const text = [
    `Repository ${m.full_name ?? `${owner}/${repo}`}${m.description ? `: ${m.description}` : ""}`,
    m.language ? `Language: ${m.language}` : "",
    m.topics?.length ? `Topics: ${m.topics.join(", ")}` : "",
    "",
    readme,
  ].join("\n");
  return ok(url, "github_repo", text, {
    title: m.full_name,
    author: m.owner?.login,
    facts: { repo: m.full_name ?? `${owner}/${repo}`, createdAt: m.created_at ?? "", fork: String(!!m.fork), defaultBranch: m.default_branch ?? "" },
  }, deps.maxChars);
}

async function readGithubBlob(url: string, m: RegExpExecArray, deps: ReaderDeps): Promise<PageRead> {
  const [, owner, repo, ref, path] = m;
  const raw = await guardedFetchPage(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`, { fetchImpl: deps.fetchImpl, lookup: deps.lookup, maxBytes: 2 * 1024 * 1024, truncate: true });
  if (!raw.ok) return miss(url, "github_file", raw.status === 404 ? "the file wasn't found, or the repository is private" : "GitHub didn't answer just now");
  return ok(url, "github_file", `File ${path} in ${owner}/${repo}@${ref}\n\n${raw.body}`, { title: path, facts: { repo: `${owner}/${repo}`, ref, path } }, deps.maxChars);
}

async function readGist(url: string, id: string, deps: ReaderDeps): Promise<PageRead> {
  const g = await getJson<{ description?: string | null; owner?: { login?: string }; files?: Record<string, { filename?: string; content?: string }> }>(`https://api.github.com/gists/${id}`, deps, ghHeaders());
  if (!g.json) return miss(url, "gist", g.status === 404 ? "the gist wasn't found" : "GitHub didn't answer just now");
  const files = Object.values(g.json.files ?? {});
  const text = [g.json.description ?? "", ...files.map((f) => `--- ${f.filename ?? "file"}\n${(f.content ?? "").slice(0, 12_000)}`)].join("\n\n");
  return ok(url, "gist", text, { title: g.json.description ?? undefined, author: g.json.owner?.login }, deps.maxChars);
}

// ───────────────────────────── Google ─────────────────────────────

const G_DOC = /^https:\/\/docs\.google\.com\/document\/d\/([\w-]+)/i;
const G_SHEET = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)(?:.*?[#&?]gid=(\d+))?/i;
const G_SLIDES = /^https:\/\/docs\.google\.com\/presentation\/d\/([\w-]+)/i;

async function readGoogle(url: string, kind: ReadKind, exportUrl: string, deps: ReaderDeps): Promise<PageRead> {
  const page = await guardedFetchPage(exportUrl, { fetchImpl: deps.fetchImpl, lookup: deps.lookup, maxBytes: 4 * 1024 * 1024, truncate: true, timeoutMs: 12_000, maxRedirects: 5 });
  const noun = kind === "google_sheet" ? "sheet" : kind === "google_slides" ? "deck" : "doc";
  if (!page.ok) {
    if (page.status === 401 || page.status === 403 || page.status === 404) return miss(url, kind, `the ${noun} isn't shared with anyone who has the link`);
    return miss(url, kind, page.transient ? `Google took too long to answer` : `the ${noun} couldn't be opened`);
  }
  // A doc nobody shared answers with Google's sign-in page, not an error: that page is not the work.
  if (/accounts\.google\.com|ServiceLogin|to continue to (google )?(docs|sheets|slides)/i.test(page.finalUrl + page.body.slice(0, 2000))) {
    return miss(url, kind, `the ${noun} isn't shared with anyone who has the link`);
  }
  const text = page.contentType.includes("html") ? stripHtml(page.body) : page.body;
  const rows = kind === "google_sheet" ? text.split(/\r?\n/).filter((l) => l.replace(/[,\s"]/g, "").length > 0).length : undefined;
  return ok(url, kind, kind === "google_sheet" ? `Spreadsheet (CSV, ${rows} non-empty rows):\n${text}` : text, rows !== undefined ? { facts: { rows: String(rows) } } : {}, deps.maxChars);
}

// ───────────────────────────── oEmbed: video, social posts, design ─────────────────────────────

interface OEmbed {
  title?: string;
  author_name?: string;
  author_url?: string;
  html?: string;
  duration?: number;
  description?: string;
  provider_name?: string;
}

const OEMBED: { match: RegExp; kind: ReadKind; endpoint: (u: string) => string }[] = [
  { match: /^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch|shorts\/|live\/)|youtu\.be\/)/i, kind: "video", endpoint: (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}` },
  { match: /^https:\/\/(?:www\.)?vimeo\.com\/\d+/i, kind: "video", endpoint: (u) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u)}` },
  { match: /^https:\/\/(?:www\.)?loom\.com\/share\//i, kind: "video", endpoint: (u) => `https://www.loom.com/v1/oembed?url=${encodeURIComponent(u)}` },
  { match: /^https:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/\d+/i, kind: "video", endpoint: (u) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}` },
  { match: /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[\w]+\/status\/\d+/i, kind: "social_post", endpoint: (u) => `https://publish.x.com/oembed?omit_script=1&dnt=1&url=${encodeURIComponent(u)}` },
  { match: /^https:\/\/(?:www\.)?figma\.com\/(?:file|design|proto|community\/file)\//i, kind: "design", endpoint: (u) => `https://www.figma.com/api/oembed?url=${encodeURIComponent(u)}` },
  { match: /^https:\/\/open\.spotify\.com\/(?:episode|show|track)\//i, kind: "video", endpoint: (u) => `https://open.spotify.com/oembed?url=${encodeURIComponent(u)}` },
  { match: /^https:\/\/soundcloud\.com\/[\w-]+\/[\w-]+/i, kind: "video", endpoint: (u) => `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(u)}` },
];

async function readOEmbed(url: string, kind: ReadKind, endpoint: string, deps: ReaderDeps): Promise<PageRead> {
  const o = await getJson<OEmbed>(endpoint, deps);
  if (!o.json) return miss(url, kind, o.status === 404 || o.status === 403 ? "it wasn't found, or it isn't public" : o.status === 0 ? "it took too long to open" : "it couldn't be opened");
  const j = o.json;
  // An X post's text lives in the embed's blockquote; strip the markup and keep the words and links.
  const body = j.html ? stripHtml(j.html.replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, "$2 ($1)")) : "";
  const facts: Record<string, string> = {};
  if (j.provider_name) facts.provider = j.provider_name;
  if (typeof j.duration === "number") facts.durationSeconds = String(Math.round(j.duration));
  if (j.author_url) facts.authorUrl = j.author_url;
  const text = [j.title ? `Title: ${j.title}` : "", j.author_name ? `By: ${j.author_name}` : "", j.description ?? "", body].filter(Boolean).join("\n");
  // oEmbed alone is thin for a video (title + channel). The watch page's description often carries what the
  // worker wrote, including the wallet a job asks them to add, so it is read too when it is a public page.
  let extra = "";
  if (kind === "video" && /youtube\.com|youtu\.be|vimeo\.com/i.test(url)) {
    const page = await guardedFetchPage(url, { fetchImpl: deps.fetchImpl, lookup: deps.lookup, maxBytes: 3 * 1024 * 1024, truncate: true, timeoutMs: 10_000 });
    const desc = page.ok ? /<meta[^>]+(?:name|property)="(?:og:)?description"[^>]+content="([^"]*)"/i.exec(page.body)?.[1] : undefined;
    const longDesc = page.ok ? /"shortDescription":"((?:[^"\\]|\\.)*)"/.exec(page.body)?.[1] : undefined;
    extra = (longDesc ? JSON.parse(`"${longDesc}"`) : desc ? decodeEntities(desc) : "") as string;
  }
  return ok(url, kind, [text, extra ? `Description: ${extra}` : ""].filter(Boolean).join("\n"), { title: j.title, author: j.author_name, facts }, deps.maxChars);
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

// ───────────────────────────── X posts ─────────────────────────────

const X_POST = /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([\w]+)\/status\/(\d+)/i;

/**
 * An X post through X's own embed data: the full text, the account that posted it, and WHEN. The time
 * is what lets a job say "posted after the job went live". oEmbed (title + author only) is the fallback.
 * X itself is a sign-in wall to a plain read, which is why posts on X were banned as proof until now.
 */
async function readXPost(url: string, id: string, deps: ReaderDeps): Promise<PageRead> {
  const t = await getJson<{ text?: string; created_at?: string; user?: { screen_name?: string; name?: string }; favorite_count?: number; entities?: { urls?: { expanded_url?: string }[] } }>(
    `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=a`,
    deps,
  );
  if (t.json?.text) {
    const links = (t.json.entities?.urls ?? []).map((u) => u.expanded_url).filter(Boolean);
    const text = [`Post on X by @${t.json.user?.screen_name ?? "unknown"}${t.json.user?.name ? ` (${t.json.user.name})` : ""}:`, t.json.text, ...(links.length ? [`Links: ${links.join(" ")}`] : [])].join("\n");
    return ok(url, "social_post", text.length >= 40 ? text : `${text}\n(post on X)`, {
      author: t.json.user?.screen_name,
      facts: { ...(t.json.created_at ? { createdAt: t.json.created_at } : {}), ...(t.json.user?.screen_name ? { handle: t.json.user.screen_name } : {}) },
    }, deps.maxChars);
  }
  const o = OEMBED.find((e) => e.kind === "social_post" && e.match.test(url));
  return o ? readOEmbed(url, "social_post", o.endpoint(url), deps) : miss(url, "social_post", "it wasn't found, or it isn't public");
}

// ───────────────────────────── Forums and Bluesky ─────────────────────────────

const REDDIT = /^https:\/\/(?:www\.|old\.|np\.)?reddit\.com\/r\/[\w]+\/comments\/[\w]+/i;
const HN = /^https:\/\/news\.ycombinator\.com\/item\?id=(\d+)/i;
const BSKY = /^https:\/\/bsky\.app\/profile\/([^/]+)\/post\/([\w]+)/i;

async function readReddit(url: string, deps: ReaderDeps): Promise<PageRead> {
  const api = `${url.split(/[?#]/)[0].replace(/\/$/, "").replace(/^https:\/\/(?:old\.|np\.)?reddit\.com/i, "https://www.reddit.com")}.json?limit=8`;
  type Listing = { data?: { children?: { data?: { title?: string; selftext?: string; author?: string; body?: string; subreddit?: string; score?: number } }[] } };
  const r = await getJson<Listing[]>(api, deps);
  if (!r.json || !Array.isArray(r.json)) {
    // Reddit refuses its JSON to most servers now; its oEmbed still answers with the title and the author.
    const o = await getJson<OEmbed>(`https://www.reddit.com/oembed?url=${encodeURIComponent(url)}`, deps);
    if (o.json?.html) {
      const body = stripHtml(o.json.html.replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, "$2"));
      return ok(url, "forum_post", `Reddit post: ${body}${o.json.author_name ? `\nBy: u/${o.json.author_name}` : ""}`, { author: o.json.author_name }, deps.maxChars);
    }
    return miss(url, "forum_post", r.status === 403 || r.status === 429 ? "Reddit refused to show it to Sage just now" : "it couldn't be opened");
  }
  const post = r.json[0]?.data?.children?.[0]?.data;
  const comments = (r.json[1]?.data?.children ?? []).map((c) => c.data).filter((c) => c?.body).slice(0, 6);
  const text = [post?.title ? `Post in r/${post.subreddit}: ${post.title}` : "", post?.author ? `By: u/${post.author}` : "", "", post?.selftext ?? "", ...(comments.length ? ["", "Comments:", ...comments.map((c) => `- u/${c?.author}: ${(c?.body ?? "").replace(/\s+/g, " ").slice(0, 500)}`)] : [])].join("\n");
  return ok(url, "forum_post", text, { title: post?.title, author: post?.author }, deps.maxChars);
}

async function readHackerNews(url: string, id: string, deps: ReaderDeps): Promise<PageRead> {
  type Item = { title?: string; text?: string | null; author?: string; url?: string | null; children?: Item[] };
  const r = await getJson<Item>(`https://hn.algolia.com/api/v1/items/${id}`, deps);
  if (!r.json) return miss(url, "forum_post", "Hacker News didn't answer just now");
  const j = r.json;
  const kids = (j.children ?? []).filter((k) => k.text).slice(0, 8);
  const text = [j.title ? `Hacker News: ${j.title}` : "", j.author ? `By: ${j.author}` : "", j.url ? `Link: ${j.url}` : "", j.text ? stripHtml(j.text) : "", ...(kids.length ? ["", "Comments:", ...kids.map((k) => `- ${k.author}: ${stripHtml(k.text ?? "").slice(0, 500)}`)] : [])].join("\n");
  return ok(url, "forum_post", text, { title: j.title, author: j.author }, deps.maxChars);
}

async function readBluesky(url: string, handle: string, rkey: string, deps: ReaderDeps): Promise<PageRead> {
  const did = handle.startsWith("did:")
    ? handle
    : (await getJson<{ did?: string }>(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`, deps)).json?.did;
  if (!did) return miss(url, "social_post", "that Bluesky account wasn't found");
  const t = await getJson<{ thread?: { post?: { record?: { text?: string; createdAt?: string }; author?: { handle?: string; displayName?: string } } } }>(
    `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?depth=0&uri=${encodeURIComponent(`at://${did}/app.bsky.feed.post/${rkey}`)}`,
    deps,
  );
  const p = t.json?.thread?.post;
  if (!p?.record?.text) return miss(url, "social_post", "that post wasn't found, or it isn't public");
  return ok(url, "social_post", `Bluesky post by @${p.author?.handle ?? handle}${p.author?.displayName ? ` (${p.author.displayName})` : ""}:\n${p.record.text}`, {
    author: p.author?.handle ?? handle,
    facts: p.record.createdAt ? { createdAt: p.record.createdAt } : undefined,
  }, Math.max(40, deps.maxChars ?? DEFAULT_MAX_CHARS));
}

// ───────────────────────────── any other page ─────────────────────────────

async function readGeneric(url: string, deps: ReaderDeps): Promise<PageRead> {
  // Modern pages are heavy: a docs page or a GitHub view is often well over 250 KB of HTML. The guarded read
  // keeps the head of a large page instead of refusing it.
  const page = await guardedFetchPage(url, { fetchImpl: deps.fetchImpl, lookup: deps.lookup, maxBytes: 4 * 1024 * 1024, truncate: true, timeoutMs: 12_000 });
  if (!page.ok && page.status === 0) return miss(url, "page", page.transient ? (page.failReason === "timeout" ? "it took too long to open" : "it couldn't be reached") : "it isn't a public address");
  if (page.status === 401 || page.status === 403) return renderOr(url, deps, "it needs a sign-in");
  if (page.status === 404 || page.status === 410) return miss(url, "page", "the page wasn't found");
  if (!page.ok) return renderOr(url, deps, "it couldn't be opened");
  const ctype = page.contentType;
  if (ctype.includes("pdf")) return miss(url, "page", "it's a PDF, which Sage can't read yet: paste its text, or link a doc");
  if (/^(image|video|audio)\//.test(ctype)) return miss(url, "page", "it's a media file, not a page: link the page it's on");
  const title = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(page.body)?.[1]?.trim();
  const text = ctype.includes("html") ? stripHtml(page.body) : page.body;
  const read = ok(url, "page", [title ? `Title: ${decodeEntities(title)}` : "", text].filter(Boolean).join("\n"), title ? { title: decodeEntities(title) } : {}, deps.maxChars);
  // A page that only exists after JavaScript runs (Notion, Linear, most SPAs) is an empty shell to a plain
  // read. Read it in the guarded headless browser when that's the case.
  if (!read.read || read.text.length < 400) return renderOr(url, deps, read.reason ?? "it had no readable text (it may need a sign-in)", read.read ? read : null);
  return read;
}

async function renderOr(url: string, deps: ReaderDeps, reason: string, fallback: PageRead | null = null): Promise<PageRead> {
  if (deps.render === null) return fallback ?? miss(url, "page", reason);
  try {
    const render = deps.render ?? (async (u: string) => {
      const { renderEvidence } = await import("@/lib/deputy/evidence-render");
      const r = await renderEvidence(u, undefined, "patient");
      return { text: r.text };
    });
    const r = await render(url);
    const rendered = r.text ? ok(url, "page", r.text, {}, deps.maxChars) : null;
    if (rendered?.read && rendered.text.length > (fallback?.text.length ?? 0)) return rendered;
  } catch {
    /* the plain read stands */
  }
  return fallback ?? miss(url, "page", reason);
}

/**
 * Read one link. Never throws. An http:// link is read as https:// (the same page on every site that
 * matters), because refusing "http" sent a founder back to retype a link that was fine.
 */
export async function readPage(rawUrl: string, deps: ReaderDeps = {}): Promise<PageRead> {
  let url = rawUrl.trim().replace(/[)\].,;!?]+$/, "");
  if (/^http:\/\//i.test(url)) url = `https://${url.slice(7)}`;
  try {
    const gh = GH_ITEM.exec(url);
    if (gh) return await readGithubItem(url, gh, deps);
    const blob = GH_BLOB.exec(url);
    if (blob) return await readGithubBlob(url, blob, deps);
    const gist = GIST.exec(url);
    if (gist) return await readGist(url, gist[1], deps);
    const repo = GH_REPO.exec(url);
    if (repo && !["orgs", "settings", "marketplace", "topics", "sponsors", "features", "about"].includes(repo[1].toLowerCase())) return await readGithubRepo(url, repo[1], repo[2], deps);
    const doc = G_DOC.exec(url);
    if (doc) return await readGoogle(url, "google_doc", `https://docs.google.com/document/d/${doc[1]}/export?format=txt`, deps);
    const sheet = G_SHEET.exec(url);
    if (sheet) return await readGoogle(url, "google_sheet", `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=csv${sheet[2] ? `&gid=${sheet[2]}` : ""}`, deps);
    const slides = G_SLIDES.exec(url);
    if (slides) return await readGoogle(url, "google_slides", `https://docs.google.com/presentation/d/${slides[1]}/export/txt`, deps);
    const xPost = X_POST.exec(url);
    if (xPost) return await readXPost(url, xPost[2], deps);
    for (const o of OEMBED) if (o.match.test(url)) return await readOEmbed(url, o.kind, o.endpoint(url), deps);
    if (REDDIT.test(url)) return await readReddit(url, deps);
    const hn = HN.exec(url);
    if (hn) return await readHackerNews(url, hn[1], deps);
    const bsky = BSKY.exec(url);
    if (bsky) return await readBluesky(url, bsky[1], bsky[2], deps);
    return await readGeneric(url, deps);
  } catch {
    return miss(url, "page", "it couldn't be opened");
  }
}
