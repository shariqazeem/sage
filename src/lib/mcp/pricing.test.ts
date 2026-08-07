import { afterEach, describe, expect, it } from "vitest";

import { PAID_SERVICES, priceOf, isPaidTool, serviceEndpoint, serviceOf, servicesArePaid } from "./pricing";
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

/**
 * THE TWO COMPLIANT SHAPES, AND THE SWITCH BETWEEN THEM.
 *
 * OKX's A2MCP guide accepts either shape: "① Free endpoint — returns the result directly on call;
 * no billing, no x402. ② x402 pay-per-call endpoint". Their reviewer rejected all four services
 * four times over payment verification, so shape ① is the one that ships today.
 *
 * The switch has to move BOTH the endpoint and the listing together — OKX validates that a
 * service's registered price matches what its endpoint actually asks for, and a mismatch reads as a
 * broken service. These tests hold that the catalogue survives the switch (so the rail can be
 * re-armed, and so a free listing still has names and summaries to advertise) and that the price
 * is the only thing that moves.
 *
 * The previous tests here never asserted a paid tool WAS paid, so they passed in either shape and
 * guarded nothing.
 */
describe("free-endpoint shape vs paid-endpoint shape", () => {
  const PAY_TO = "0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3";
  const before = process.env.OKX_X402_PAY_TO;
  afterEach(() => {
    if (before === undefined) delete process.env.OKX_X402_PAY_TO;
    else process.env.OKX_X402_PAY_TO = before;
  });

  it("charges every catalogue service when the rail is armed", () => {
    process.env.OKX_X402_PAY_TO = PAY_TO;
    expect(servicesArePaid()).toBe(true);
    for (const s of PAID_SERVICES) {
      expect(isPaidTool(s.tool), `${s.tool} paid`).toBe(true);
      expect(priceOf(s.tool)?.priceUsd, `${s.tool} price`).toBe(s.priceUsd);
    }
  });

  it("charges nothing at all when the rail is disarmed", () => {
    delete process.env.OKX_X402_PAY_TO;
    expect(servicesArePaid()).toBe(false);
    for (const s of PAID_SERVICES) {
      expect(isPaidTool(s.tool), `${s.tool} must be free`).toBe(false);
      expect(priceOf(s.tool), `${s.tool} must have no price`).toBeNull();
    }
  });

  it("keeps the catalogue readable while free, so the listing still has a name and a summary", () => {
    delete process.env.OKX_X402_PAY_TO;
    for (const s of PAID_SERVICES) {
      const entry = serviceOf(s.tool);
      expect(entry?.serviceName).toBe(s.serviceName);
      expect(entry?.summary).toBe(s.summary);
      expect(entry?.priceUsd).toBe(s.priceUsd); // the price it WOULD charge, kept for re-arming
    }
  });

  it("an empty or whitespace address is disarmed, not armed with a blank payee", () => {
    for (const v of ["", "   "]) {
      process.env.OKX_X402_PAY_TO = v;
      expect(servicesArePaid()).toBe(false);
      expect(isPaidTool(PAID_SERVICES[0]!.tool)).toBe(false);
    }
  });

  it("never charges for a free tool in either shape", () => {
    for (const v of [PAY_TO, undefined]) {
      if (v === undefined) delete process.env.OKX_X402_PAY_TO;
      else process.env.OKX_X402_PAY_TO = v;
      expect(isPaidTool("sage_get_proof")).toBe(false);
      expect(priceOf("sage_get_proof")).toBeNull();
    }
  });
});
