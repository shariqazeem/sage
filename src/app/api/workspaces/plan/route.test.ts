import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { workspaceMembers, workspacePayments, workspaces } from "@/lib/db/schema";
import { createWorkspace, setWorkspacePlan, walletMemberKey } from "@/lib/db/workspaces";

/**
 * PAYING FOR A PLAN, THROUGH THE ROUTE. Sage reads the payment from the chain (mocked here: the
 * receipt reader is the seam), applies it to the founder's own workspace, and never twice. What the
 * founder sends is only WHICH transaction to read; the plan, price and period are the server's.
 */
const founder = vi.fn();
const readPayment = vi.fn();

vi.mock("@/lib/auth/founder", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/founder")>("@/lib/auth/founder");
  return { ...actual, getFounderAddress: () => founder() };
});
vi.mock("@/lib/plans/billing", async () => {
  const actual = await vi.importActual<typeof import("@/lib/plans/billing")>("@/lib/plans/billing");
  return {
    ...actual,
    billingAddress: () => "0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6",
    readPlanPayment: (input: unknown) => readPayment(input),
  };
});
vi.mock("@/lib/treasury/web", () => ({ listWebTreasuries: () => [] }));

const FOUNDER = "0x1111111111111111111111111111111111111111";
const TX = `0x${"a".repeat(64)}`;
const TX2 = `0x${"b".repeat(64)}`;
const post = (body: unknown) => new NextRequest("http://localhost/api/workspaces/plan", { method: "POST", body: JSON.stringify(body) });
const paid = (base: bigint) => ({ ok: true, from: FOUNDER, to: "0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6", amountBase: base });

beforeEach(() => {
  db.delete(workspacePayments).run();
  db.delete(workspaceMembers).run();
  db.delete(workspaces).run();
  founder.mockReset().mockResolvedValue(FOUNDER);
  readPayment.mockReset().mockResolvedValue(paid(BigInt(29_000_000)));
});

describe("POST /api/workspaces/plan", () => {
  it("refuses a visitor who is not signed in", async () => {
    founder.mockResolvedValue(null);
    const { POST } = await import("./route");
    expect((await POST(post({ plan: "pro", chainId: 2345, txHash: TX }))).status).toBe(401);
    expect(readPayment).not.toHaveBeenCalled();
  });

  it("a verified payment puts the founder on the plan (opening a workspace if they had none)", async () => {
    const { POST } = await import("./route");
    const res = await POST(post({ plan: "pro", chainId: 2345, txHash: TX }));
    const body = (await res.json()) as { ok?: boolean; plan?: string; planUntil?: number };
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, plan: "pro" });
    const ws = db.select().from(workspaces).all();
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({ plan: "pro", planUntil: body.planUntil });
    // the price is the server's: the reader was asked for the Pro price, not a number from the body
    expect(readPayment).toHaveBeenCalledWith(expect.objectContaining({ chainId: 2345, minBase: BigInt(29_000_000) }));
  });

  it("the same transaction is applied once", async () => {
    const { POST } = await import("./route");
    expect((await POST(post({ plan: "pro", chainId: 2345, txHash: TX }))).status).toBe(200);
    const again = await POST(post({ plan: "pro", chainId: 2345, txHash: TX }));
    expect(again.status).toBe(409);
    expect(db.select().from(workspacePayments).all()).toHaveLength(1);
  });

  it("a payment the chain doesn't show changes nothing", async () => {
    readPayment.mockResolvedValue({ ok: false, reason: "the transfer was 9.00 USDC; the plan is 29.00 USDC" });
    const { POST } = await import("./route");
    const res = await POST(post({ plan: "pro", chainId: 2345, txHash: TX }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/the plan is 29\.00/);
    expect(db.select().from(workspacePayments).all()).toHaveLength(0);
  });

  it("a smaller plan while a bigger one runs is refused before anything is read", async () => {
    const ws = createWorkspace({ name: "Acme", ownerKey: walletMemberKey(FOUNDER), ownerAddress: FOUNDER });
    setWorkspacePlan(ws.id, "team", Math.floor(Date.now() / 1000) + 10 * 86_400);
    const { POST } = await import("./route");
    const res = await POST(post({ plan: "pro", chainId: 2345, txHash: TX2 }));
    expect(res.status).toBe(409);
    expect(readPayment).not.toHaveBeenCalled();
  });

  it("only plans on Metis or GOAT, and only plans that are bought here", async () => {
    const { POST } = await import("./route");
    expect((await POST(post({ plan: "pro", chainId: 5042, txHash: TX }))).status).toBe(400);
    expect((await POST(post({ plan: "programs", chainId: 2345, txHash: TX }))).status).toBe(400);
    expect(readPayment).not.toHaveBeenCalled();
  });
});
