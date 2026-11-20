import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/** The quote route: signed in only, readable amounts only, and the calls pay the session's own wallet. */

const h = vi.hoisted(() => ({ session: null as string | null, quote: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getSessionAddress: async () => h.session }));
vi.mock("@/lib/treasury/swap", () => ({ quoteSwapFor: (...a: unknown[]) => h.quote(...a) }));

import { POST } from "./route";

const req = (body: unknown) =>
  new NextRequest("https://sagepays.xyz/api/wallet/swap-quote", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` } });

beforeEach(() => {
  h.session = null;
  h.quote.mockReset();
});

describe("POST /api/wallet/swap-quote", () => {
  it("asks a stranger to sign in first", async () => {
    const r = await POST(req({ side: "metis_to_usdc", amount: "1" }));
    expect(r.status).toBe(401);
    expect(h.quote).not.toHaveBeenCalled();
  });

  it("refuses an unknown direction or an unreadable amount", async () => {
    h.session = "0x5555555555555555555555555555555555555555";
    expect((await POST(req({ side: "sideways", amount: "1" }))).status).toBe(400);
    expect((await POST(req({ side: "metis_to_usdc", amount: "lots" }))).status).toBe(400);
    expect(h.quote).not.toHaveBeenCalled();
  });

  it("quotes the session's own wallet, in its words, and returns calls that pay it", async () => {
    h.session = "0x5555555555555555555555555555555555555555";
    h.quote.mockResolvedValue({ ok: true, quote: { side: "metis_to_usdc", amountIn: BigInt("1000000000000000000"), amountOut: BigInt(18_000_000), minOut: BigInt(17_820_000), slippageBps: 100, priceImpactBps: 10, metisPriceUsdcBase: BigInt(18_000_000), feeWei: BigInt(1000), venue: "Netswap" } });
    const r = await POST(req({ side: "metis_to_usdc", amount: "1" }));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(h.quote.mock.calls[0]![0]).toBe(h.session);
    expect(h.quote.mock.calls[0]![4]).toMatchObject({ holder: "wallet" });
    expect(j.quote.minOut).toBe("17820000");
    expect(j.calls).toHaveLength(1);
    expect(j.calls[0].value).toBe("1000000000000000000");
  });

  it("passes a refusal through in plain words", async () => {
    h.session = "0x5555555555555555555555555555555555555555";
    h.quote.mockResolvedValue({ ok: false, code: "insufficient", message: "Your wallet holds 0.10 METIS." });
    const r = await POST(req({ side: "metis_to_usdc", amount: "1" }));
    expect(r.status).toBe(422);
    expect((await r.json()).error).toMatch(/Your wallet holds/);
  });
});
