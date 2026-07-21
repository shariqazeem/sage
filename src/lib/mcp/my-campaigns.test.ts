import { describe, expect, it } from "vitest";
import { callSageTool } from "./server";

/**
 * P27 — `sage_my_campaigns` privacy invariant: the founder wallet is bound SERVER-SIDE via
 * `ctx.founderWallet` (the route's resolved SIWE ref), NEVER a tool argument. So the model — or a
 * public MCP caller — can never read another founder's campaigns by supplying a wallet. Runs against
 * the vitest in-memory SQLite (empty), so a bound wallet just yields an empty summary.
 */
const ctx = { scheduleAfter: () => {} };

describe("sage_my_campaigns — wallet is server-bound (privacy)", () => {
  it("refuses when no founder wallet is bound (public MCP / anon web)", async () => {
    const r = await callSageTool("sage_my_campaigns", {}, ctx);
    expect(r?.isError).toBe(true);
    expect(r?.content[0]?.text ?? "").toMatch(/connect/i);
  });

  it("IGNORES a model-supplied wallet arg — only ctx.founderWallet is trusted", async () => {
    // A model (or MCP caller) passing someone else's wallet must NOT read their campaigns.
    const r = await callSageTool(
      "sage_my_campaigns",
      { wallet: "0xVICTIM", founderWallet: "0xVICTIM" },
      ctx,
    );
    expect(r?.isError).toBe(true); // still refused — args are ignored, no wallet is bound
  });

  it("reads ONLY the bound founder wallet's campaigns", async () => {
    const r = await callSageTool("sage_my_campaigns", {}, {
      ...ctx,
      founderWallet: "0x0000000000000000000000000000000000000001",
    });
    expect(r?.isError).toBe(false);
    const data = JSON.parse(r!.content[0]!.text) as { ok: boolean; campaignCount: number };
    expect(data.ok).toBe(true);
    expect(data.campaignCount).toBe(0); // empty in-memory DB
  });
});
