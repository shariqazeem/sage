import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";

import {
  buildOkxChallenge,
  encodeChallenge,
  priceToMinimal,
  readPaymentHeader,
  verifyOkxPayment,
  okxPayTo,
  OKX_REVIEW_ADDRESS,
  okxReviewAddress,
  OKX_ASSET,
  OKX_CHAIN_ID,
  OKX_NETWORK,
} from "./okx";

/**
 * THE PAYMENT CHECK IS THE ONLY THING BETWEEN PAID WORK AND FREE WORK.
 *
 * A buyer's signature over an EIP-3009 authorization IS the money: nothing else is submitted, no
 * transaction is sent, and Sage serves the call on the strength of that signature alone. So each
 * test below is a way an attacker gets the work without paying for it — an authorization payable
 * somewhere else, one for a smaller amount, one whose fields were edited after signing, one that
 * expired. Accepting any of them is indistinguishable from having no paywall.
 */

const PAYER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const PAY_TO = getAddress("0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3");
const OTHER = getAddress("0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6");
const NOW = 1_800_000_000;

const DOMAIN = {
  name: "USD₮0",
  version: "1",
  chainId: OKX_CHAIN_ID,
  verifyingContract: getAddress(OKX_ASSET),
} as const;

const TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const NONCE = `0x${"11".repeat(32)}` as const;

/** Sign an authorization the way a real buyer's wallet does, then package it as the header. */
async function signedHeader(
  over: Partial<{ to: string; value: string; validAfter: string; validBefore: string; nonce: string }> = {},
  tamper: Partial<{ to: string; value: string }> = {},
): Promise<string> {
  const auth = {
    from: PAYER.address,
    to: over.to ?? PAY_TO,
    value: over.value ?? "50000",
    validAfter: over.validAfter ?? "0",
    validBefore: over.validBefore ?? String(NOW + 300),
    nonce: over.nonce ?? NONCE,
  };
  const signature = await PAYER.signTypedData({
    domain: DOMAIN,
    types: TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: auth.from as `0x${string}`,
      to: auth.to as `0x${string}`,
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce as `0x${string}`,
    },
  });
  // The tamper happens AFTER signing — exactly what an attacker who wants a discount would do.
  const sent = { ...auth, ...tamper };
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      scheme: "exact",
      network: OKX_NETWORK,
      payload: { signature, authorization: sent },
    }),
  ).toString("base64");
}

const expected = { payTo: PAY_TO, minAmount: "50000" };

describe("a genuine payment is accepted", () => {
  it("verifies, and reports the payer and the nonce it consumed", async () => {
    const v = await verifyOkxPayment(await signedHeader(), expected, NOW);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.payer).toBe(PAYER.address);
    expect(v.nonce).toBe(NONCE.toLowerCase());
    expect(v.signature.startsWith("0x")).toBe(true);
  });

  it("accepts overpayment, because more than the price is still payment", async () => {
    const v = await verifyOkxPayment(await signedHeader({ value: "90000" }), expected, NOW);
    expect(v.ok).toBe(true);
  });

  it("reads the header under any of the names a client may use", async () => {
    const header = await signedHeader();
    for (const name of ["PAYMENT", "Payment-Signature", "x-payment"]) {
      expect(readPaymentHeader(new Headers({ [name]: header }))).toBe(header);
    }
  });
});

describe("every way of getting the work without paying for it", () => {
  it("refuses an authorization payable to a different address", async () => {
    const v = await verifyOkxPayment(await signedHeader({ to: OTHER }), expected, NOW);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/different address/i);
  });

  it("refuses an authorization for less than the price", async () => {
    const v = await verifyOkxPayment(await signedHeader({ value: "10000" }), expected, NOW);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/less than/i);
  });

  it("refuses an amount raised after signing", async () => {
    // Signed for 10000, sent claiming 50000. The signature no longer covers the fields.
    const v = await verifyOkxPayment(
      await signedHeader({ value: "10000" }, { value: "50000" }),
      expected,
      NOW,
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/signature/i);
  });

  it("refuses a recipient swapped to us after signing", async () => {
    const v = await verifyOkxPayment(
      await signedHeader({ to: OTHER }, { to: PAY_TO }),
      expected,
      NOW,
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/signature/i);
  });

  it("refuses an expired authorization", async () => {
    const v = await verifyOkxPayment(
      await signedHeader({ validBefore: String(NOW - 1) }),
      expected,
      NOW,
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/expired/i);
  });

  it("refuses one that is not valid yet", async () => {
    const v = await verifyOkxPayment(
      await signedHeader({ validAfter: String(NOW + 60) }),
      expected,
      NOW,
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/not valid yet/i);
  });

  it("refuses a payment on another chain", async () => {
    const header = Buffer.from(
      JSON.stringify({ scheme: "exact", network: "eip155:1", payload: {} }),
    ).toString("base64");
    const v = await verifyOkxPayment(header, expected, NOW);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/eip155:196/);
  });

  it.each([["garbage"], [""], ["eyJub3QiOiJqc29uIn0garbage"]])(
    "refuses an unreadable header %p without throwing",
    async (header) => {
      const v = await verifyOkxPayment(header, expected, NOW);
      expect(v.ok).toBe(false);
    },
  );

  it("refuses an authorization with no signature at all", async () => {
    const header = Buffer.from(
      JSON.stringify({
        scheme: "exact",
        network: OKX_NETWORK,
        payload: {
          authorization: {
            from: PAYER.address,
            to: PAY_TO,
            value: "50000",
            validAfter: "0",
            validBefore: String(NOW + 300),
            nonce: NONCE,
          },
        },
      }),
    ).toString("base64");
    const v = await verifyOkxPayment(header, expected, NOW);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/no signature/i);
  });
});

