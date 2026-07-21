import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimit } from "@/lib/rate-limit";

/**
 * P25 — POST /api/agent boundary. The ref is resolved SERVER-SIDE (mocked here); the route must ignore
 * any client-supplied ref, validate + sanitize page context, honor the daily turn cap, and never invoke
 * the agent on an empty/oversized message. runConciergeWeb is stubbed so nothing hits the LLM.
 */

const resolveAgentRef = vi.fn(async () => "anon:route");
const runConciergeWeb = vi.fn(async (...args: unknown[]) => {
  void args;
  return "stub reply";
});
const conciergeEnabled = vi.fn(() => true);

vi.mock("@/lib/auth/agent-session", () => ({ resolveAgentRef: () => resolveAgentRef() }));
vi.mock("@/lib/telegram/concierge", () => ({
  runConciergeWeb: (...a: unknown[]) => runConciergeWeb(...(a as [])),
  conciergeEnabled: () => conciergeEnabled(),
}));

import { POST } from "./route";

let refCounter = 0;
function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  runConciergeWeb.mockClear();
  resolveAgentRef.mockClear();
  conciergeEnabled.mockReturnValue(true);
  // Unique ref per test → fresh rate-limit buckets (limiters persist on globalThis).
  refCounter += 1;
  resolveAgentRef.mockResolvedValue(`anon:route-${refCounter}`);
});
afterEach(() => vi.clearAllMocks());

describe("POST /api/agent — identity + dispatch", () => {
  it("runs a turn with the server-resolved ref and returns the reply", async () => {
    const res = await post({ text: "hello" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, reply: "stub reply" });
    const [ref, text] = runConciergeWeb.mock.calls[0] as unknown as [string, string];
    expect(ref).toBe(`anon:route-${refCounter}`);
    expect(text).toBe("hello");
  });

  it("IGNORES a client-supplied clientRef — the server ref wins (force-bind)", async () => {
    await post({ text: "hi", clientRef: "anon:ATTACKER", ref: "anon:ATTACKER" });
    const [ref] = runConciergeWeb.mock.calls[0] as unknown as [string];
    expect(ref).toBe(`anon:route-${refCounter}`);
    expect(ref).not.toContain("ATTACKER");
  });
});

describe("POST /api/agent — message validation", () => {
  it("400s an empty message and never calls the agent", async () => {
    const res = await post({ text: "   " });
    expect(res.status).toBe(400);
    expect(runConciergeWeb).not.toHaveBeenCalled();
  });

  it("400s an over-long message", async () => {
    const res = await post({ text: "x".repeat(2001) });
    expect(res.status).toBe(400);
    expect(runConciergeWeb).not.toHaveBeenCalled();
  });

  it("400s a non-JSON body", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/agent — page context sanitation", () => {
  it("passes a well-formed campaign context through verbatim", async () => {
    await post({ text: "status?", pageContext: { kind: "campaign", id: "camp_1" } });
    const arg = runConciergeWeb.mock.calls[0][3];
    expect(arg).toEqual({ kind: "campaign", id: "camp_1", label: undefined });
  });

  it("drops an unknown kind", async () => {
    await post({ text: "hi", pageContext: { kind: "evil", id: "camp_1" } });
    expect(runConciergeWeb.mock.calls[0][3]).toBeUndefined();
  });

  it("drops an id with injection/whitespace (fails the id charset)", async () => {
    await post({ text: "hi", pageContext: { kind: "campaign", id: "camp 1; DROP TABLE" } });
    expect(runConciergeWeb.mock.calls[0][3]).toBeUndefined();
  });

  it("keeps a label but caps its length (untrusted text is still just data)", async () => {
    const label = "A".repeat(400);
    await post({ text: "hi", pageContext: { kind: "proof", id: "0xabc", label } });
    const arg = runConciergeWeb.mock.calls[0][3] as { label: string };
    expect(arg.label.length).toBe(120);
  });
});

describe("POST /api/agent — limits + honesty", () => {
  it("answers with a plain daily-limit message once the per-session cap is spent", async () => {
    const ref = `anon:route-${refCounter}`;
    // Spend the daily cap (AGENT_WEB_DAILY_CAP default 40) so the route's own hit is over the line.
    for (let i = 0; i < 40; i++) rateLimit("agentWebDaily", ref);
    const res = await post({ text: "hello" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply: string };
    expect(body.reply).toContain("today's limit");
    expect(runConciergeWeb).not.toHaveBeenCalled();
  });

  it("is honest when the brain is not configured", async () => {
    conciergeEnabled.mockReturnValue(false);
    const res = await post({ text: "hello" });
    const body = (await res.json()) as { reply: string };
    expect(body.reply).toContain("isn't switched on");
    expect(runConciergeWeb).not.toHaveBeenCalled();
  });
});
