import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import type { XCredentials } from "./config";

/**
 * THE SMALLEST X CLIENT SAGE NEEDS (API v2, OAuth 1.0a user context).
 *
 * Three calls: create a post, read who the agent account is, read the posts that tagged it. Signed
 * with Node's own HMAC-SHA1, so there is no dependency to audit for a thing that holds the account's
 * keys. Every call returns a typed result and never throws for control flow: a rate limit, a refused
 * duplicate and a dead network are all answers the agent loop decides on.
 *
 * It can only do what is written here. There is no like, follow, repost or DM to call by mistake.
 */

const API = "https://api.x.com";
const TIMEOUT_MS = 8_000;

export type XFailure =
  /** 429: X's own reset time (epoch seconds) says when to ask again */
  | { ok: false; kind: "rate_limited"; resetAt: number; detail: string }
  /** X refused the text because the account already posted it */
  | { ok: false; kind: "duplicate"; detail: string }
  /** 403 for any other reason (a reply the author did not summon, a suspended app) */
  | { ok: false; kind: "forbidden"; detail: string }
  /** 401: the keys are wrong or revoked */
  | { ok: false; kind: "unauthorized"; detail: string }
  /** any other answer from X */
  | { ok: false; kind: "error"; status: number; detail: string }
  /** no answer at all: the request may or may not have reached X */
  | { ok: false; kind: "network"; detail: string };

export type XResult<T> = { ok: true; data: T } | XFailure;

export type XUser = { id: string; username: string; createdAt: string | null };

export type XMentionPost = {
  id: string;
  text: string;
  authorId: string;
  createdAt: string | null;
  conversationId: string | null;
  /** links X expanded for us, in the order they appear */
  urls: string[];
  /** the handles the post mentions, lower case, without the @ */
  mentions: string[];
  /** how the post relates to another: replied_to, quoted, retweeted */
  referenced: { type: string; id: string }[];
};

export type XMentionsPage = { posts: XMentionPost[]; users: XUser[]; newestId: string | null };

export interface XClient {
  createPost(input: { text: string; replyTo?: string }): Promise<XResult<{ id: string }>>;
  me(): Promise<XResult<XUser>>;
  mentions(userId: string, opts?: { sinceId?: string | null; maxResults?: number }): Promise<XResult<XMentionsPage>>;
}

/* ───────────────────────────────────────────────── OAuth 1.0a ───────────── */

/** RFC 3986 percent-encoding, which OAuth requires and `encodeURIComponent` almost is. */
export function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export type OAuthParams = { nonce: string; timestamp: string };

/**
 * The OAuth 1.0a signature for a request (RFC 5849 §3.4): method, base URL and every parameter (query,
 * form and oauth_*), sorted and percent-encoded, signed with HMAC-SHA1. A JSON body is NOT part of it.
 */