describe("the challenge says exactly what is owed", () => {
  it("prices in minimal units with no float drift", () => {
    expect(priceToMinimal(0.05)).toBe("50000");
    expect(priceToMinimal(0.1)).toBe("100000");
    expect(priceToMinimal(0.3)).toBe("300000");
    // 0.07 * 1e6 is 70000.00000000001 in binary floating point.
    expect(priceToMinimal(0.07)).toBe("70000");
  });

  it("carries the fields OKX's validator reads, and is decodable from the header", () => {
    const c = buildOkxChallenge({
      resourceUrl: "https://sagepays.xyz/mcp/public/sage_first_look",
      description: "d",
      priceUsd: 0.05,
      payTo: PAY_TO,
    });
    const decoded = JSON.parse(Buffer.from(encodeChallenge(c), "base64").toString("utf8"));
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepts).toHaveLength(1);
    expect(decoded.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "eip155:196",
      amount: "50000",
      asset: OKX_ASSET,
      payTo: PAY_TO,
    });
    // The signer needs the domain fields, or it cannot produce a signature we would accept.
    expect(decoded.accepts[0].extra).toEqual({ name: "USD₮0", version: "1" });
  });
});

describe("the rail is off unless there is somewhere to be paid", () => {
  const saved = process.env.OKX_X402_PAY_TO;
  beforeEach(() => {
    delete process.env.OKX_X402_PAY_TO;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.OKX_X402_PAY_TO;
    else process.env.OKX_X402_PAY_TO = saved;
  });

  it("is off when unset", () => {
    expect(okxPayTo()).toBeNull();
  });

  it("is off when the address is malformed, rather than billing to a broken address", () => {
    process.env.OKX_X402_PAY_TO = "not-an-address";
    expect(okxPayTo()).toBeNull();
  });

  it("checksums the address when it is valid", () => {
    process.env.OKX_X402_PAY_TO = PAY_TO.toLowerCase();
    expect(okxPayTo()).toBe(PAY_TO);
  });
});

describe("OKX's own review probe must reach the service", () => {
  it("reads the header name OKX's seller SDK actually sends", async () => {
    // This was missing, and a missing header name is indistinguishable from an unpaid request:
    // the reviewer signs correctly, we look under three other names, find nothing, and bill again.
    const header = await signedHeader();
    expect(readPaymentHeader(new Headers({ "PAYMENT-SIG": header }))).toBe(header);
  });

  it("accepts a micro-payment from the named review address", async () => {
    // Their probe is deliberately under price. Refusing it fails the availability check for a
    // service that works, which is exactly what happened to all four listings.
    // Only OKX can sign as OKX, so the exemption is pointed at a key this test holds.
    const REVIEWER = privateKeyToAccount(`0x${"07".repeat(32)}`);
    process.env.OKX_X402_REVIEW_ADDRESS = REVIEWER.address;
    const auth = {
      from: REVIEWER.address,
      to: PAY_TO,
      value: "1", // far under the 50000 price
      validAfter: "0",
      validBefore: String(NOW + 300),
      nonce: `0x${"ab".repeat(32)}`,
    };
    const signature = await REVIEWER.signTypedData({
      domain: DOMAIN,
      types: TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: auth.from as `0x${string}`,
        to: auth.to as `0x${string}`,
        value: BigInt(auth.value),
        validAfter: BigInt(0),
        validBefore: BigInt(auth.validBefore),
        nonce: auth.nonce as `0x${string}`,
      },
    });
    const header = Buffer.from(
      JSON.stringify({ scheme: "exact", network: OKX_NETWORK, payload: { signature, authorization: auth } }),
    ).toString("base64");

    const v = await verifyOkxPayment(header, { payTo: PAY_TO, minAmount: "50000" }, NOW);
    delete process.env.OKX_X402_REVIEW_ADDRESS;
    expect(v.ok).toBe(true);
  });

  it("defaults to the address OKX published", () => {
    delete process.env.OKX_X402_REVIEW_ADDRESS;
    expect(okxReviewAddress().toLowerCase()).toBe(OKX_REVIEW_ADDRESS.toLowerCase());
  });

  it("does NOT waive the amount for anyone else", async () => {
    // The waiver is one named address, not a rule about small amounts.
    const v = await verifyOkxPayment(await signedHeader({ value: "1" }), expected, NOW);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/less than/i);
  });

  it("still refuses a review-address payment that is not genuinely signed", async () => {
    // Exempting the amount must not exempt the signature — otherwise anyone could claim to be them.
    const header = Buffer.from(
      JSON.stringify({
        scheme: "exact",
        network: OKX_NETWORK,
        payload: {
          signature: `0x${"11".repeat(65)}`,
          authorization: {
            from: OKX_REVIEW_ADDRESS,
            to: PAY_TO,
            value: "1",
            validAfter: "0",
            validBefore: String(NOW + 300),
            nonce: `0x${"cd".repeat(32)}`,
          },
        },
      }),
    ).toString("base64");
    const v = await verifyOkxPayment(header, { payTo: PAY_TO, minAmount: "50000" }, NOW);
    expect(v.ok).toBe(false);
  });
});
