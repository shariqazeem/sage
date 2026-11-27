import { siteUrl } from "@/lib/site";

/**
 * THE ONE LINK TO A TEST (relaunch, 20 Nov 2026). `/t/<id>` takes an inspection id or a campaign id and
 * shows the test at whatever stage it is in. Every surface that links a test (Sage's X posts first) goes
 * through here, so the address is decided once.
 */
export function testUrl(id: string, via?: TestLinkVia): string {
  return `${siteUrl()}/t/${encodeURIComponent(id)}${via ? `?via=${via}` : ""}`;
}

/**
 * WHERE A LINK WAS PUT (27 Nov 2026). Sage's own links say where they were posted, so a test's builder can
 * see where people came from: Sage's post on X, its Telegram channel, Earn, a roster alert, the builder's
 * own link. The test page reads the word once, on a visitor's first visit (`sourceOf`, test-page/funnel.ts).
 */
export type TestLinkVia = "x" | "tg" | "earn" | "alert" | "link";
