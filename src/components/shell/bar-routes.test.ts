import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_LINKS, BAR_NAV, NEW_TEST_HREF, barPlace, hasTopBar, isAppRoute } from "./routes";

const root = process.cwd();
const page = (route: string) => join(root, "src/app", route, "page.tsx");

/**
 * ONE BAR, NO RAIL (relaunch, 20 Nov 2026). The bar's list lives in one file and this holds it: two
 * lists in two files drifted here once (a link sat in the rail and destroyed the rail on click).
 */
describe("the one top bar", () => {
  it("offers exactly Tests and Earn, and New test puts the cursor in the paste box", () => {
    expect(BAR_NAV).toEqual([
      { href: "/", label: "Tests" },
      { href: "/earn", label: "Earn" },
    ]);
    expect(NEW_TEST_HREF).toBe("/#paste");
  });

  it("every place the bar offers is a page that wears the bar", () => {
    for (const { href } of BAR_NAV) {
      expect(existsSync(page(href)), href).toBe(true);
      expect(hasTopBar(href), href).toBe(true);
    }
  });

  it("is on product pages and company pages alike", () => {
    for (const p of ["/", "/earn", "/t/abc", "/pricing", "/company", "/ledger", "/docs/build", "/workspace", "/workspace/jobs", "/launch/abc", "/c/some-board", "/record/0xabc", "/checkout"]) {
      expect(hasTopBar(p), p).toBe(true);
    }
  });

  it("a receipt is a DOCUMENT and wears no chrome; the first run and an invite are focused", () => {
    // /proof/<tx> is the most-shared thing Sage produces, usually opened by someone who has never heard of it.
    for (const p of ["/proof/0x123", "/start", "/join/ws_inv_abc"]) expect(hasTopBar(p), p).toBe(false);
  });

  it("marks the place a page belongs to", () => {
    for (const p of ["/", "/t/abc", "/launch", "/launch/abc", "/campaign/abc", "/workspace/jobs"]) expect(barPlace(p), p).toBe("/");
    for (const p of ["/earn", "/c/some-board", "/record/0xabc", "/verify"]) expect(barPlace(p), p).toBe("/earn");
    for (const p of ["/pricing", "/company", "/ledger", "/docs", "/workspace/settings"]) expect(barPlace(p), p).toBeNull();
  });
});

describe("the rail is retired, and no screen went with it", () => {
  it("nothing draws a rail or a second header", () => {
    expect(existsSync(join(root, "src/components/shell/app-rail.tsx"))).toBe(false);
    expect(existsSync(join(root, "src/components/site/site-header.tsx"))).toBe(false);
    expect(readFileSync(join(root, "src/components/site/site-frame.tsx"), "utf8")).not.toMatch(/SiteHeader/);
  });

  it("the screens the rail held are all still pages, reached from the account sheet", () => {
    expect(ACCOUNT_LINKS.map((l) => l.href)).toEqual(["/workspace/jobs", "/workspace/account", "/workspace/people", "/workspace/settings"]);
    for (const r of ["/workspace", "/launch", ...ACCOUNT_LINKS.map((l) => l.href)]) expect(existsSync(page(r)), r).toBe(true);
    const sheet = readFileSync(join(root, "src/components/sage/account-sheet.tsx"), "utf8");
    expect(sheet).toMatch(/ACCOUNT_LINKS\.map/);
  });
});

describe("app pages, company pages and documents stay distinct", () => {
  it("the pages a founder works in", () => {
    for (const p of ["/workspace", "/workspace/autopilot", "/campaign/abc", "/graph/abc", "/agent", "/launch/direct"]) expect(isAppRoute(p), p).toBe(true);
  });

  it("the company site, a receipt, a board and a record are not app pages", () => {
    for (const p of ["/", "/earn", "/pricing", "/company", "/parallaxpay", "/ledger", "/docs", "/docs/build", "/proof/0x123", "/c/some-board", "/claim", "/verify", "/agents/sage", "/record/0xabc", "/lender", "/start", "/join/ws_inv_abc"]) {
      expect(isAppRoute(p), p).toBe(false);
    }
  });
});
