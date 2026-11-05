import { writeFileSync, mkdirSync } from "node:fs";
import { describe, it } from "vitest";
import { readHandedOver } from "@/lib/launch/handed-over";

/**
 * SAGE BENCH · READER — what happens when a founder hands Sage a real link of each kind.
 *
 * No model is called: this is the step BEFORE the draft. A founder who pastes a link Sage cannot read gets
 * "Sage couldn't open …" and has to type the work out, which is the chore the hand-over exists to remove.
 * So every kind of link a team actually has is tried here, live, and the result is recorded.
 *
 *   BENCH=1 npx vitest run tests/bench/reader.live
 */
const LINKS: { kind: string; url: string }[] = [
  { kind: "github issue", url: "https://github.com/shariqazeem/sage/issues/1" },
  { kind: "github issue (big repo)", url: "https://github.com/vercel/next.js/issues/48748" },
  { kind: "github pull request", url: "https://github.com/vercel/next.js/pull/58000" },
  { kind: "github repo", url: "https://github.com/shariqazeem/sage" },
  { kind: "github file", url: "https://github.com/vercel/next.js/blob/canary/readme.md" },
  { kind: "github discussion", url: "https://github.com/vercel/next.js/discussions/41745" },
  { kind: "gist", url: "https://gist.github.com/gaearon/0275b1e1518599bbeafcde4722e79ed1" },
  { kind: "docs page", url: "https://nextjs.org/docs/app/getting-started/installation" },
  { kind: "blog post (dev.to)", url: "https://dev.to/devteam/introducing-dev-the-new-dev-to-mobile-app-1f2j" },
  { kind: "blog post (medium)", url: "https://medium.com/@nodejs/announcing-a-new-experimental-modules-1be8d2d6c2ff" },
  { kind: "notion public page", url: "https://www.notion.so/Notion-Guide-and-Templates-7f6d2b34a2a540a4a4b5e1b2d0a5ee1f" },
  { kind: "google doc (public)", url: "https://docs.google.com/document/d/1Xb3ZGaBHkU3OYYP6ptGyqTYbr7CbkD6jYqm5D3qGbYk/edit" },
  { kind: "google sheet (public)", url: "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit" },
  { kind: "pdf", url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf" },
  { kind: "x post", url: "https://x.com/vercel/status/1790000000000000000" },
  { kind: "youtube video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  { kind: "reddit post", url: "https://www.reddit.com/r/programming/comments/1h5k3x8/" },
  { kind: "hacker news item", url: "https://news.ycombinator.com/item?id=8863" },
  { kind: "linear (public)", url: "https://linear.app/linear/issue/LIN-1" },
  { kind: "figma community", url: "https://www.figma.com/community/file/1035203688168086460" },
  { kind: "product site", url: "https://sagepays.xyz" },
  { kind: "http (not https)", url: "http://example.com/brief" },
];

describe.skipIf(process.env.BENCH !== "1")("bench · reader", () => {
  it("reads every kind of link a founder hands over", async () => {
    const rows: { kind: string; url: string; read: boolean; label: string | null; chars: number; reason: string | null; ms: number }[] = [];
    for (const l of LINKS) {
      const t0 = Date.now();
      const r = await readHandedOver(`Please do this: ${l.url}`).catch((e) => ({ url: l.url, label: null, read: false, reason: String(e).slice(0, 80), text: "" }) as never);
      const ms = Date.now() - t0;
      const row = { kind: l.kind, url: l.url, read: !!r?.read, label: r?.label ?? null, chars: r?.text?.length ?? 0, reason: r?.reason ?? (r ? null : "no link found"), ms };
      rows.push(row);
      console.log(`${row.read ? "READ " : "MISS "} ${l.kind.padEnd(24)} ${String(row.chars).padStart(6)} chars ${String(ms).padStart(5)}ms  ${row.reason ?? ""}`);
    }
    mkdirSync("tests/bench/results", { recursive: true });
    writeFileSync("tests/bench/results/reader.json", JSON.stringify(rows, null, 2));
  }, 300_000);
});
