import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const escrowPayouts = vi.fn(async () => ({ transactionHash: "0xescrow" }));
vi.mock("@/lib/starknet/claims", () => ({ escrowPayouts: (...a: unknown[]) => escrowPayouts(...(a as [])) }));
vi.mock("@/lib/starknet/config", () => ({ starknetConfig: () => ({ accountAddress: "0x46a1", tokenAddress: "0xusdc", rpcUrl: "http://x", claimsAddress: "0xc", privateKey: "0x1" }) }));
vi.mock("@/lib/starknet/claim-link", () => ({ mintClaimSecrets: () => ({ claimCommitment: "0xcc", refundCommitment: "0xrc", claimSecret: "0xsecret" }), claimUrl: (base: string, s: string) => `${base}/claim/${s}` }));
const walletCreditSignals = vi.fn();
const advanceCapacityUsd = vi.fn();
vi.mock("@/lib/campaigns/credit", () => ({ walletCreditSignals: (...a: unknown[]) => walletCreditSignals(...(a as [])), advanceCapacityUsd: (...a: unknown[]) => advanceCapacityUsd(...(a as [])) }));
const evm = vi.fn<() => Promise<string | null>>();
const stark = vi.fn<() => Promise<string | null>>();
vi.mock("@/lib/auth/session", () => ({ getSessionAddress: () => evm() }));
vi.mock("@/lib/auth/starknet-session", () => ({ getStarknetSessionAddress: () => stark() }));

import { GET, POST } from "./route";
import { db } from "@/lib/db";
import { advances } from "@/lib/db/schema";

const OWNER = "0x00000000000000000000000000000000000000aa";
const ctx = { params: Promise.resolve({ wallet: OWNER }) };
const post = (body: unknown) => POST(new NextRequest("http://x/api/record/w/advance", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), ctx);

beforeEach(() => {
  db.delete(advances).run();
  walletCreditSignals.mockReturnValue({ record: {}, signals: { inflow90dUsd: 3 } });
  advanceCapacityUsd.mockReturnValue(1.0);
  evm.mockResolvedValue(null); stark.mockResolvedValue(null);
  escrowPayouts.mockClear();
  process.env.ADVANCE_SELF_SERVE = "1"; process.env.ADVANCE_MAX_USD = "5"; process.env.ADVANCE_MULTIPLE = "1"; process.env.ADVANCE_WATERFALL_BPS = "5000";
});

describe("self-serve advance — the owner takes what the published formula allows, nobody else", () => {
  it("GET publishes the offer: capacity, the operator's max, no secrets", async () => {
    const res = await GET(new NextRequest("http://x"), ctx);
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j).toMatchObject({ ok: true, capacityUsd: 1.0, offerUsd: 1.0, active: null });
    expect(JSON.stringify(j)).not.toMatch(/secret|privateKey/i);
  });
  it("fails closed when not armed, and refuses a stranger", async () => {
    process.env.ADVANCE_SELF_SERVE = "0";
    expect((await post({ usd: 1 })).status).toBe(404);
    process.env.ADVANCE_SELF_SERVE = "1";
    evm.mockResolvedValue("0x00000000000000000000000000000000000000bb");
    const r = await post({ usd: 1 });
    expect(r.status).toBe(403);
    expect(escrowPayouts).not.toHaveBeenCalled();
    expect(db.select().from(advances).all().length).toBe(0);
  });
  it("the owner (either rail, compared by value) takes the offer, gets the claim link once, and cannot take a second", async () => {
    stark.mockResolvedValue("0xaa"); // the same wallet as a Starknet felt without padding
    const r = await post({ usd: 1 });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ ok: true, disburseTx: "0xescrow", usd: 1 });
    expect(j.claimUrl).toMatch(/\/claim\/0xsecret$/);
    expect(escrowPayouts).toHaveBeenCalledTimes(1);
    const again = await post({ usd: 1 });
    expect(again.status).toBe(409);
  });
  it("refuses more than the formula allows, and a failed escrow leaves no moneyless row", async () => {
    evm.mockResolvedValue(OWNER);
    expect((await post({ usd: 1.5 })).status).toBe(409);
    escrowPayouts.mockRejectedValueOnce(new Error("insufficient balance"));
    const r = await post({ usd: 1 });
    expect(r.status).toBe(502);
    expect(db.select().from(advances).all().length).toBe(0); // the borrower can try again later
  });
});
