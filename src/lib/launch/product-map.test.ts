import { describe, expect, it } from "vitest";
import { buildProductMap, scopeFromObservations } from "./product-map";
import type { FounderLaunchInput, ProductObservation } from "./schemas";

/**
 * The product map is deterministic evidence: same inputs → same normalized map + digest;
 * every finding cites a real source; thin evidence yields needs_input rather than
 * invention; the derived validation scope contains exactly the observed URLs/hosts.
 */

function obs(url: string, over: Partial<ProductObservation> = {}): ProductObservation {
  return {
    url, status: 200, title: "Acme — ship faster", headings: ["Ship faster", "Pricing"],
    claims: ["The fastest way to deploy", "Secure by default"], ctas: ["Get started", "Sign up"],
    forms: [{ label: "Sign up", fields: ["email", "password"], isAuth: true }],
    links: [`${new URL(url).origin}/pricing`, `${new URL(url).origin}/docs`],
    authBoundary: true, techHints: ["Next.js"], states: ["loading"], landmarks: ["nav", "main"],
    snippets: ["Deploy in seconds"], inspectedAt: 0, contentSha256: "a".repeat(64), ...over,
  };
}
const founder: FounderLaunchInput = {
  productUrl: "https://acme.example", goal: "learn onboarding", targetUsers: "developers",
  totalBudgetBase: BigInt(5_000_000), tokenDecimals: 6,
};

describe("buildProductMap — deterministic, sourced, honest", () => {
  it("is deterministic — identical observations produce an identical digest", () => {
    const o = [obs("https://acme.example/"), obs("https://acme.example/pricing", { title: "Pricing" })];
    const a = buildProductMap(o, [], founder);
    const b = buildProductMap(o, [], founder);
    expect(a.digest).toBe(b.digest);
    expect(a.digest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("every route finding cites a real inspected source", () => {
    const map = buildProductMap([obs("https://acme.example/"), obs("https://acme.example/pricing")], [], founder);
    expect(map.routes.length).toBeGreaterThan(0);
    for (const r of map.routes) {
      expect(r.sources.length).toBeGreaterThan(0);
      expect(r.browserConfirmed).toBe(true);
    }
    expect(map.trustSurfaces.length).toBeGreaterThan(0); // auth boundary observed
  });

  it("no inspected pages → open questions, never invention", () => {
    const map = buildProductMap([], [], founder);
    expect(map.pagesInspected).toBe(0);
    expect(map.openQuestions.length).toBeGreaterThan(0);
    expect(map.routes).toHaveLength(0);
    expect(map.valueProp).toMatch(/no clear value proposition/i);
  });

  it("the digest changes when the observed value proposition changes", () => {
    const a = buildProductMap([obs("https://acme.example/", { claims: ["Fast deploys"] })], [], founder);
    const b = buildProductMap([obs("https://acme.example/", { claims: ["Slow but steady"] })], [], founder);
    expect(a.digest).not.toBe(b.digest);
  });

  it("scopeFromObservations contains the inspected URLs + hosts (for mission validation)", () => {
    const scope = scopeFromObservations([obs("https://acme.example/"), obs("https://acme.example/pricing")], []);
    expect(scope.hosts.has("acme.example")).toBe(true);
    expect(scope.knownUrls.has("https://acme.example/")).toBe(true);
    // discovered same-origin links are in scope too (so a mission can target them).
    expect([...scope.knownUrls].some((u) => u.includes("/pricing"))).toBe(true);
  });
});
