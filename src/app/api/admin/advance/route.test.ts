import { beforeEach, describe, expect, it, vi } from "vitest";

const escrowPayouts = vi.fn(async () => ({ transactionHash: "0xd15b", totalBase: BigInt(0), count: 1 }));
const walletCreditSignals = vi.fn();
const advanceCapacityUsd = vi.fn(() => 1.0);

vi.mock("@/lib/starknet/claims", () => ({ escrowPayouts: (...a: unknown[]) => escrowPayouts(...(a as [])) }));
vi.mock("@/lib/starknet/config", () => ({
  starknetConfig: () => ({ rpcUrl: "https://rpc.test", claimsAddress: "0x6fe", tokenAddress: "0x033", accountAddress: "0x46a1", privateKey: "0x1" }),
}));
vi.mock("@/lib/campaigns/credit", () => ({
  walletCreditSignals: (...a: unknown[]) => walletCreditSignals(...(a as [string])),
  advanceCapacityUsd: (...a: unknown[]) => advanceCapacityUsd(...(a as [never, number])),
}));

import { POST } from "./route";
import { db } from "@/lib/db";
import { advances, advanceRepayments } from "@/lib/db/schema";

const W = "0x4f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434";
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
  escrowPayouts.mockClear();
});

describe("the advance endpoint", () => {
  it("fails CLOSED — no secret configured means 404, wrong secret means 404", async () => {
    delete process.env.SAGE_ADMIN_SECRET;
    expect((await call({ action: "disburse", wallet: W, usd: 0.5 }, "anything")).status).toBe(404);
    process.env.SAGE_ADMIN_SECRET = "s3cr3t";
    expect((await call({ action: "disburse", wallet: W, usd: 0.5 }, "wrong")).status).toBe(404);
    expect(escrowPayouts).not.toHaveBeenCalled();
  });

  it("THE FORMULA BINDS THE LENDER — over capacity is refused with the arithmetic shown", async () => {
    const res = await call({ action: "disburse", wallet: W, usd: 1.5, multiple: 1 }, "s3cr3t");
    expect(res.status).toBe(409);
    const j = (await res.json()) as { error: string };
    expect(j.error).toContain("$1.00"); // the capacity, named
    expect(escrowPayouts).not.toHaveBeenCalled();
  });

  it("no record → capacity is $0.00 and nothing moves", async () => {
    walletCreditSignals.mockReturnValue(null);
    const res = await call({ action: "disburse", wallet: W, usd: 0.1 }, "s3cr3t");
    expect(res.status).toBe(409);
    expect(escrowPayouts).not.toHaveBeenCalled();
  });

  it("a dry run prices the advance and creates NOTHING", async () => {
    const res = await call({ action: "disburse", wallet: W, usd: 0.5, dryRun: true }, "s3cr3t");
    expect(res.status).toBe(200);
    expect(escrowPayouts).not.toHaveBeenCalled();
    expect(db.select().from(advances).all()).toHaveLength(0);
  });

  it("disburses within capacity: row + escrow + a claim link returned ONCE", async () => {
    const res = await call({ action: "disburse", wallet: W, usd: 0.5, waterfallBps: 5000 }, "s3cr3t");
    expect(res.status).toBe(200);
    const j = (await res.json()) as { claimUrl: string; disburseTx: string };
    expect(j.claimUrl).toMatch(/\/claim#0x[0-9a-f]+/);
    expect(j.disburseTx).toBe("0xd15b");
    const [row] = db.select().from(advances).all();
    expect(row.outstandingBase).toBe(500_000);
    expect(row.status).toBe("active");
    // the row keeps the secret for the borrower's dashboard; history redacts it
    const hist = await call({ action: "history", wallet: W }, "s3cr3t");
    const h = (await hist.json()) as { advances: Array<{ disburseClaimSecret: string | null }> };
    expect(h.advances[0].disburseClaimSecret).toBe("(held)");
  });

  it("one active advance per borrower — the second is refused in words", async () => {
    await call({ action: "disburse", wallet: W, usd: 0.3 }, "s3cr3t");
    const res = await call({ action: "disburse", wallet: W, usd: 0.3 }, "s3cr3t");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/already has an active advance/);
  });

  it("escrow failure answers 502 and says the row needs resolving — never a silent half-state", async () => {
    escrowPayouts.mockRejectedValueOnce(new Error("sequencer down"));
    const res = await call({ action: "disburse", wallet: W, usd: 0.5 }, "s3cr3t");
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/DISBURSEMENT FAILED/);
  });
});
