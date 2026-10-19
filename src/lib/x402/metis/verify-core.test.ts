import { describe, expect, it } from "vitest";
import { encodeErrorResult, getAddress, parseAbi, recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { M_USDC, M_USDT, PERMIT2_ABI, PERMIT2_DOMAIN, PERMIT2_WITNESS_TYPES, PROXY_BUILDS, REASON } from "./constants";
import { parseFacilitatorRequest } from "./parse";
import type { Check, ParsedPayment } from "./types";
import {
  checkPayment,
  describeRevert,
  isNonceUsed,
  judgeChainFacts,
  judgeClaim,
  judgeSimulation,
  nonceWordPos,
  recoverPermit2Signer,
  type StaticPolicy,
} from "./verify-core";
import { NOW, OTHER_KEY, PAY_TO, edited, signedPayment } from "./testing";

const policy: StaticPolicy = { proxy: PROXY_BUILDS.paris.address, assets: [M_USDC.address], payToAllowlist: null };

function parsed(body: unknown): ParsedPayment {
  const r = parseFacilitatorRequest(body);
  if (!r.ok) throw new Error(`fixture did not parse: ${r.reason} ${r.message}`);
  return r.payment;
}

/** Parse and run every static check; a parse refusal is reported as a failed check. */
async function verdict(body: unknown, pol: StaticPolicy = policy, now: number = NOW): Promise<Check> {
  const r = parseFacilitatorRequest(body);
  if (!r.ok) return { ok: false, reason: r.reason, message: r.message };
  return checkPayment(r.payment, pol, now);
}

const reasonOf = (c: Check): string | null => (c.ok ? null : c.reason);

describe("a correctly signed Permit2 payment", () => {
  it("passes every static check, the signature recovering to the payer", async () => {
    const { body, payer } = await signedPayment();
    expect(await verdict(body)).toEqual({ ok: true });
    expect(await recoverPermit2Signer(parsed(body))).toBe(payer.address);
  });

  it("passes with m.USDT once the facilitator accepts it", async () => {
    const { body } = await signedPayment({ asset: M_USDT.address });
    expect(reasonOf(await verdict(body))).toBe(REASON.invalidPaymentRequirements);
    expect(await verdict(body, { ...policy, assets: [M_USDC.address, M_USDT.address] })).toEqual({ ok: true });
  });
});

describe("refused: wrong network", () => {
  it("a payment for Base, signed for Base", async () => {
    const { body } = await signedPayment({ network: "eip155:8453", signedChainId: 8453 });
    expect(reasonOf(await verdict(body))).toBe(REASON.invalidNetwork);
  });

  it("requirements on Metis, payment accepted for another network", async () => {
    const { body } = await signedPayment({ acceptedNetwork: "eip155:8453" });
    expect(reasonOf(await verdict(body))).toBe(REASON.networkMismatch);
  });

  it("right network in the JSON, but signed over another chain's Permit2 domain", async () => {
    const { body } = await signedPayment({ signedChainId: 8453 });
    expect(reasonOf(await verdict(body))).toBe(REASON.permit2InvalidSignature);
  });
});

describe("refused: wrong asset", () => {
  it("requirements in a token this facilitator does not settle", async () => {
    const other = getAddress("0x036cbd53842c5426634e7929541ec2318f3dcf7e");
    const { body } = await signedPayment({ asset: other });
    expect(reasonOf(await verdict(body))).toBe(REASON.invalidPaymentRequirements);
  });

  it("a permit for m.USDT against requirements in m.USDC", async () => {
    const { body } = await signedPayment({ token: M_USDT.address });
    expect(reasonOf(await verdict(body, { ...policy, assets: [M_USDC.address, M_USDT.address] }))).toBe(
      REASON.permit2TokenMismatch,
    );
  });
});

describe("refused: wrong amount (exact means exact)", () => {
  it("short: the permit authorizes less than the price", async () => {
    const { body } = await signedPayment({ amount: BigInt(9_999), requirementAmount: BigInt(10_000) });
    const c = await verdict(body);
    expect(reasonOf(c)).toBe(REASON.permit2AmountMismatch);
    expect(c.ok ? "" : c.message).toMatch(/less/);
  });

  it("over: the permit authorizes more than the price", async () => {
    const { body } = await signedPayment({ amount: BigInt(10_001), requirementAmount: BigInt(10_000) });
    expect(reasonOf(await verdict(body))).toBe(REASON.permit2AmountMismatch);
  });

  it("the payment accepted a different price than the requirements", async () => {
    const { body } = await signedPayment();
    const changed = edited(body, (b) => {
      b.paymentPayload.accepted.amount = "1";
    });
    expect(reasonOf(await verdict(changed))).toBe(REASON.invalidPaymentRequirements);
  });

  it("a zero price", async () => {
    const { body } = await signedPayment({ amount: BigInt(0), requirementAmount: BigInt(0) });
    expect(reasonOf(await verdict(body))).toBe(REASON.invalidPaymentRequirements);
  });
});

describe("refused: wrong payTo", () => {
  it("the signed witness sends the money somewhere other than payTo", async () => {
    const { body } = await signedPayment({ witnessTo: getAddress("0x857b06519e91e3a54538791bdbb0e22373e36b66") });
    expect(reasonOf(await verdict(body))).toBe(REASON.permit2RecipientMismatch);
  });

  it("payTo rewritten after signing, in both places", async () => {
    const { body } = await signedPayment();
    const other = "0x857b06519E91e3A54538791bDbb0E22373e36b66";
    const changed = edited(body, (b) => {
      b.paymentRequirements.payTo = other;
      b.paymentPayload.accepted.payTo = other;
      b.paymentPayload.payload.permit2Authorization.witness.to = other;
    });
    expect(reasonOf(await verdict(changed))).toBe(REASON.permit2InvalidSignature);
  });

  it("a payee outside X402_METIS_PAY_TO_ALLOWLIST", async () => {
    const { body } = await signedPayment();
    const only = getAddress("0x857b06519e91e3a54538791bdbb0e22373e36b66");
    expect(reasonOf(await verdict(body, { ...policy, payToAllowlist: [only] }))).toBe(REASON.invalidPaymentRequirements);
    expect(await verdict(body, { ...policy, payToAllowlist: [PAY_TO] })).toEqual({ ok: true });
  });
});

describe("refused: outside the validity window", () => {
  it("an expired deadline", async () => {
    const { body } = await signedPayment({ deadline: BigInt(NOW - 1) });
    expect(reasonOf(await verdict(body))).toBe(REASON.permit2DeadlineExpired);
  });

  it("a deadline inside the reference's 6-second margin", async () => {
    const { body } = await signedPayment({ deadline: BigInt(NOW + 5) });
    expect(reasonOf(await verdict(body))).toBe(REASON.permit2DeadlineExpired);
    const { body: fine } = await signedPayment({ deadline: BigInt(NOW + 6) });
    expect(await verdict(fine)).toEqual({ ok: true });
  });

  it("validAfter in the future", async () => {
    const { body } = await signedPayment({ validAfter: BigInt(NOW + 60) });
    expect(reasonOf(await verdict(body))).toBe(REASON.permit2NotYetValid);
  });
});

describe("refused: a bad signature", () => {
  it("signed by someone other than the payer", async () => {
    const { body } = await signedPayment({ signer: privateKeyToAccount(OTHER_KEY) });
    expect(reasonOf(await verdict(body))).toBe(REASON.permit2InvalidSignature);
  });

  it("the amount lowered after signing, consistently everywhere", async () => {
    const { body } = await signedPayment();
    const changed = edited(body, (b) => {
      b.paymentRequirements.amount = "1";
      b.paymentPayload.accepted.amount = "1";
      b.paymentPayload.payload.permit2Authorization.permitted.amount = "1";
    });
    expect(reasonOf(await verdict(changed))).toBe(REASON.permit2InvalidSignature);
  });

  it("v = 0/1: viem would recover it, Permit2's ecrecover would not, so neither does this", async () => {
    const { body, payer } = await signedPayment();
    const sig = body.paymentPayload.payload.signature as Hex;
    const v = parseInt(sig.slice(130), 16);
    const lowV = `${sig.slice(0, 130)}${(v - 27).toString(16).padStart(2, "0")}` as Hex;
    const p = parsed(body);
    // the premise: viem alone accepts the 0/1 form
    expect(
      await recoverTypedDataAddress({
        domain: PERMIT2_DOMAIN,
        types: PERMIT2_WITNESS_TYPES,
        primaryType: "PermitWitnessTransferFrom",
        message: {
          permitted: { token: p.token, amount: p.amount },
          spender: p.spender,
          nonce: p.nonce,
          deadline: p.deadline,
          witness: { to: p.witnessTo, validAfter: p.validAfter },
        },
        signature: lowV,
      }),
    ).toBe(payer.address);
    const changed = edited(body, (b) => {
      b.paymentPayload.payload.signature = lowV;
    });
    expect(reasonOf(await verdict(changed))).toBe(REASON.permit2InvalidSignature);
  });

  it("a 64-byte or garbage signature", async () => {
    const { body } = await signedPayment();
    const short = edited(body, (b) => {
      b.paymentPayload.payload.signature = b.paymentPayload.payload.signature.slice(0, 130);
    });
    expect(reasonOf(await verdict(short))).toBe(REASON.permit2InvalidSignature);
    const junk = edited(body, (b) => {
      b.paymentPayload.payload.signature = `0x${"11".repeat(65)}`;
    });
    expect(reasonOf(await verdict(junk))).toBe(REASON.permit2InvalidSignature);
    const notHex = edited(body, (b) => {
      b.paymentPayload.payload.signature = "hello";
    });
    expect(reasonOf(await verdict(notHex))).toBe(REASON.invalidPayload);
  });
});

describe("refused: a payment the chain would refuse anyway", () => {
  it("names the canonical proxy as spender, which cannot run on Metis", async () => {
    const { body } = await signedPayment({ spender: PROXY_BUILDS.canonical.address });
    expect(reasonOf(await verdict(body))).toBe(REASON.permit2InvalidSpender);
  });

  it("an EIP-3009 payload: m.USDC has no transferWithAuthorization", async () => {
    const { body } = await signedPayment();
    const eip3009 = edited(body, (b) => {
      const inner = b.paymentPayload.payload as unknown as Record<string, unknown>;
      delete inner.permit2Authorization;
      inner.authorization = { from: PAY_TO, to: PAY_TO, value: "1", validAfter: "0", validBefore: "1", nonce: "0x00" };
    });
    expect(reasonOf(await verdict(eip3009))).toBe(REASON.eip3009NotSupported);
  });

  it("requirements that do not ask for the permit2 method", async () => {
    const { body } = await signedPayment({ assetTransferMethod: null });
    expect(reasonOf(await verdict(body))).toBe(REASON.invalidPaymentRequirements);
    const { body: eip } = await signedPayment({ assetTransferMethod: "eip3009" });
    expect(reasonOf(await verdict(eip))).toBe(REASON.invalidPaymentRequirements);
  });
});

describe("strict parsing", () => {
  it("x402Version must be 2, top level and inside", async () => {
    const { body } = await signedPayment();
    expect(reasonOf(await verdict(edited(body, (b) => void (b.x402Version = 1))))).toBe(REASON.invalidX402Version);
    expect(reasonOf(await verdict(edited(body, (b) => void (b.paymentPayload.x402Version = 1))))).toBe(
      REASON.invalidX402Version,
    );
  });

  it("money fields are decimal strings that fit a uint256, nothing else", async () => {
    const { body } = await signedPayment();
    const asNumber = edited(body, (b) => {
      (b.paymentPayload.payload.permit2Authorization.permitted as unknown as Record<string, unknown>).amount = 10000;
    });
    expect(reasonOf(await verdict(asNumber))).toBe(REASON.invalidPayload);
    const asHex = edited(body, (b) => void (b.paymentPayload.payload.permit2Authorization.nonce = "0x10"));
    expect(reasonOf(await verdict(asHex))).toBe(REASON.invalidPayload);
    const tooBig = edited(body, (b) => void (b.paymentPayload.payload.permit2Authorization.deadline = `1${"0".repeat(78)}`));
    expect(reasonOf(await verdict(tooBig))).toBe(REASON.invalidPayload);
    const negative = edited(body, (b) => void (b.paymentRequirements.amount = "-1"));
    expect(reasonOf(await verdict(negative))).toBe(REASON.invalidPaymentRequirements);
  });

  it("a refusal still names the payer when it can", async () => {
    const { body, payer } = await signedPayment();
    const r = parseFacilitatorRequest(edited(body, (b) => void (b.x402Version = 3)));
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.payer).toBe(payer.address);
  });
});