export function oauthSignature(input: {
  method: string;
  url: string;
  params: Record<string, string>;
  consumerSecret: string;
  tokenSecret: string;
}): string {
  const pairs = Object.entries(input.params)
    .map(([k, v]) => [percentEncode(k), percentEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  const normalized = pairs.map(([k, v]) => `${k}=${v}`).join("&");
  const base = [input.method.toUpperCase(), percentEncode(input.url), percentEncode(normalized)].join("&");
  const key = `${percentEncode(input.consumerSecret)}&${percentEncode(input.tokenSecret)}`;
  return createHmac("sha1", key).update(base).digest("base64");
}

/** The `Authorization` header for one request. `query` holds the URL's own parameters. */
export function oauthHeader(
  creds: XCredentials,
  method: string,
  url: string,
  query: Record<string, string> = {},
  fixed: OAuthParams = { nonce: randomBytes(16).toString("hex"), timestamp: String(Math.floor(Date.now() / 1000)) },
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: fixed.nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: fixed.timestamp,
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const signature = oauthSignature({
    method,
    url,
    params: { ...query, ...oauth },
    consumerSecret: creds.apiSecret,
    tokenSecret: creds.accessTokenSecret,
  });
  const all = { ...oauth, oauth_signature: signature };
  return `OAuth ${Object.keys(all)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(all[k as keyof typeof all])}"`)
    .join(", ")}`;
}

/* ───────────────────────────────────────────────── the client ───────────── */

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** X's own words for a refusal, trimmed. Never includes a header or anything we sent. */
function detailOf(body: unknown, fallback: string): string {
  if (isRecord(body)) {
    const direct = str(body.detail) ?? str(body.title);
    if (direct) return direct.slice(0, 240);
    if (Array.isArray(body.errors) && isRecord(body.errors[0])) {
      const first = str(body.errors[0].message) ?? str(body.errors[0].detail);
      if (first) return first.slice(0, 240);
    }
  }
  return fallback;
}

function failure(status: number, headers: Headers, body: unknown, nowSec: number): XFailure {
  const detail = detailOf(body, `X answered ${status}`);
  if (status === 429) {
    const reset = Number(headers.get("x-rate-limit-reset"));
    const retryAfter = Number(headers.get("retry-after"));
    const resetAt =
      Number.isFinite(reset) && reset > nowSec
        ? reset
        : Number.isFinite(retryAfter) && retryAfter > 0
          ? nowSec + retryAfter
          : nowSec + 15 * 60; // X's windows are 15 minutes; with no header, wait one out
    return { ok: false, kind: "rate_limited", resetAt, detail };
  }
  if (status === 403 && /duplicate/i.test(detail)) return { ok: false, kind: "duplicate", detail };
  if (status === 403) return { ok: false, kind: "forbidden", detail };
  if (status === 401) return { ok: false, kind: "unauthorized", detail };
  return { ok: false, kind: "error", status, detail };
}

function parseUser(u: unknown): XUser | null {
  if (!isRecord(u)) return null;
  const id = str(u.id);
  const username = str(u.username);
  if (!id || !username) return null;
  return { id, username, createdAt: str(u.created_at) };
}

function parsePost(p: unknown): XMentionPost | null {
  if (!isRecord(p)) return null;
  const id = str(p.id);
  const authorId = str(p.author_id);
  if (!id || !authorId) return null;
  const entities = isRecord(p.entities) ? p.entities : {};
  const urls = (Array.isArray(entities.urls) ? entities.urls : [])
    .map((u) => (isRecord(u) ? (str(u.unwound_url) ?? str(u.expanded_url)) : null))
    .filter((u): u is string => u !== null);
  const mentions = (Array.isArray(entities.mentions) ? entities.mentions : [])
    .map((m) => (isRecord(m) ? str(m.username) : null))
    .filter((m): m is string => m !== null)
    .map((m) => m.toLowerCase());
  const referenced = (Array.isArray(p.referenced_tweets) ? p.referenced_tweets : [])
    .map((r) => (isRecord(r) && str(r.type) && str(r.id) ? { type: String(r.type), id: String(r.id) } : null))
    .filter((r): r is { type: string; id: string } => r !== null);
  return {
    id,
    text: typeof p.text === "string" ? p.text : "",
    authorId,
    createdAt: str(p.created_at),
    conversationId: str(p.conversation_id),
    urls,
    mentions,
    referenced,
  };
}

export function createXClient(creds: XCredentials, fetchImpl: FetchLike = fetch): XClient {
  async function call(method: "GET" | "POST", path: string, query: Record<string, string>, json?: unknown): Promise<XResult<unknown>> {
    const url = `${API}${path}`;
    const qs = Object.keys(query).length
      ? `?${Object.entries(query).map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`).join("&")}`
      : "";
    const nowSec = Math.floor(Date.now() / 1000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${url}${qs}`, {
        method,
        headers: {
          authorization: oauthHeader(creds, method, url, query),
          ...(json === undefined ? {} : { "content-type": "application/json" }),
        },
        body: json === undefined ? undefined : JSON.stringify(json),
        signal: controller.signal,
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) return failure(res.status, res.headers, body, nowSec);
      return { ok: true, data: body };
    } catch (e) {
      // the message of a fetch failure names a host or a timeout, never a credential
      return { ok: false, kind: "network", detail: (e instanceof Error ? e.name : "network error").slice(0, 80) };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async createPost({ text, replyTo }) {
      const r = await call("POST", "/2/tweets", {}, replyTo ? { text, reply: { in_reply_to_tweet_id: replyTo } } : { text });
      if (!r.ok) return r;
      const id = isRecord(r.data) && isRecord(r.data.data) ? str(r.data.data.id) : null;
      // X said yes but named no post: the text is out, so this is a success we cannot link to.
      return { ok: true, data: { id: id ?? "" } };
    },

    async me() {
      const r = await call("GET", "/2/users/me", { "user.fields": "username,created_at" });
      if (!r.ok) return r;
      const user = isRecord(r.data) ? parseUser(r.data.data) : null;
      return user ? { ok: true, data: user } : { ok: false, kind: "error", status: 200, detail: "X named no user" };
    },

    async mentions(userId, opts = {}) {
      const query: Record<string, string> = {
        max_results: String(Math.min(100, Math.max(5, opts.maxResults ?? 10))),
        expansions: "author_id",
        "tweet.fields": "created_at,entities,conversation_id,referenced_tweets",
        "user.fields": "username,created_at",
      };
      if (opts.sinceId) query.since_id = opts.sinceId;
      const r = await call("GET", `/2/users/${encodeURIComponent(userId)}/mentions`, query);
      if (!r.ok) return r;
      const body = isRecord(r.data) ? r.data : {};
      const posts = (Array.isArray(body.data) ? body.data : []).map(parsePost).filter((p): p is XMentionPost => p !== null);
      const includes = isRecord(body.includes) ? body.includes : {};
      const users = (Array.isArray(includes.users) ? includes.users : []).map(parseUser).filter((u): u is XUser => u !== null);
      const meta = isRecord(body.meta) ? body.meta : {};
      return { ok: true, data: { posts, users, newestId: str(meta.newest_id) } };
    },
  };
}
