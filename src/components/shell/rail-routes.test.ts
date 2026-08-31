import { describe, expect, it } from "vitest";
import { RAIL_ROUTES } from "./app-rail";
import { isAppRoute } from "./routes";

/**
 * THE RULE: if the rail links to it, the rail survives it.
 *
 * It was already written in app-shell.tsx — for /marketplace — and never applied to the rest, so
 * Explorer sat in the rail and destroyed it on click: you arrived with no way back but the logo.
 * Two lists in two files drifted because nothing compared them. This compares them.
 */
describe("rail routes keep their shell", () => {
  it("every route the rail offers is an app route", () => {
    const orphans = RAIL_ROUTES.filter((r) => r !== "/docs" && !isAppRoute(r));
    expect(orphans, `these rail links would destroy the rail: ${orphans.join(", ")}`).toEqual([]);
  });

  it("still offers the capital surfaces — the FC story has to be reachable", () => {
    expect(RAIL_ROUTES).toContain("/explorer");
    expect(RAIL_ROUTES).toContain("/lender");
  });

  it("keeps /docs OUT of the shell, deliberately", () => {
    // Docs carries its own sidebar, and the founder rail would offer a stranger a Dashboard link
    // for an account they do not have. It is the one justified exception, so it is pinned.
    expect(RAIL_ROUTES).toContain("/docs");
    expect(isAppRoute("/docs")).toBe(false);
  });

  it("shells the credit file, which is used inside the system", () => {
    expect(isAppRoute("/record/0xabc")).toBe(true);
  });

  it("leaves /proof a standalone DOCUMENT — it is a receipt, not an app page", () => {
    // The most-shared thing Sage produces, usually opened by someone who has never heard of it.
    // Founder chrome offering "Launch a campaign" would turn an artifact into an advert.
    expect(isAppRoute("/proof/0x123")).toBe(false);
  });

  it("leaves the public front door alone", () => {
    for (const p of ["/", "/faq", "/claim", "/hire"]) expect(isAppRoute(p)).toBe(false);
  });
});
