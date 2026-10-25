import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SAGE AS A SELLER ON ITS OWN METIS FACILITATOR. The facilitator's checks are tested where they live;
 * these pin the seller's own promises: the requirements are Sage's (never the caller's), nothing runs
 * or settles for a payment that didn't verify, and a call is served only once its payment settled.
 */
const h = vi.hoisted(() => ({
  ready: { ok: true } as { ok: boolean; status?: number; message?: string },
  verify: vi.fn(),
  settle: vi.fn(),
}));

vi.mock("./http", () => ({
  facilitatorReady: async () => (h.ready.ok ? { ok: true, config: { proxy: "0xC5Df359394de02F8E04bfb650E250b20a33BEe6a" }, chain: {} } : { ok: false, status: h.ready.status, message: h.ready.message }),
  verifyDepsFor: () => ({}),
  settleDepsFor: () => ({}),
}));
vi.mock("./verify", () => ({ verifyPayment: (...a: unknown[]) => h.verify(...a) }));
vi.mock("./settle", () => ({ settlePayment: (...a: unknown[]) => h.settle(...a) }));

import { metisSellerGate, metisSellerPayTo, readMetisPayment } from "./seller";

const PAY_TO = "0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3";
const payload = { x402Version: 2, accepted: {}, payload: { signature: "0x" } };
const withPayment = () => new Headers({ "payment-signature": Buffer.from(JSON.stringify(payload)).toString("base64") });

beforeEach(() => {
  h.ready = { ok: true };
  h.verify.mockReset();
  h.settle.mockReset();
  process.env.X402_METIS_PAY_TO = PAY_TO;
});

describe("the Metis seller gate", () => {
  it("asks for the tool's own price, paid to Sage, through the Metis proxy, when no payment is presented", async () => {
    const g = await metisSellerGate("sage_first_look", new Headers(), "https://sagepays.xyz/mcp/metis/sage_first_look");
    expect(g.kind).toBe("challenge");
    if (g.kind !== "challenge") return;
    expect(g.challenge.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "eip155:1088",
      amount: "50000", // $0.05
      asset: "0xEA32A96608495e54156Ae48931A7c20f0dcc1a21",
      payTo: PAY_TO,
      extra: { assetTransferMethod: "permit2", permit2Proxy: "0xC5Df359394de02F8E04bfb650E250b20a33BEe6a" },
    });
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("verifies against SAGE's requirements and settles before serving", async () => {
    h.verify.mockResolvedValue({ isValid: true, payer: "0x1111111111111111111111111111111111111111" });
    h.settle.mockResolvedValue({ success: true, transaction: "0xabc", network: "eip155:1088", payer: "0x1111111111111111111111111111111111111111", amount: "300000" });
    const g = await metisSellerGate("sage_start_inspection", withPayment(), "https://sagepays.xyz/mcp/metis/sage_start_inspection");
    expect(g).toMatchObject({ kind: "paid", settlement: { transaction: "0xabc" } });
    const [body] = h.verify.mock.calls[0]!;
    expect((body as { paymentRequirements: { amount: string; payTo: string } }).paymentRequirements).toMatchObject({ amount: "300000", payTo: PAY_TO });
    expect(h.settle).toHaveBeenCalledTimes(1);
  });

  it("never settles a payment that didn't verify, and says why", async () => {
    h.verify.mockResolvedValue({ isValid: false, invalidReason: "invalid_exact_evm_payload_signature", invalidMessage: "The signature doesn't match the payer." });
    const g = await metisSellerGate("sage_first_look", withPayment(), "u");
    expect(g).toMatchObject({ kind: "rejected", reason: "invalid_exact_evm_payload_signature" });
    expect(h.settle).not.toHaveBeenCalled();
  });

  it("does not serve a payment that verified but did not settle", async () => {
    h.verify.mockResolvedValue({ isValid: true });
    h.settle.mockResolvedValue({ success: false, errorReason: "settlement_pending", transaction: "0xdef", network: "eip155:1088" });
    expect(await metisSellerGate("sage_first_look", withPayment(), "u")).toMatchObject({ kind: "rejected", reason: "settlement_pending" });
  });

  it("is closed while the facilitator is off, for a tool that isn't sold, or with nowhere to be paid", async () => {
    h.ready = { ok: false, status: 404, message: "Not found" };
    expect(await metisSellerGate("sage_first_look", new Headers(), "u")).toMatchObject({ kind: "closed", status: 404 });
    h.ready = { ok: true };
    expect(await metisSellerGate("sage_get_proof", new Headers(), "u")).toMatchObject({ kind: "closed", status: 404 });
    delete process.env.X402_METIS_PAY_TO;
    const prev = process.env.SAGE_BILLING_ADDRESS;
    delete process.env.SAGE_BILLING_ADDRESS;
    expect(await metisSellerGate("sage_first_look", new Headers(), "u")).toMatchObject({ kind: "closed", status: 503 });
    if (prev) process.env.SAGE_BILLING_ADDRESS = prev;
  });
});

describe("reading the payment and the payee", () => {
  it("reads base64 or bare JSON from any header a client uses", () => {
    expect(readMetisPayment(new Headers({ "x-payment": JSON.stringify(payload) }))).toMatchObject({ x402Version: 2 });
    expect(readMetisPayment(withPayment())).toMatchObject({ x402Version: 2 });
    expect(readMetisPayment(new Headers())).toBeNull();
    expect(readMetisPayment(new Headers({ "payment-signature": "not json" }))).toBeNull();
  });
  it("is paid at X402_METIS_PAY_TO, else the billing address, else nowhere", () => {
    expect(metisSellerPayTo({ X402_METIS_PAY_TO: PAY_TO })).toBe(PAY_TO);
    expect(metisSellerPayTo({ SAGE_BILLING_ADDRESS: PAY_TO.toLowerCase() })).toBe(PAY_TO);
    expect(metisSellerPayTo({ X402_METIS_PAY_TO: "not an address" })).toBeNull();
    expect(metisSellerPayTo({})).toBeNull();
  });
});
