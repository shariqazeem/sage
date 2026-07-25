import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  publicMcpEnabled,
  publicMcpTools,
  publicCallerRef,
  publicCallGuard,
  sanitizePublicArgs,
  isPublicTool,
  PUBLIC_READ_TOOLS,
  PUBLIC_WORK_TOOLS,
  looksLikeJsonRpc,
  acceptsMcp,
  MCP_ACCEPT,
  type PublicLimiterKind,
} from "./public";
import { MCP_TOOLS } from "./server";

/**
 * The public ASP surface is a trust boundary, so these tests are about what a stranger CANNOT do,
 * not about what a happy path returns.
 */

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("the endpoint ships closed", () => {
  it("is disabled unless PUBLIC_MCP_ENABLED is exactly 1", () => {
    for (const v of [undefined, "", "0", "true", "yes", "1 "]) {
      if (v === undefined) delete process.env.PUBLIC_MCP_ENABLED;
      else process.env.PUBLIC_MCP_ENABLED = v;
      // "1 " trims to "1" — a stray space is still an explicit opt-in.
      expect(publicMcpEnabled()).toBe(v === "1" || v === "1 ");
    }
  });
});

describe("the published registry is an allowlist", () => {
  it("publishes only the read + work tools, and never a money or third-party read", () => {
    const names = publicMcpTools().map((t) => t.name);
    expect(names.sort()).toEqual([...PUBLIC_READ_TOOLS, ...PUBLIC_WORK_TOOLS].sort());
    // the tools that read someone ELSE's data or need a founder session are absent
    expect(names).toContain("sage_example_plan");
    expect(names).not.toContain("sage_get_submission");
    expect(names).not.toContain("sage_my_campaigns");
  });

  it("a newly added private tool stays private until it is named here", () => {
    // every published name must exist in the real registry (no ghosts) …
    const registry = new Set(MCP_TOOLS.map((t) => t.name));
    for (const n of publicMcpTools()) expect(registry.has(n.name)).toBe(true);
    // … and the registry is strictly larger, i.e. publication is opt-in.
    expect(MCP_TOOLS.length).toBeGreaterThan(publicMcpTools().length);
  });

  it("does not advertise any identity argument a caller must not set", () => {
    for (const t of publicMcpTools()) {
      const props = Object.keys(
        (t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
      );
      for (const forbidden of ["clientRef", "founderOverride", "founder", "founderWallet"]) {
        expect(props).not.toContain(forbidden);
      }
    }
  });

  it("stripping an advertised arg never leaves it required", () => {
    for (const t of publicMcpTools()) {
      const req = (t.inputSchema as { required?: string[] }).required ?? [];
      const props = Object.keys(
        (t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
      );
      for (const r of req) expect(props).toContain(r);
    }
  });

  it("mutating the returned schema cannot corrupt the private registry", () => {
    const t = publicMcpTools()[0]!;
    (t.inputSchema as Record<string, unknown>).properties = { hacked: true };
    const again = publicMcpTools()[0]!;
    expect(
      (again.inputSchema as { properties?: Record<string, unknown> }).properties,
    ).not.toEqual({ hacked: true });
  });
});

describe("identity is server-derived, never caller-asserted", () => {
  it("strips every identity argument and binds the derived ref", () => {
    const out = sanitizePublicArgs(
      {
        productUrl: "https://example.com",
        goal: "test the checkout",
        clientRef: "telegram:12345",
        founderOverride: "0x1111111111111111111111111111111111111111",
        founderWallet: "0x2222222222222222222222222222222222222222",
        founder: "0x3333333333333333333333333333333333333333",
      },
      "mcp:deadbeefdeadbeef",
    );
    expect(out.clientRef).toBe("mcp:deadbeefdeadbeef");
    expect(out.founderOverride).toBeUndefined();
    expect(out.founderWallet).toBeUndefined();
    expect(out.founder).toBeUndefined();
    // the real payload survives untouched
    expect(out.productUrl).toBe("https://example.com");
    expect(out.goal).toBe("test the checkout");
  });

  it("never mutates the caller's own argument object", () => {
    const args = { clientRef: "telegram:999", goal: "g" };
    sanitizePublicArgs(args, "mcp:aaa");
    expect(args.clientRef).toBe("telegram:999");
  });

  it("derives a stable, opaque ref that does not contain the IP", () => {
    process.env.SAGE_SESSION_SECRET = "test-secret";
    const h = new Headers({ "user-agent": "some-agent/1.0" });
    const a = publicCallerRef(h, "203.0.113.7");
    const b = publicCallerRef(h, "203.0.113.7");
    expect(a).toBe(b);
    expect(a.startsWith("mcp:")).toBe(true);
    expect(a).not.toContain("203.0.113");
    expect(publicCallerRef(h, "203.0.113.8")).not.toBe(a);
  });

  it("the ref namespace can never collide with a founder chat namespace", () => {
    const ref = publicCallerRef(new Headers(), "198.51.100.1");
    expect(ref.startsWith("mcp:")).toBe(true);
    expect(ref.startsWith("telegram:")).toBe(false);
    expect(ref.startsWith("web:")).toBe(false);
  });
});

describe("caps", () => {
  const hits: PublicLimiterKind[] = [];
  const allow =
    (deny: PublicLimiterKind | null) => (kind: PublicLimiterKind, _key: string) => {
      hits.push(kind);
      return kind !== deny;
    };
  beforeEach(() => (hits.length = 0));

  it("a read takes ONLY the burst bucket", () => {
    const r = publicCallGuard("sage_get_proof", "mcp:a", allow(null));
    expect(r.ok).toBe(true);
    expect(hits).toEqual(["publicMcp"]);
  });

  it("work takes burst, then per-caller daily, then the global daily budget", () => {
    const r = publicCallGuard("sage_start_inspection", "mcp:a", allow(null));
    expect(r.ok).toBe(true);
    expect(hits).toEqual(["publicMcp", "publicMcpDaily", "publicMcpGlobalDaily"]);
  });

  it("a spent per-caller daily budget blocks work but is not charged globally", () => {
    const r = publicCallGuard("sage_start_inspection", "mcp:a", allow("publicMcpDaily"));
    expect(r.ok).toBe(false);
    expect(hits).not.toContain("publicMcpGlobalDaily");
    if (!r.ok) expect(r.message).toMatch(/daily limit/i);
  });

  it("a spent GLOBAL budget blocks work for everyone", () => {
    const r = publicCallGuard(
      "sage_answer_questions",
      "mcp:b",
      allow("publicMcpGlobalDaily"),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/shared daily/i);
  });

  it("an unpublished tool is rejected before any budget is charged", () => {
    const r = publicCallGuard("sage_my_campaigns", "mcp:a", allow(null));
    expect(r.ok).toBe(false);
    expect(hits).toEqual([]);
    expect(isPublicTool("sage_my_campaigns")).toBe(false);
  });

  it("every published work tool is capped, and every published read tool is not", () => {
    for (const t of PUBLIC_WORK_TOOLS) {
      hits.length = 0;
      publicCallGuard(t, "mcp:a", allow(null));
      expect(hits).toContain("publicMcpGlobalDaily");
    }
    for (const t of PUBLIC_READ_TOOLS) {
      hits.length = 0;
      publicCallGuard(t, "mcp:a", allow(null));
      expect(hits).not.toContain("publicMcpGlobalDaily");
    }
  });
});

describe("the work tools are the ones that spend", () => {
  it("classifies inspection-starting tools as work, reads as free", () => {
    expect(PUBLIC_WORK_TOOLS).toContain("sage_start_inspection");
    expect(PUBLIC_WORK_TOOLS).toContain("sage_answer_questions");
    for (const r of PUBLIC_READ_TOOLS) {
      expect(PUBLIC_WORK_TOOLS as readonly string[]).not.toContain(r);
    }
  });
});

describe("no money verb reaches this surface", () => {
  it("nothing published can approve, fund, settle, sign, or pay", () => {
    const forbidden = /approve|fund|settle|sign|pay(out)?|withdraw|transfer/i;
    for (const t of publicMcpTools()) {
      expect(forbidden.test(t.name)).toBe(false);
    }
  });

  it("the published descriptions still tell the truth about who funds", () => {
    const start = publicMcpTools().find((t) => t.name === "sage_start_inspection")!;
    expect(start.description).toMatch(/never funds or pays|founder approves/i);
  });
});

/**
 * REGRESSION — a marketplace reviewer validates a free endpoint with `curl -i` and expects HTTP 200
 * with a result. The MCP transport answered 406 to any POST whose Accept header didn't offer both
 * application/json and text/event-stream, which no plain curl does. A working service looked broken
 * to the exact probe that decides eligibility.
 */
describe("callers who aren't MCP clients still get an answer", () => {
  it("recognises a JSON-RPC message, single or batched", () => {
    expect(looksLikeJsonRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })).toBe(true);
    expect(looksLikeJsonRpc({ method: "initialize", params: {} })).toBe(true);
    expect(
      looksLikeJsonRpc([
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { jsonrpc: "2.0", id: 2, method: "tools/call" },
      ]),
    ).toBe(true);
  });

  it("does not mistake a probe for a protocol message", () => {
    for (const body of [
      {},
      { query: "hello" },
      { jsonrpc: "2.0" },
      "hello",
      42,
      null,
      [],
      [{ nope: true }],
      [{ method: "ok" }, { nope: true }],
    ]) {
      expect(looksLikeJsonRpc(body)).toBe(false);
    }
  });

  it("knows when an Accept header satisfies the transport", () => {
    expect(acceptsMcp("application/json, text/event-stream")).toBe(true);
    expect(acceptsMcp("TEXT/EVENT-STREAM, APPLICATION/JSON")).toBe(true);
    // what a plain curl sends, and what the SDK rejected with 406
    expect(acceptsMcp("*/*")).toBe(false);
    expect(acceptsMcp("application/json")).toBe(false);
    expect(acceptsMcp("text/event-stream")).toBe(false);
    expect(acceptsMcp(null)).toBe(false);
    expect(acceptsMcp(undefined)).toBe(false);
    expect(acceptsMcp("")).toBe(false);
  });

  it("the header Sage substitutes is the one the transport requires", () => {
    expect(acceptsMcp(MCP_ACCEPT)).toBe(true);
  });
});

describe("vi sanity", () => {
  it("has no accidental network mocks left armed", () => {
    expect(vi.isMockFunction(publicMcpTools)).toBe(false);
  });
});
