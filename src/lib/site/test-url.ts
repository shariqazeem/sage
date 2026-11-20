import { siteUrl } from "@/lib/site";

/**
 * THE ONE LINK TO A TEST (relaunch, 20 Nov 2026). `/t/<id>` takes an inspection id or a campaign id and
 * shows the test at whatever stage it is in. Every surface that links a test (Sage's X posts first) goes
 * through here, so the address is decided once.
 */
export function testUrl(id: string): string {
  return `${siteUrl()}/t/${encodeURIComponent(id)}`;
}
