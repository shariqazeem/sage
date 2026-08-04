import { describe, it, expect } from "vitest";
import { MCP_TOOLS } from "./server";
import { publicMcpTools, PUBLIC_READ_TOOLS, PUBLIC_WORK_TOOLS } from "./public";

/**
 * WHAT THE MARKETPLACE REVIEWER ACTUALLY CHECKS.
 *
 * Rejected twice with the same sentence: "the results returned by your service in actual calls don't
 * match the capabilities stated in your service description." From the prod access log the reviewer
 * makes ONE tools/call and stops — 03/Aug it was `sage_start_inspection` (1366 bytes), 04/Aug it was
 * `sage_example_plan` (2662 bytes, an exact size match). It picks a tool it can call, and on the
 * second pass that meant the one with NO required arguments.
 *
 * That call returned a finished plan for yara.garden with `pagesInspected: 1` and `fieldTest: null`,
 * under a description whose headline claim is "Sage browses it in a real browser like a first-time
 * user". The flagship example did not demonstrate the flagship capability, and it carried
 * "a few minutes of real browsing" while the same service advertised 4-11 minutes elsewhere.
 *
 * These are the invariants that failure implies. They are cheap, and each one is a thing a reviewer
 * can see WITHOUT running an inspection.
 */

const tool = (name: string) => MCP_TOOLS.find((t) => t.name === name)!;

describe("a no-argument tool must not read as the service ignoring your input", () => {
  it("sage_example_plan says outright that it is a specimen, not a plan for your product", () => {
    const d = tool("sage_example_plan").description;
    expect(d).toMatch(/specimen/i);
    expect(d).toMatch(/takes no arguments/i);
    // and it must point at the tool that DOES take the caller's url
    expect(d).toMatch(/sage_start_inspection/);
  });

  it("every no-argument public tool explains what to call for your own product", () => {
    for (const t of publicMcpTools()) {
      const required = (t.inputSchema as { required?: string[] }).required ?? [];
      if (required.length > 0) continue;
      expect(t.description, `${t.name} takes no args and must redirect`).toMatch(
        /sage_start_inspection|sage_browse_missions|your own|specimen/i,
      );
    }
  });
});

describe("the service's own numbers must agree with each other", () => {
  it("start_inspection and example_plan quote the SAME duration", () => {
    // Two different waits advertised by one service is a contradiction visible without any call.
    const start = tool("sage_start_inspection").description;
    const secs = /(\d+)\s*-\s*(\d+)\s*min/.exec(start);
    expect(secs, "start_inspection must state a concrete range").not.toBeNull();
    const [, lo, hi] = secs!;
    expect(Number(lo) * 60).toBeLessThanOrEqual(240);
    expect(Number(hi) * 60).toBeGreaterThanOrEqual(660);
  });

  it("no public tool still promises the vague 'a few minutes'", () => {
    // The measured reality is 240-660s. "A few minutes" is what the first rejection was about.
    for (const t of publicMcpTools()) {
      expect(t.description, t.name).not.toMatch(/a few minutes/i);
    }
  });
});

describe("every capability the listing claims is reachable from the published tools", () => {
  it.each([
    ["designs testing missions", /mission/i],
    ["checkable pass criteria", /criteri/i],
    ["evidence the tester supplies", /evidence/i],
    ["an exact budget split", /budget/i],
    ["real browser browsing", /browser|browses|browsing/i],
  ])("%s is stated by at least one public tool", (_label, re) => {
    const all = publicMcpTools().map((t) => t.description).join(" ");
    expect(all).toMatch(re);
  });

  it("the URL-taking tool promises evidence about the CALLER's product, in that call", () => {
    // The rejection reads as "you took my input and answered about something else". The description
    // must therefore claim what the response now actually carries: a look at THEIR url.
    const d = tool("sage_start_inspection").description;
    expect(d).toMatch(/firstLook/);
    expect(d).toMatch(/your product|you supply|your URL/i);
  });

  it("the tool that accepts a product URL is published, so the described flow is actually callable", () => {
    const names = publicMcpTools().map((t) => t.name);
    expect(names).toContain("sage_start_inspection");
    const req = (tool("sage_start_inspection").inputSchema as { required?: string[] }).required ?? [];
    expect(req).toContain("productUrl");
    expect(req).toContain("budgetUsd");
  });

  it("read tools and work tools are disjoint — a cap can never be dodged by naming", () => {
    const overlap = (PUBLIC_READ_TOOLS as readonly string[]).filter((n) =>
      (PUBLIC_WORK_TOOLS as readonly string[]).includes(n),
    );
    expect(overlap).toEqual([]);
  });
});
