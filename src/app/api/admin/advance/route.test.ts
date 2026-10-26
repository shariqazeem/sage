import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE OPERATOR'S ADVANCE DOOR, ON METIS (26 Oct 2026): bound by the same rules as the self-serve one, through
 * the same disburseAdvance: the published formula, one active advance, the pot's balance, and the
 * borrower's approval before a cent goes out.
 */
const p = vi.hoisted(() => ({
  allowance: BigInt(10_000_000),
  sendUsdc: vi.fn<(...a: unknown[]) => Promise<string>>(async () => `0x${"d1".repeat(32)}`),
}));
vi.mock("@/lib/advance/pot", () => ({
  POT_CHAIN_ID: 1088,
  POT_MIN_METIS_WEI: BigInt("5000000000000000"),
  MIN_ADVANCE_BASE: BigInt(100_000),
  potConfig: () => ({ ok: true, pot: { address: "0x2222222222222222222222222222222222222222", token: "0xEA32A96608495e54156Ae48931A7c20f0dcc1a21", account: {} } }),
  potBalances: async () => ({ usdcBase: BigInt(10_000_000), metisWei: BigInt("500000000000000000") }),
  allowanceToPot: async () => p.allowance,
  potSendUsdc: (...a: unknown[]) => p.sendUsdc(...a),
  potReceipt: async () => "success",
}));
const walletCreditSignals = vi.fn();
const advanceCapacityUsd = vi.fn((..._a: unknown[]) => 1.0);
vi.mock("@/lib/campaigns/credit", () => ({
  walletCreditSignals: (...a: unknown[]) => walletCreditSignals(...(a as [string])),
  advanceCapacityUsd: (...a: unknown[]) => advanceCapacityUsd(...(a as [never, number])),
}));

import { POST } from "./route";
import { db } from "@/lib/db";
import { advances, advanceRepayments } from "@/lib/db/schema";

const W = "0x00000000000000000000000000000000000000cc";
const call = (body: unknown, secret?: string) =>
  POST(
    new Request("http://test/api/admin/advance", {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { "x-sage-admin-secret": secret } : {}) },
      body: JSON.stringify(body),
    }) as never,
  );

beforeEach(() => {
  process.env.SAGE_ADMIN_SECRET = "s3cr3t";
  db.delete(advanceRepayments).run();
  db.delete(advances).run();
  walletCreditSignals.mockReturnValue({ record: {}, signals: { inflow90dUsd: 3 } });
  advanceCapacityUsd.mockReturnValue(1.0);
  p.allowance = BigInt(10_000_000);
  p.sendUsdc.mockClear();
});

describe("the advance endpoint", () => {
  it("fails CLOSED — no secret configured means 404, wrong secret means 404", async () => {
    delete process.env.SAGE_ADMIN_SECRET;
    expect((await call({ action: "disburse", wallet: W, usd: 0.5 }, "anything")).status).toBe(404);
    process.env.SAGE_ADMIN_SECRET = "s3cr3t";
    expect((await call({ action: "disburse", wallet: W, usd: 0.5 }, "wrong")).status).toBe(404);
    expect(p.sendUsdc).not.toHaveBeenCalled();
  });

  it("THE FORMULA BINDS THE LENDER — over capacity is refused with the arithmetic shown", async () => {
    const res = await call({ action: "disburse", wallet: W, usd: 1.5, multiple: 1 }, "s3cr3t");
    expect(res.status).toBe(409);
    const j = (await res.json()) as { error: string };
    expect(j.error).toContain("$1.00"); // the capacity, named
    expect(p.sendUsdc).not.toHaveBeenCalled();
  });

  it("no record → capacity is $0.00 and nothing moves", async () => {
    walletCreditSignals.mockReturnValue(null);
    const res = await call({ action: "disburse", wallet: W, usd: 0.1 }, "s3cr3t");
    expect(res.status).toBe(409);
    expect(p.sendUsdc).not.toHaveBeenCalled();
  });

  it("a dry run prices the advance and creates NOTHING", async () => {
    const res = await call({ action: "disburse", wallet: W, usd: 0.5, dryRun: true }, "s3cr3t");
    expect(res.status).toBe(200);
    expect(p.sendUsdc).not.toHaveBeenCalled();
    expect(db.select().from(advances).all()).toHaveLength(0);
  });

  it("disburses within capacity once the borrower approved: the row, and the transfer to their wallet", async () => {
    const res = await call({ action: "disburse", wallet: W, usd: 0.5, waterfallBps: 5000 }, "s3cr3t");
    expect(res.status).toBe(200);
    const j = (await res.json()) as { disburseTx: string; explorerUrl: string };
    expect(j.disburseTx).toBe(`0x${"d1".repeat(32)}`);
    expect(j.explorerUrl).toContain(j.disburseTx);
    expect(p.sendUsdc).toHaveBeenCalledTimes(1);
    const [row] = db.select().from(advances).all();
    expect(row).toMatchObject({ outstandingBase: 500_000, status: "active", chainId: 1088, disburseClaimSecret: null });
    const hist = await call({ action: "history", wallet: W }, "s3cr3t");
    const h = (await hist.json()) as { advances: Array<{ disburseClaimSecret: string | null }> };
    expect(h.advances[0].disburseClaimSecret).toBeNull();
  });

  it("sends nothing until the borrower has approved repayment", async () => {
    p.allowance = BigInt(0);
    const res = await call({ action: "disburse", wallet: W, usd: 0.5 }, "s3cr3t");
    expect(res.status).toBe(409);
    expect(p.sendUsdc).not.toHaveBeenCalled();
    expect(db.select().from(advances).all()).toHaveLength(0);
  });

  it("one active advance per borrower — the second is refused in words", async () => {
    await call({ action: "disburse", wallet: W, usd: 0.3 }, "s3cr3t");
    const res = await call({ action: "disburse", wallet: W, usd: 0.3 }, "s3cr3t");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/already has an active advance/);
  });

  it("a failed send answers 502 and leaves no row: nothing moved, nothing owed", async () => {
    p.sendUsdc.mockRejectedValueOnce(new Error("node down"));
    const res = await call({ action: "disburse", wallet: W, usd: 0.5 }, "s3cr3t");
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/Nothing moved and nothing is owed/);
    expect(db.select().from(advances).all()).toHaveLength(0);
  });
});
