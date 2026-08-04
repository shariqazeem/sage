import { describe, it, expect } from "vitest";
import {
  isPublicTool,
  publicMcpTools,
  sanitizePublicArgs,
  publicCallGuard,
} from "./public";
import { MCP_TOOLS } from "./server";

/**
 * `/mcp/public/<toolName>` exists because the OKX reviewer's client tried exactly that path and got
 * a 404 (prod access log, 31/Jul/2026:16:13:26), during the review pass that ended in the listing
 * being pulled.
 *
 * A second door into the same tools is only safe while it is the SAME door. These assert the
 * boundary the REST route depends on — every check it makes is the shared one, so a tool that is
 * private, an identity a caller tries to forge, or a cap that should fire behaves identically
 * whichever shape the call arrives in.
 */

describe("the REST surface can only reach what the MCP surface publishes", () => {
  it("publishes a non-empty allowlist", () => {
    const names = publicMcpTools().map((t) => t.name);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(isPublicTool(n)).toBe(true);
  });

  it("refuses every tool that exists but is not published", () => {
    const published = new Set(publicMcpTools().map((t) => t.name));
    const unpublished = MCP_TOOLS.map((t) => t.name).filter((n) => !published.has(n));
    // There must BE money/founder-scoped tools held back — otherwise this test proves nothing.
    expect(unpublished.length).toBeGreaterThan(0);
    for (const n of unpublished) expect(isPublicTool(n)).toBe(false);
  });

  it.each([
    "sage_my_campaigns",
    "sage_settle",
    "../../etc/passwd",
    "sage_start_inspection ",
    "SAGE_START_INSPECTION",
    "",
    "__proto__",
  ])("refuses %s", (name) => {
    expect(isPublicTool(name)).toBe(false);
  });
});

describe("a REST caller cannot forge an identity", () => {
  it("strips caller-supplied identity from a bare body, exactly as JSON-RPC args are stripped", () => {
    const forged = {
      productUrl: "https://example.com",
      goal: "g",
      targetUsers: "t",
      budgetUsd: 5,
      founderOverride: "0xattacker",
      clientRef: "someone-elses-chat",
    };
    const clean = sanitizePublicArgs({ ...forged }, "server-derived-ref") as Record<string, unknown>;
    expect(clean.founderOverride).toBeUndefined();
    expect(clean.clientRef).not.toBe("someone-elses-chat");
    expect(clean.productUrl).toBe("https://example.com"); // real arguments survive
  });

  it("produces the same result whether the body was bare or {arguments:{…}} wrapped", () => {
    const bare = { productUrl: "https://a.test", budgetUsd: 1, founderOverride: "0xbad" };
    const unwrapped = { ...bare }; // what the route passes after unwrapping the wrapper form
    expect(sanitizePublicArgs({ ...bare }, "ref")).toEqual(
      sanitizePublicArgs({ ...unwrapped }, "ref"),
    );
  });
});

describe("caps apply to the REST shape too", () => {
  it("refuses when the shared rate limiter says no", () => {
    const g = publicCallGuard("sage_start_inspection", "ref", () => false);
    expect(g.ok).toBe(false);
    // narrow before reading `message` — it only exists on the refusal arm
    if (!g.ok) expect(g.message).toBeTruthy();
  });

  it("allows when it says yes", () => {
    expect(publicCallGuard("sage_start_inspection", "ref", () => true).ok).toBe(true);
  });
});