describe("chain facts and replay", () => {
  const facts = { payerHasCode: false, allowance: BigInt(10_000), balance: BigInt(10_000), nonceBitmap: BigInt(0) };

  it("passes when Permit2 is approved, the balance covers it and the nonce is unspent", async () => {
    const { body } = await signedPayment();
    expect(judgeChainFacts(parsed(body), facts)).toEqual({ ok: true });
  });

  it("refuses a payer who has not approved Permit2 (the one-time approval)", async () => {
    const { body } = await signedPayment();
    expect(reasonOf(judgeChainFacts(parsed(body), { ...facts, allowance: BigInt(9_999) }))).toBe(
      REASON.permit2AllowanceRequired,
    );
  });

  it("refuses a balance that does not cover the payment", async () => {
    const { body } = await signedPayment();
    expect(reasonOf(judgeChainFacts(parsed(body), { ...facts, balance: BigInt(9_999) }))).toBe(
      REASON.permit2InsufficientBalance,
    );
  });

  it("refuses a contract payer: Permit2 would verify it through EIP-1271, not this signature", async () => {
    const { body } = await signedPayment();
    expect(reasonOf(judgeChainFacts(parsed(body), { ...facts, payerHasCode: true }))).toBe(REASON.permit2InvalidSignature);
  });

  it("REPLAY: refuses a nonce Permit2 has already spent", async () => {
    const { body } = await signedPayment();
    const p = parsed(body);
    const spent = BigInt(1) << (p.nonce & BigInt(255));
    expect(reasonOf(judgeChainFacts(p, { ...facts, nonceBitmap: spent }))).toBe(REASON.permit2InvalidNonce);
    // a different bit in the same word is a different nonce
    const neighbour = BigInt(1) << ((p.nonce + BigInt(1)) & BigInt(255));
    expect(judgeChainFacts(p, { ...facts, nonceBitmap: neighbour })).toEqual({ ok: true });
  });

  it("REPLAY: refuses a payment the ledger has settled or is settling, allows a failed one", () => {
    expect(reasonOf(judgeClaim("settled"))).toBe(REASON.permit2InvalidNonce);
    expect(reasonOf(judgeClaim("pending"))).toBe(REASON.permit2InvalidNonce);
    expect(reasonOf(judgeClaim("settling"))).toBe(REASON.permit2InvalidNonce);
    expect(reasonOf(judgeClaim("mismatch"))).toBe(REASON.permit2InvalidNonce);
    expect(judgeClaim("failed")).toEqual({ ok: true });
    expect(judgeClaim(null)).toEqual({ ok: true });
  });

  it("Permit2's bitmap positions: word = nonce >> 8, bit = nonce & 255", () => {
    const nonce = BigInt(5 * 256 + 7);
    expect(nonceWordPos(nonce)).toBe(BigInt(5));
    expect(isNonceUsed(BigInt(1) << BigInt(7), nonce)).toBe(true);
    expect(isNonceUsed(BigInt(1) << BigInt(6), nonce)).toBe(false);
  });
});

describe("simulation verdicts name the revert", () => {
  it("decodes Permit2, proxy and token reverts", () => {
    const expired = encodeErrorResult({ abi: PERMIT2_ABI, errorName: "SignatureExpired", args: [BigInt(1)] });
    expect(describeRevert(expired)).toBe("SignatureExpired(1)");
    expect(describeRevert(encodeErrorResult({ abi: PERMIT2_ABI, errorName: "InvalidSigner" }))).toBe("InvalidSigner");
    const transferFailed = encodeErrorResult({
      abi: parseAbi(["error Error(string)"]),
      errorName: "Error",
      args: ["TRANSFER_FROM_FAILED"],
    });
    expect(describeRevert(transferFailed)).toBe("Error(TRANSFER_FROM_FAILED)");
    expect(describeRevert("0x")).toBe("reverted without data");
    const c = judgeSimulation({ ok: false, revertData: expired });
    expect(reasonOf(c)).toBe(REASON.permit2SimulationFailed);
    expect(judgeSimulation({ ok: true })).toEqual({ ok: true });
  });
});
