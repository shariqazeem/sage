import { describe, it } from "vitest";
import { readPage } from "@/lib/read/page-reader";

/** Spot check: real public posts on the platforms Sage reads, from wherever this runs. BENCH=1 to run. */
const URLS = [
  "https://x.com/jack/status/20",
  "https://twitter.com/elonmusk/status/1585341984679469056",
  "https://bsky.app/profile/bsky.app/post/3l6oveex3ii2l",
  "https://www.reddit.com/r/programming/comments/1bq9u8k/",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://vimeo.com/76979871",
  "https://dev.to/ben/the-dev-community-is-now-open-source-3bm5",
];

describe.skipIf(process.env.BENCH !== "1")("reader spot check", () => {
  it("reads real public posts", async () => {
    for (const url of URLS) {
      const t0 = Date.now();
      const r = await readPage(url).catch((e) => ({ ok: false, reason: String(e) }) as never);
      const rr = r as unknown as { ok: boolean; text?: string; reason?: string; facts?: Record<string, unknown> };
      console.log(JSON.stringify({ url, ok: rr.ok, chars: rr.text?.length ?? 0, reason: rr.reason ?? null, facts: rr.facts ? Object.keys(rr.facts) : null, ms: Date.now() - t0 }));
    }
  }, 120_000);
});
