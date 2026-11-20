import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createXClient, oauthHeader, oauthSignature, percentEncode } from "./client";

const creds = { apiKey: "ck", apiSecret: "cs", accessToken: "at", accessTokenSecret: "ats" };

function answering(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  };
  return { calls, client: createXClient(creds, fetchImpl) };
}

describe("OAuth 1.0a signing", () => {
  it("matches the published vector in X's own guide to creating a signature", () => {
    // https://docs.x.com/resources/fundamentals/authentication/oauth-1-0a/creating-a-signature
    const signature = oauthSignature({
      method: "POST",
      url: "https://api.twitter.com/1.1/statuses/update.json",
      params: {
        include_entities: "true",
        status: "Hello Ladies + Gentlemen, a signed OAuth request!",
        oauth_consumer_key: "xvz1evFS4wEEPTGEFPHBog",
        oauth_nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: "1318622958",
        oauth_token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        oauth_version: "1.0",
      },
      consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
      tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
    });
    expect(signature).toBe("hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
  });

  it("matches the HMAC-SHA1 example of the OAuth Core 1.0 specification (appendix A.5)", () => {
    const signature = oauthSignature({
      method: "GET",
      url: "http://photos.example.net/photos",
      params: {
        file: "vacation.jpg",
        size: "original",
        oauth_consumer_key: "dpf43f3p2l4k3l03",
        oauth_token: "nnch734d00sl2jdk",
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: "1191242096",
        oauth_nonce: "kllo9940pd9333jh",
        oauth_version: "1.0",
      },
      consumerSecret: "kd94hf93k423kf44",
      tokenSecret: "pfkkdhi9sl3r4s00",
    });
    expect(signature).toBe("tR3+Ty81lMeYAr/Fid0kMTYa/WM=");
  });

  it("percent-encodes the way RFC 3986 asks, including the characters encodeURIComponent leaves", () => {
    expect(percentEncode("Ladies + Gentlemen!")).toBe("Ladies%20%2B%20Gentlemen%21");
    expect(percentEncode("a*b'(c)~-._")).toBe("a%2Ab%27%28c%29~-._");
  });

  it("builds a header that carries the signature and never a secret", () => {
    const header = oauthHeader(creds, "POST", "https://api.x.com/2/tweets", {}, { nonce: "n", timestamp: "1" });
    expect(header.startsWith("OAuth ")).toBe(true);
    expect(header).toContain('oauth_consumer_key="ck"');
    expect(header).toContain("oauth_signature=");
    expect(header).not.toContain("cs");
    expect(header).not.toContain("ats");
  });
});

describe("the client", () => {
  it("creates a post and returns its id", async () => {
    const { client, calls } = answering(201, { data: { id: "190", text: "hello" } });
    const r = await client.createPost({ text: "hello" });
    expect(r).toEqual({ ok: true, data: { id: "190" } });
    expect(calls[0].url).toBe("https://api.x.com/2/tweets");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ text: "hello" });
  });

  it("sends a reply under the post it answers", async () => {
    const { client, calls } = answering(201, { data: { id: "191" } });
    await client.createPost({ text: "hello", replyTo: "77" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ text: "hello", reply: { in_reply_to_tweet_id: "77" } });
  });

  it("answers a 429 with X's own reset time and does not throw", async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    const { client } = answering(429, { title: "Too Many Requests" }, { "x-rate-limit-reset": String(reset) });
    const r = await client.createPost({ text: "hello" });
    expect(r).toMatchObject({ ok: false, kind: "rate_limited", resetAt: reset });
  });

  it("waits a window out when a 429 names no reset", async () => {
    const { client } = answering(429, {});
    const r = await client.createPost({ text: "hello" });
    expect(r.ok).toBe(false);
    if (!r.ok && r.kind === "rate_limited") expect(r.resetAt).toBeGreaterThan(Math.floor(Date.now() / 1000) + 60);
    else throw new Error("expected a rate limit");
  });

  it("tells a refused duplicate apart from any other 403", async () => {
    const dup = await answering(403, { detail: "You are not allowed to create a Tweet with duplicate content." }).client.createPost({ text: "x" });
    expect(dup).toMatchObject({ ok: false, kind: "duplicate" });
    const other = await answering(403, { detail: "Reply to this conversation is not allowed because you have not been mentioned." }).client.createPost({ text: "x", replyTo: "1" });
    expect(other).toMatchObject({ ok: false, kind: "forbidden", detail: expect.stringContaining("not been mentioned") });
  });

  it("returns a typed result when the network fails", async () => {
    const client = createXClient(creds, async () => {
      throw new TypeError("fetch failed");
    });
    expect(await client.createPost({ text: "x" })).toMatchObject({ ok: false, kind: "network" });
  });

  it("reads mentions with the fields the filters need, and signs the query", async () => {
    const { client, calls } = answering(200, {
      data: [
        {
          id: "501",
          text: "@sagepaysai try https://t.co/abc",
          author_id: "42",
          created_at: "2026-11-20T10:00:00.000Z",
          conversation_id: "501",
          entities: { urls: [{ expanded_url: "https://acme.app/" }], mentions: [{ username: "SagePaysAI" }] },
          referenced_tweets: [{ type: "quoted", id: "400" }],
        },
      ],
      includes: { users: [{ id: "42", username: "builder", created_at: "2020-01-01T00:00:00.000Z" }] },
      meta: { newest_id: "501" },
    });
    const r = await client.mentions("7", { sinceId: "500" });
    if (!r.ok) throw new Error("expected a page");
    expect(r.data.newestId).toBe("501");
    expect(r.data.posts[0]).toMatchObject({ id: "501", authorId: "42", urls: ["https://acme.app/"], mentions: ["sagepaysai"], referenced: [{ type: "quoted", id: "400" }] });
    expect(r.data.users[0]).toEqual({ id: "42", username: "builder", createdAt: "2020-01-01T00:00:00.000Z" });
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/2/users/7/mentions");
    expect(url.searchParams.get("since_id")).toBe("500");
    expect(url.searchParams.get("expansions")).toBe("author_id");
    expect(url.searchParams.get("tweet.fields")).toBe("created_at,entities,conversation_id,referenced_tweets");
    expect(url.searchParams.get("user.fields")).toBe("username,created_at");
  });
});
