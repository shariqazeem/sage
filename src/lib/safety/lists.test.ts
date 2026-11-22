// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { domainAgeDays, safeBrowsingThreats } from "./lookups";
import { PHISHING_LIST_URL, phishingListForScreen, phishingListNow, resetPhishingListForTest } from "./phishing-list";
import { phishingVerdict } from "./product-screen";

/**
 * THE OUTSIDE LISTS, WITH NO NETWORK. The suite never fetches MetaMask's list, never calls Google and never
 * asks RDAP: each client is exercised with a hand-written answer, and the real `fetch` is replaced by one
 * that fails the test if it is ever reached.
 */
const FIXTURE = readFileSync(path.join(process.cwd(), "src", "lib", "safety", "__fixtures__", "phishing-config.json"), "utf8");
const saved: Record<string, string | undefined> = {};
let file: string;

beforeEach(() => {
  for (const k of ["PHISHING_LIST_PATH", "PHISHING_LIST", "SAFE_BROWSING_API_KEY", "PRODUCT_SCREEN_RDAP", "VITEST", "NODE_ENV"]) saved[k] = process.env[k];
  file = path.join(mkdtempSync(path.join(tmpdir(), "phish-")), "list.json");
  process.env.PHISHING_LIST_PATH = file;
  resetPhishingListForTest();
  vi.stubGlobal("fetch", async () => {
    throw new Error("the suite reached the network");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("MetaMask's phishing list on the server", () => {
  it("with no copy, a test gets none and nothing is fetched", async () => {
    expect(phishingListNow()).toBeNull();
    expect(await phishingListForScreen()).toBeNull();
    expect(existsSync(file)).toBe(false);
  });

  it("a copy on disk is read without the network, and answers", async () => {
    writeFileSync(file, FIXTURE);
    const list = (await phishingListForScreen())!;
    expect(phishingVerdict("sub.zkdrop-claims.example", list).verdict).toBe("listed");
    expect(phishingListNow()).toBe(list);
  });

  it("a copy more than a week old is not evidence of anything", () => {
    writeFileSync(file, FIXTURE);
    const old = (Date.now() - 8 * 86_400_000) / 1000;
    utimesSync(file, old, old);
    expect(phishingListNow()).toBeNull();
  });

  it("a file that is not the list is ignored", () => {
    writeFileSync(file, JSON.stringify({ blacklist: "nope" }));
    expect(phishingListNow()).toBeNull();
  });

  describe("outside the suite", () => {
    beforeEach(() => {
      delete process.env.VITEST;
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    });

    it("the first screen on a fresh server waits for the list, writes it, and does not ask twice in a day", async () => {
      const asked: string[] = [];
      const fetchList = (async (url: string) => {
        asked.push(String(url));
        return new Response(FIXTURE, { status: 200 });
      }) as unknown as typeof fetch;
      const list = (await phishingListForScreen({ fetch: fetchList }))!;
      expect(asked).toEqual([PHISHING_LIST_URL]);
      expect(phishingVerdict("wallet-rectify.example", list).verdict).toBe("listed");
      expect(Object.keys(JSON.parse(readFileSync(file, "utf8")) as object).sort()).toEqual(["blacklist", "fuzzylist", "tolerance", "version", "whitelist"]);
      await phishingListForScreen({ fetch: fetchList });
      expect(asked).toHaveLength(1);
    });

    it("a day-old copy is used at once and refreshed behind it", async () => {
      writeFileSync(file, FIXTURE);
      const old = (Date.now() - 2 * 86_400_000) / 1000;
      utimesSync(file, old, old);
      let asked = 0;
      const fetchList = (async () => {
        asked++;
        return new Response(FIXTURE.replace("zkdrop-claims.example", "brand-new-entry.example"), { status: 200 });
      }) as unknown as typeof fetch;
      const stale = (await phishingListForScreen({ fetch: fetchList }))!;
      expect(phishingVerdict("zkdrop-claims.example", stale).verdict).toBe("listed");
      await vi.waitFor(() => expect(phishingVerdict("brand-new-entry.example", phishingListNow()!).verdict).toBe("listed"));
      expect(asked).toBe(1);
    });

    it("a failed fetch leaves the screen without a list, and is not retried at once", async () => {
      let asked = 0;
      const down = (async () => {
        asked++;
        return new Response("nope", { status: 503 });
      }) as unknown as typeof fetch;
      expect(await phishingListForScreen({ fetch: down })).toBeNull();
      expect(await phishingListForScreen({ fetch: down })).toBeNull();
      expect(asked).toBe(1);
    });

    it("PHISHING_LIST=off never fetches", async () => {
      process.env.PHISHING_LIST = "off";
      expect(await phishingListForScreen()).toBeNull();
    });
  });
});

describe("Google Safe Browsing", () => {
  it("is off without a key, and makes no call in a test even with one", async () => {
    delete process.env.SAFE_BROWSING_API_KEY;
    expect(await safeBrowsingThreats(["https://x.example/"])).toBeUndefined();
    process.env.SAFE_BROWSING_API_KEY = "k";
    expect(await safeBrowsingThreats(["https://x.example/"])).toBeUndefined();
  });

  it("sends the address with the key in a header, and reads the threat types", async () => {
    process.env.SAFE_BROWSING_API_KEY = "k-secret";
    const calls: { url: string; init: RequestInit }[] = [];
    const g = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ matches: [{ threatType: "SOCIAL_ENGINEERING" }, { threatType: "SOCIAL_ENGINEERING" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await safeBrowsingThreats(["https://x.example/", "https://x.example/"], { fetch: g })).toEqual(["SOCIAL_ENGINEERING"]);
    expect(calls[0]!.url).toBe("https://safebrowsing.googleapis.com/v4/threatMatches:find");
    expect(calls[0]!.url).not.toContain("k-secret");
    expect((calls[0]!.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k-secret");
    expect((JSON.parse(String(calls[0]!.init.body)) as { threatInfo: { threatEntries: unknown[] } }).threatInfo.threatEntries).toEqual([{ url: "https://x.example/" }]);
  });

  it("no match is an empty list; an error is unavailable, never safe", async () => {
    process.env.SAFE_BROWSING_API_KEY = "k";
    expect(await safeBrowsingThreats(["https://x.example/"], { fetch: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch })).toEqual([]);
    expect(await safeBrowsingThreats(["https://x.example/"], { fetch: (async () => new Response("no", { status: 403 })) as unknown as typeof fetch })).toBeNull();
    expect(await safeBrowsingThreats(["https://x.example/"], { fetch: (async () => { throw new Error("down"); }) as unknown as typeof fetch })).toBeNull();
  });
});

describe("a domain's age (RDAP)", () => {
  const rdap = (body: unknown, status = 200) => (async (url: string) => {
    seen.push(String(url));
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  let seen: string[] = [];
  beforeEach(() => {
    seen = [];
  });

  it("is off unless switched on", async () => {
    delete process.env.PRODUCT_SCREEN_RDAP;
    expect(await domainAgeDays("x.example", { fetch: rdap({}) })).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it("asks about the registered domain and counts the days", async () => {
    process.env.PRODUCT_SCREEN_RDAP = "1";
    const nowMs = Date.parse("2026-11-22T00:00:00Z");
    expect(await domainAgeDays("app.newthing.xyz", { fetch: rdap({ events: [{ eventAction: "last changed", eventDate: "2026-11-21T00:00:00Z" }, { eventAction: "registration", eventDate: "2026-11-19T00:00:00Z" }] }), nowMs })).toBe(3);
    expect(seen).toEqual(["https://rdap.org/domain/newthing.xyz"]);
  });

  it("no date, an error, or a site under a shared host is unknown, never new", async () => {
    process.env.PRODUCT_SCREEN_RDAP = "1";
    expect(await domainAgeDays("x.example", { fetch: rdap({ events: [] }) })).toBeNull();
    expect(await domainAgeDays("x.example", { fetch: rdap({}, 404) })).toBeNull();
    seen = [];
    expect(await domainAgeDays("my-app.vercel.app", { fetch: rdap({}) })).toBeNull();
    expect(seen).toEqual([]);
  });
});
