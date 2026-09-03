import { describe, expect, it } from "vitest";
import { authorAgeSignal, parseAuthor } from "./author-age";

const CAMPAIGN_CREATED = Math.floor(Date.parse("2026-09-02T20:00:00Z") / 1000);
const json = (body: unknown, status = 200) => ({ status, json: async () => body }) as unknown as Response;

describe("author account age", () => {
  it("parses the author out of gist, repo and dev.to links — and nothing out of others", () => {
    expect(parseAuthor("https://gist.github.com/nftjimmy200-hub/0f9e9b6a3bb5f24757fe580a11f128be")).toEqual({ host: "github", handle: "nftjimmy200-hub" });
    expect(parseAuthor("https://github.com/ehsansor/some-repo")).toEqual({ host: "github", handle: "ehsansor" });
    expect(parseAuthor("https://dev.to/amer_homa/new-2cek")).toEqual({ host: "devto", handle: "amer_homa" });
    expect(parseAuthor("https://dev.to/t/webdev")).toBeNull();
    expect(parseAuthor("https://sage-anorak-5f6.notion.site/x")).toBeNull();
  });

  it("a GitHub account created during the campaign is a medium 'fresh author account' signal", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      expect(String(url)).toBe("https://api.github.com/users/nftjimmy200-hub");
      return json({ created_at: "2026-09-03T01:19:21Z" });
    }) as unknown as typeof fetch;
    const s = await authorAgeSignal("https://gist.github.com/nftjimmy200-hub/0f9e", CAMPAIGN_CREATED, fetchImpl);
    expect(s?.severity).toBe("med");
    expect(s?.signal).toBe("fresh author account");
    expect(s?.reason).toMatch(/"nftjimmy200-hub".*created after this campaign was created/);
  });

  it("a dev.to account joined the day of the campaign reads its display date", async () => {
    const fetchImpl = (async () => json({ joined_at: "Sep  3, 2026" })) as unknown as typeof fetch;
    const s = await authorAgeSignal("https://dev.to/amer_homa/new-2cek", CAMPAIGN_CREATED, fetchImpl);
    expect(s?.severity).toBe("med");
  });

  it("an account older than the campaign is no signal at all", async () => {
    const fetchImpl = (async () => json({ created_at: "2021-12-05T04:57:46Z" })) as unknown as typeof fetch;
    expect(await authorAgeSignal("https://gist.github.com/ehsansor/a794", CAMPAIGN_CREATED, fetchImpl)).toBeNull();
  });

  it("an API failure is never an accusation", async () => {
    const fetchImpl = (async () => json({ message: "rate limited" }, 403)) as unknown as typeof fetch;
    expect(await authorAgeSignal("https://gist.github.com/x/y", CAMPAIGN_CREATED, fetchImpl)).toBeNull();
    const boom = (async () => { throw new Error("network"); }) as unknown as typeof fetch;
    expect(await authorAgeSignal("https://gist.github.com/x/y", CAMPAIGN_CREATED, boom)).toBeNull();
  });
});
