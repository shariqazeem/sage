import { describe, expect, it } from "vitest";

import { PAID_SERVICES, priceOf, isPaidTool, serviceEndpoint } from "./pricing";
import { MCP_TOOLS } from "./server";
import { PUBLIC_READ_TOOLS, PUBLIC_WORK_TOOLS } from "./public";
import { priceToMinimal } from "@/lib/x402/okx";

/**
 * THE CATALOGUE HAS TO SURVIVE CONTACT WITH THE MARKETPLACE.
 *
 * A listed service is rejected or reads as broken for reasons that have nothing to do with whether
 * the code works: a name outside 5-30 characters, a name colliding with the agent's own, a price the
 * paywall and the listing disagree about, or an endpoint pointing at a tool that is not published.
 * Each of those is invisible locally and expensive to discover after a review fails, which has
 * already happened once over a single unpublished path.
 */

describe("every paid service can actually be sold", () => {
  it.each(PAID_SERVICES.map((s) => [s.serviceName, s] as const))(
    "%s has a marketplace-legal name",
    (_label, s) => {
      expect(s.serviceName.length).toBeGreaterThanOrEqual(5);
      expect(s.serviceName.length).toBeLessThanOrEqual(30);
      // The marketplace rejects a service named after the agent.
      expect(s.serviceName.toLowerCase()).not.toBe("sage");
    },
  );

  it.each(PAID_SERVICES.map((s) => [s.serviceName, s] as const))(
    "%s is priced in whole minimal units",
    (_label, s) => {
      expect(s.priceUsd).toBeGreaterThan(0);
      // A price the 6-decimal token cannot express would be quoted differently than it is charged.
      expect(priceToMinimal(s.priceUsd)).toMatch(/^\d+$/);
      expect(Number(priceToMinimal(s.priceUsd)) / 1e6).toBeCloseTo(s.priceUsd, 9);
    },
  );

  it("has distinct names and distinct tools", () => {
    const names = PAID_SERVICES.map((s) => s.serviceName);
    const tools = PAID_SERVICES.map((s) => s.tool);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(tools).size).toBe(tools.length);
  });

  it.each(PAID_SERVICES.map((s) => [s.tool] as const))(
    "%s is a real tool that is published publicly",
    (tool) => {
      // A priced endpoint for an unpublished tool is a 404 with a price on it.
      expect(MCP_TOOLS.map((t) => t.name)).toContain(tool);
      expect([...PUBLIC_READ_TOOLS, ...PUBLIC_WORK_TOOLS]).toContain(tool);
    },
  );

  it("gives each service its own endpoint", () => {
    const urls = PAID_SERVICES.map((s) => serviceEndpoint(s.tool));
    expect(new Set(urls).size).toBe(urls.length);
    for (const u of urls) expect(u).toMatch(/^https:\/\/sagepays\.xyz\/mcp\/public\/sage_/);
  });
});

describe("what stays free stays free", () => {
  it.each([
    ["sage_get_inspection", "polling work you already bought"],
    ["sage_get_campaign", "reading a campaign you already have"],
    ["sage_answer_questions", "answering Sage's own clarifying question"],
    ["sage_get_proof", "verifying a receipt Sage published"],
    ["sage_browse_missions", "discovering open work"],
    ["sage_example_plan", "seeing what Sage produces"],
  ])("%s is not charged (%s)", (tool) => {
    expect(isPaidTool(tool)).toBe(false);
    expect(priceOf(tool)).toBeNull();
  });
});
