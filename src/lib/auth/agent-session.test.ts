import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P25 identity — resolveAgentRef binds the web agent's clientRef server-side: the SIWE wallet when
 * connected, else a SIGNED anonymous session id in an httpOnly cookie. A tampered cookie is rejected
 * (a fresh id is minted), so a visitor cannot forge or borrow another session's namespace.
 */

let jar: Map<string, { value: string }>;
const setCalls: Array<{ name: string; value: string; opts: Record<string, unknown> }> = [];
let sessionAddr: string | null = null;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => jar.get(name),
    set: (name: string, value: string, opts: Record<string, unknown>) => {
      jar.set(name, { value });
      setCalls.push({ name, value, opts });
    },
  }),
}));
vi.mock("@/lib/auth/session", () => ({ getSessionAddress: async () => sessionAddr }));

import { resolveAgentRef } from "./agent-session";

const COOKIE = "sage_agent_sid";

beforeEach(() => {
  jar = new Map();
  setCalls.length = 0;
  sessionAddr = null;
  process.env.SAGE_SESSION_SECRET = "test-secret-at-least-16-chars-long";
});
afterEach(() => {
  delete process.env.SAGE_SESSION_SECRET;
});

describe("resolveAgentRef — connected wallet", () => {
  it("uses the lowercased SIWE wallet and never touches the anon cookie", async () => {
    sessionAddr = "0xAbC0000000000000000000000000000000000123";
    const ref = await resolveAgentRef();
    expect(ref).toBe("wallet:0xabc0000000000000000000000000000000000123");
    expect(setCalls).toHaveLength(0);
  });
});

describe("resolveAgentRef — anonymous session", () => {
  it("issues a fresh signed httpOnly cookie on first use", async () => {
    const ref = await resolveAgentRef();
    expect(ref).toMatch(/^anon:[a-f0-9]{32}$/);
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].name).toBe(COOKIE);
    expect(setCalls[0].opts.httpOnly).toBe(true);
    expect(setCalls[0].opts.sameSite).toBe("lax");
  });

  it("is stable across requests carrying a valid cookie (no re-issue)", async () => {
    const first = await resolveAgentRef();
    setCalls.length = 0;
    const second = await resolveAgentRef();
    expect(second).toBe(first);
    expect(setCalls).toHaveLength(0);
  });

  it("REJECTS a tampered cookie and mints a fresh id", async () => {
    const first = await resolveAgentRef();
    const val = jar.get(COOKIE)!.value;
    // Flip the last signature char → HMAC no longer verifies.
    const tampered = val.slice(0, -1) + (val.endsWith("A") ? "B" : "A");
    jar.set(COOKIE, { value: tampered });
    setCalls.length = 0;

    const ref = await resolveAgentRef();
    expect(ref).not.toBe(first);
    expect(ref).toMatch(/^anon:[a-f0-9]{32}$/);
    expect(setCalls).toHaveLength(1); // a new signed cookie was issued
  });

  it("rejects a cookie with no signature separator", async () => {
    jar.set(COOKIE, { value: "deadbeefdeadbeefdeadbeefdeadbeef" }); // id, no `.sig`
    const ref = await resolveAgentRef();
    expect(setCalls).toHaveLength(1); // treated as absent → fresh issue
    expect(ref).toMatch(/^anon:[a-f0-9]{32}$/);
  });
});
