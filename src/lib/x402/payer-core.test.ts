import { describe, expect, it, vi } from "vitest";
import {
  extractOrder,
  guardedFee,
  paywallDecision,
  runOperatorFee,
  runPayAndCall,
  settleStatus,
  type MerchantClient,
} from "./payer-core";

function mockRes(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

const ORDER_402 = {
  x402: true,
  orderId: "ord_1",
  payTo: "0x00000000000000000000000000000000000ME12",
  amountWei: "100000",
  tokenContract: "0x3022b87ac063DE95b1570F46f5e470F8B53112D8",
  chainId: 2345,
  paymentMethod: "transfer",
};

describe("extractOrder", () => {
  it("pulls the order fields from a 402 body", () => {
    const o = extractOrder(ORDER_402);
    expect(o).not.toBeNull();
    expect(o!.orderId).toBe("ord_1");
    expect(o!.amountWei).toBe("100000");
    expect(o!.paymentMethod).toBe("transfer");
  });
  it("returns null when required fields are missing", () => {
    expect(extractOrder({ orderId: "x" })).toBeNull();
    expect(extractOrder(null)).toBeNull();
  });
});

describe("runPayAndCall — RAIL 1 handshake", () => {
  it("executes the real flow: 402 → transfer USDC → confirm → retry with proof", async () => {
    const calls: { headers: Record<string, string> }[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ headers: (init?.headers ?? {}) as Record<string, string> });
      return calls.length === 1
        ? mockRes(402, ORDER_402)
        : mockRes(200, { text: "the evidence", ok: true });
    }) as unknown as typeof fetch;
    const transfer = vi.fn(async () => ({ txHash: "0xPAYMENTTX" }));
    const client: MerchantClient = {
      createOrder: vi.fn(),
      waitForConfirmation: vi.fn(async () => ({ status: "PAYMENT_CONFIRMED" })),
    };

    const r = await runPayAndCall<{ text: string; ok: boolean }>({
      url: "http://localhost/api/verify/evidence",
      body: { url: "https://example.org" },
      live: true,
      fetchImpl,
      transfer,
      client,
    });

    expect(r.bypassed).toBe(false);
    expect(r.paymentTx).toBe("0xPAYMENTTX"); // a REAL tx, never simulated
    expect(r.result).toEqual({ text: "the evidence", ok: true });
    // paid the order's payTo for the order's exact amount
    expect(transfer).toHaveBeenCalledWith(ORDER_402.payTo, "100000");
    // confirmed before retrying, then retried WITH the payment proof header
    expect(client.waitForConfirmation).toHaveBeenCalledWith("ord_1", expect.anything());
    expect(calls[1].headers["x-payment-order"]).toBe("ord_1");
    expect(calls[1].headers["x-payment-tx"]).toBe("0xPAYMENTTX");
  });

  it("bypasses with NO payment when the rail is not live", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      mockRes(200, { text: "ev", ok: true, headers: init }),
    ) as unknown as typeof fetch;
    const transfer = vi.fn();

    const r = await runPayAndCall<{ text: string }>({
      url: "http://localhost/x",
      body: {},
      live: false,
      fetchImpl,
      transfer,
      client: null,
    });

    expect(r.bypassed).toBe(true);
    expect(r.paymentTx).toBeNull();
    expect(transfer).not.toHaveBeenCalled(); // no on-chain movement, ever
  });

  it("confirms a DIRECT merchant that settles to INVOICED (not PAYMENT_CONFIRMED)", async () => {
    // The live rail proved DIRECT merchants terminate at INVOICED, with the tx
    // recorded + a signed proof. Waiting only for PAYMENT_CONFIRMED hung forever.
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      return headers["x-payment-order"]
        ? mockRes(200, { text: "the evidence", ok: true })
        : mockRes(402, ORDER_402);
    }) as unknown as typeof fetch;
    const transfer = vi.fn(async () => ({ txHash: "0xINVOICEDTX" }));
    const client: MerchantClient = {
      createOrder: vi.fn(),
      waitForConfirmation: vi.fn(async () => ({
        status: "INVOICED",
        txHash: "0xINVOICEDTX",
      })),
    };

    const r = await runPayAndCall<{ text: string; ok: boolean }>({
      url: "http://localhost/api/verify/evidence",
      body: { url: "https://example.org" },
      live: true,
      fetchImpl,
      transfer,
      client,
    });

    expect(r.bypassed).toBe(false);
    expect(r.paymentTx).toBe("0xINVOICEDTX");
    expect(r.result).toEqual({ text: "the evidence", ok: true });
  });

  it("rejects a terminal FAILED order rather than serving unpaid", async () => {
    const fetchImpl = vi.fn(async () =>
      mockRes(402, ORDER_402),
    ) as unknown as typeof fetch;
    const transfer = vi.fn(async () => ({ txHash: "0xTX" }));
    const client: MerchantClient = {
      createOrder: vi.fn(),
      waitForConfirmation: vi.fn(async () => ({ status: "FAILED" })),
    };
    await expect(
      runPayAndCall({
        url: "http://localhost/x",
        body: {},
        live: true,
        fetchImpl,
        transfer,
        client,
      }),
    ).rejects.toThrow(/not confirmed \(FAILED\)/);
  });

  it("refuses to pay an unsupported (eip3009) flow rather than guess", async () => {
    const fetchImpl = vi.fn(async () =>
      mockRes(402, { ...ORDER_402, paymentMethod: "eip3009-signature" }),
    ) as unknown as typeof fetch;
    const transfer = vi.fn();
    await expect(
      runPayAndCall({
        url: "http://localhost/x",
        body: {},
        live: true,
        fetchImpl,
        transfer,
        client: null,
      }),
    ).rejects.toThrow(/unsupported payment method/);
    expect(transfer).not.toHaveBeenCalled();
  });
});

