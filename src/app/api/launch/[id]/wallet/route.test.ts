import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const founder = vi.fn();
const prepare = vi.fn();
const record = vi.fn();

vi.mock("@/lib/auth/founder", () => ({ getFounderAddress: () => founder() }));
vi.mock("@/lib/own-wallet/server", () => ({
  prepareOwnWallet: (...a: unknown[]) => prepare(...a),
  recordOwnWallet: (...a: unknown[]) => record(...a),
}));

const EVM = "0x3a60af43c67dd9d552f180d30d9a042948078341";
const VAULT = "0x2222222222222222222222222222222222222222";
let ip = 0;
const req = (body: unknown): NextRequest =>
  new Request("http://localhost/api/launch/job1/wallet", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${++ip}` }, body: JSON.stringify(body) }) as unknown as NextRequest;
const ctx = { params: Promise.resolve({ id: "job1" }) };

beforeEach(() => {
  founder.mockReset().mockResolvedValue(EVM);
  prepare.mockReset();
  record.mockReset();
});

describe("POST /api/launch/<id>/wallet (what the session's own wallet signs)", () => {
  it("hands nothing to a visitor who is not signed in", async () => {
    founder.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(req({ approve: true }), ctx);
    expect(res.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("asks as the SESSION, never as a wallet the body names", async () => {
    prepare.mockResolvedValue({ ok: true, stage: "preview", params: { calls: [] } });
    const { POST } = await import("./route");
    await POST(req({ approve: true, expectedRevision: 4, chainId: 1088, founder: "0x9999999999999999999999999999999999999999", owner: "0x9999999999999999999999999999999999999999" }), ctx);
    expect(prepare).toHaveBeenCalledWith(EVM, "job1", { approve: true, expectedRevision: 4, chainId: 1088 });
  });

  it("approves only when asked to in so many words", async () => {
    prepare.mockResolvedValue({ ok: true, stage: "preview", params: { calls: [] } });
    const { POST } = await import("./route");
    await POST(req({ approve: "yes" }), ctx);
    expect(prepare).toHaveBeenCalledWith(EVM, "job1", { approve: false, expectedRevision: undefined, chainId: undefined });
  });

  it.each([
    ["plan_limit", 402],
    ["not_yours", 403],
    ["network_paused", 400],
    ["not_ready", 409],
    ["plan_changed", 409],
  ])("answers a %s refusal with %i and the door's own sentence", async (reason, status) => {
    prepare.mockResolvedValue({ ok: false, reason, message: "why", upgradeTo: reason === "plan_limit" ? "pro" : undefined });
    const { POST } = await import("./route");
    const res = await POST(req({ approve: true }), ctx);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ ok: false, reason, error: "why", upgradeTo: reason === "plan_limit" ? "pro" : null });
  });
});

describe("POST /api/launch/<id>/wallet/record (the chain decides)", () => {
  it("records nothing for a visitor who is not signed in", async () => {
    founder.mockResolvedValue(null);
    const { POST } = await import("./record/route");
    expect((await POST(req({ vault: VAULT }), ctx)).status).toBe(401);
    expect(record).not.toHaveBeenCalled();
  });

  it("passes the session and the named vault, and nothing else the browser says", async () => {
    record.mockResolvedValue({ ok: true, campaignId: "c1", vault: VAULT });
    const { POST } = await import("./record/route");
    const res = await POST(req({ vault: VAULT, operator: "0x9999999999999999999999999999999999999999", budgetBase: "1", campaignId: "someone-elses" }), ctx);
    expect(record).toHaveBeenCalledWith(EVM, "job1", { vault: VAULT, chainId: undefined });
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, campaignId: "c1", vault: VAULT });
    expect(body.url).toMatch(/\/c\/c1$/);
  });

  it.each([
    ["mismatch", 409],
    ["wrong_vault", 400],
    ["unreadable", 503],
    ["failed", 500],
  ])("answers a %s refusal with %i and what was wrong", async (reason, status) => {
    record.mockResolvedValue({ ok: false, reason, message: "why", mismatches: reason === "mismatch" ? ["operator"] : undefined });
    const { POST } = await import("./record/route");
    const res = await POST(req({ vault: VAULT }), ctx);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ ok: false, reason, error: "why", mismatches: reason === "mismatch" ? ["operator"] : null });
  });
});
