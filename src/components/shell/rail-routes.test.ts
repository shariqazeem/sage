import { describe, expect, it } from "vitest";
import { RAIL_ROUTES } from "./app-rail";
import { isAppRoute } from "./routes";
import { SITE_NAV } from "@/components/site/site-header";

/**
 * THE RULE: if the rail links to it, the rail survives it. And since 19 Oct 2026, the rail IS the
 * app: six screens, no more. Two lists in two files drifted once (Explorer sat in the rail and
 * destroyed it on click); this compares them.
 */
describe("the app is six screens", () => {
  it("the rail offers exactly Home, Post, Jobs, Account, Team and Settings", () => {
    expect(RAIL_ROUTES).toEqual(["/workspace", "/launch", "/workspace/jobs", "/workspace/account", "/workspace/people", "/workspace/settings"]);
  });

  it("every route the rail offers keeps the rail", () => {
    const orphans = RAIL_ROUTES.filter((r) => !isAppRoute(r));
    expect(orphans, `these rail links would destroy the rail: ${orphans.join(", ")}`).toEqual([]);
  });

  it("the pages a screen opens keep the rail too", () => {
    for (const p of ["/campaign/abc", "/graph/abc", "/agent", "/join/xyz", "/launch/direct", "/workspace/autopilot"]) expect(isAppRoute(p), p).toBe(true);
  });

  it("the first run is focused: no rail before there is anything to navigate", () => {
    expect(isAppRoute("/start")).toBe(false);
  });
});

describe("the company site never wears founder chrome", () => {
  it("every page in the site header is a site page", () => {
    for (const { href } of SITE_NAV) if (href !== "/marketplace") expect(isAppRoute(href), href).toBe(false);
  });

  it("the front door, pricing, the company, Called, the ledger and the docs", () => {
    for (const p of ["/", "/pricing", "/company", "/called", "/ledger", "/docs", "/docs/build"]) expect(isAppRoute(p), p).toBe(false);
  });

  it("a receipt is a DOCUMENT, not an app page, and so is a public board", () => {
    // The most-shared thing Sage produces, usually opened by someone who has never heard of it.
    expect(isAppRoute("/proof/0x123")).toBe(false);
    expect(isAppRoute("/c/some-board")).toBe(false);
    for (const p of ["/claim", "/verify", "/agents/sage"]) expect(isAppRoute(p), p).toBe(false);
  });
});