describe("runOperatorFee — RAIL 2 direct payment", () => {
  it("creates an order, transfers to its payTo, confirms, returns the real tx", async () => {
    const client: MerchantClient = {
      createOrder: vi.fn(async () => ({
        orderId: "fee_ord",
        payToAddress: "0x00000000000000000000000000000000000ME12",
        amountWei: "100000",
        tokenContract: "0xUSDC",
        flow: "ERC20_DIRECT",
      })),
      waitForConfirmation: vi.fn(async () => ({ status: "PAYMENT_CONFIRMED" })),
    };
    const transfer = vi.fn(async () => ({ txHash: "0xFEETX" }));
    const r = await runOperatorFee({
      dappOrderId: "fee-1",
      fromAddress: "0xagent",
      tokenContract: "0xUSDC",
      chainId: 2345,
      amountWei: "100000",
      transfer,
      client,
    });
    expect(r.paymentTx).toBe("0xFEETX");
    expect(r.orderId).toBe("fee_ord");
    expect(transfer).toHaveBeenCalledWith("0x00000000000000000000000000000000000ME12", "100000");
  });
});

describe("guardedFee — a fee NEVER blocks or fails a payout", () => {
  it("returns settled on success", async () => {
    const out = await guardedFee(async () => ({ paymentTx: "0xok", orderId: "o1" }));
    expect(out).toEqual({ status: "settled", paymentTx: "0xok", orderId: "o1" });
  });
  it("swallows a thrown payment into a pending outcome (never rethrows)", async () => {
    const out = await guardedFee(async () => {
      throw new Error("facilitator down");
    });
    expect(out.status).toBe("pending");
    if (out.status === "pending") expect(out.error).toMatch(/facilitator down/);
  });
});

describe("paywallDecision — middleware verdict table", () => {
  it("bypasses when not live", () => {
    expect(paywallDecision({ live: false, orderId: null, confirmed: false })).toBe("bypass");
    expect(paywallDecision({ live: false, orderId: "x", confirmed: true })).toBe("bypass");
  });
  it("requires payment when live with no order header", () => {
    expect(paywallDecision({ live: true, orderId: null, confirmed: false })).toBe("require-payment");
  });
  it("serves when the order is confirmed, pends otherwise", () => {
    expect(paywallDecision({ live: true, orderId: "o", confirmed: true })).toBe("serve");
    expect(paywallDecision({ live: true, orderId: "o", confirmed: false })).toBe("pending");
  });
});

describe("settleStatus — GOAT order status → settlement outcome", () => {
  const cases: [string, "paid" | "failed" | "pending"][] = [
    ["INVOICED", "paid"], // DIRECT merchant terminal (the live-verified case)
    ["PAYMENT_CONFIRMED", "paid"], // DELEGATE-custody terminal
    ["FAILED", "failed"],
    ["EXPIRED", "failed"],
    ["CANCELLED", "failed"],
    ["CHECKOUT_VERIFIED", "pending"], // pre-payment, still cancellable
    ["", "pending"],
    ["SOMETHING_NEW", "pending"], // unknown → in-flight, never falsely "paid"
  ];
  for (const [status, expected] of cases) {
    it(`${status || "(empty)"} → ${expected}`, () => {
      expect(settleStatus(status)).toBe(expected);
    });
  }
});
