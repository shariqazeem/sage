import { describe, expect, it } from "vitest";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type Address,
  type Hex,
  type TransactionSerializedLegacy,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ERC20_ABI, EXACT_PROXY_ABI, M_USDC, M_USDT, METIS_CHAIN_ID, PROXY_BUILDS, SETTLE_GAS_CAP } from "./constants";
import { parseFacilitatorRequest } from "./parse";
import {
  CONSUMED_AFTER_SECONDS,
  DEADLINE_GRACE_SECONDS,
  DROP_AFTER_SECONDS,
  buildLegacySettleTx,
  decidePending,
  encodeSettleCall,
  paymentKey,
  settleGasLimit,
  transferMatches,
  type LogLike,
  type PendingFacts,
} from "./settle-core";
import type { ParsedPayment } from "./types";
import { FACILITATOR_KEY, NOW, PAY_TO, signedPayment } from "./testing";

async function payment(): Promise<ParsedPayment> {
  const { body } = await signedPayment();
  const r = parseFacilitatorRequest(body);
  if (!r.ok) throw new Error(r.message);
  return r.payment;
}

function transferLog(token: Address, from: Address, to: Address, value: bigint): LogLike {
  return {
    address: token,
    topics: encodeEventTopics({ abi: ERC20_ABI, eventName: "Transfer", args: { from, to } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
  };
}

describe("the settle transaction is LEGACY (type 0), for Metis", () => {
  it("signs to a pre-EIP-1559 transaction with an EIP-155 chain id and a gasPrice", async () => {
    const p = await payment();
    const facilitator = privateKeyToAccount(FACILITATOR_KEY);
    const tx = buildLegacySettleTx({
      proxy: PROXY_BUILDS.paris.address,
      data: encodeSettleCall(p),
      gas: BigInt(160_000),
      gasPrice: BigInt(16_000_000_000),
      nonce: 7,
    });
    const serialized = await facilitator.signTransaction(tx);
    // An RLP list (0xc0..0xff), not a typed envelope (0x01 access-list, 0x02 EIP-1559, 0x04 7702).
    expect(parseInt(serialized.slice(2, 4), 16)).toBeGreaterThanOrEqual(0xc0);
    const parsed = parseTransaction(serialized);
    expect(parsed.type).toBe("legacy");
    expect(parsed.chainId).toBe(METIS_CHAIN_ID);
    expect(parsed.gasPrice).toBe(BigInt(16_000_000_000));
    expect(parsed.gas).toBe(BigInt(160_000));
    expect(parsed.nonce).toBe(7);
    expect("maxFeePerGas" in parsed && parsed.maxFeePerGas !== undefined).toBe(false);
    expect(parsed.to && getAddress(parsed.to)).toBe(PROXY_BUILDS.paris.address);
    expect(parsed.value ?? BigInt(0)).toBe(BigInt(0));
    expect(
      await recoverTransactionAddress({ serializedTransaction: serialized as TransactionSerializedLegacy }),
    ).toBe(facilitator.address);
  });

  it("calls settle(permit, owner, witness, signature) with exactly the signed payment", async () => {
    const p = await payment();
    const { functionName, args } = decodeFunctionData({ abi: EXACT_PROXY_ABI, data: encodeSettleCall(p) });
    expect(functionName).toBe("settle");
    expect(args).toEqual([
      { permitted: { token: p.token, amount: p.amount }, nonce: p.nonce, deadline: p.deadline },
      p.payer,
      { to: p.witnessTo, validAfter: p.validAfter },
      p.signature,
    ]);
  });

  it("gives the estimate a margin, and refuses one above the cap", () => {
    expect(settleGasLimit(BigInt(121_385))).toBe(BigInt(121_385) + BigInt(30_346) + BigInt(10_000));
    expect(settleGasLimit(BigInt(SETTLE_GAS_CAP))).toBeNull();
  });
});

describe("the payment key is Permit2's replay primitive, not the signature", () => {
  it("is network, payer and nonce", async () => {
    const p = await payment();
    expect(paymentKey(p.payer, p.nonce)).toBe(`eip155:1088:${p.payer.toLowerCase()}:${p.nonce.toString()}`);
  });

  it("is the same for a re-encoded (high-s) signature of the same permit", async () => {
    const { body } = await signedPayment();
    const sig = body.paymentPayload.payload.signature as Hex;
    const n = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
    const s = BigInt(`0x${sig.slice(66, 130)}`);
    const v = parseInt(sig.slice(130), 16);
    const flipped = `${sig.slice(0, 66)}${(n - s).toString(16).padStart(64, "0")}${(v === 27 ? 28 : 27).toString(16)}`;
    expect(flipped).not.toBe(sig);
    const copy = JSON.parse(JSON.stringify(body)) as typeof body;
    copy.paymentPayload.payload.signature = flipped;
    const a = parseFacilitatorRequest(body);
    const b = parseFacilitatorRequest(copy);
    if (!a.ok || !b.ok) throw new Error("fixture did not parse");
    expect(a.payment.signature).not.toBe(b.payment.signature);
    expect(paymentKey(a.payment.payer, a.payment.nonce)).toBe(paymentKey(b.payment.payer, b.payment.nonce));
  });
});

describe("transfer correctness: exactly one Transfer of amount of asset to payTo", () => {
  const payer = getAddress("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
  const e = { asset: M_USDC.address, from: payer, to: PAY_TO, amount: BigInt(10_000) };

  it("matches the one transfer", () => {
    expect(transferMatches([transferLog(M_USDC.address, payer, PAY_TO, BigInt(10_000))], e)).toBe(true);
  });

  it("ignores logs from other contracts", () => {
    const logs = [
      transferLog(M_USDT.address, payer, PAY_TO, BigInt(10_000)),
      { address: PROXY_BUILDS.paris.address, topics: [keccak256("0x01")], data: "0x" as Hex },
      transferLog(M_USDC.address, payer, PAY_TO, BigInt(10_000)),
    ];
    expect(transferMatches(logs, e)).toBe(true);
  });

  it("refuses a wrong amount, a wrong recipient, none, or two", () => {
    expect(transferMatches([transferLog(M_USDC.address, payer, PAY_TO, BigInt(9_999))], e)).toBe(false);
    expect(transferMatches([transferLog(M_USDC.address, payer, payer, BigInt(10_000))], e)).toBe(false);
    expect(transferMatches([], e)).toBe(false);
    const one = transferLog(M_USDC.address, payer, PAY_TO, BigInt(10_000));
    expect(transferMatches([one, one], e)).toBe(false);
    expect(transferMatches([one, transferLog(M_USDC.address, payer, payer, BigInt(1))], e)).toBe(false);
  });
});

describe("deciding about a broadcast whose outcome is unknown", () => {
  const payer = getAddress("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
  const e = { asset: M_USDC.address, from: payer, to: PAY_TO, amount: BigInt(10_000) };
  const base: PendingFacts = {
    receipt: { status: "unknown" },
    permit2NonceUsed: false,
    facilitatorConfirmedNonce: 7,
    txNonce: 7,
    broadcastAgeSeconds: 5,
    nowSeconds: NOW,
    deadline: BigInt(NOW + 300),
  };

  it("a receipt decides it", () => {
    const ok = { status: "success" as const, logs: [transferLog(M_USDC.address, payer, PAY_TO, BigInt(10_000))] };
    expect(decidePending({ ...base, receipt: ok }, e)).toEqual({ kind: "settled" });
    expect(decidePending({ ...base, receipt: { status: "success", logs: [] } }, e)).toEqual({ kind: "mismatch" });
    expect(decidePending({ ...base, receipt: { status: "reverted" } }, e)).toEqual({ kind: "reverted" });
  });

  it("no receipt yet, nothing proves anything: still pending", () => {
    expect(decidePending(base, e)).toEqual({ kind: "pending" });
  });

  it("dropped: our nonce went to another transaction, the permit's nonce is unspent, and the nodes had time", () => {
    const f = { ...base, facilitatorConfirmedNonce: 8 };
    expect(decidePending({ ...f, broadcastAgeSeconds: DROP_AFTER_SECONDS - 1 }, e)).toEqual({ kind: "pending" });
    expect(decidePending({ ...f, broadcastAgeSeconds: DROP_AFTER_SECONDS }, e)).toEqual({ kind: "dropped" });
  });

  it("expired: past the deadline and its grace with the nonce unspent", () => {
    const at = (s: number) => decidePending({ ...base, nowSeconds: NOW + 300 + s }, e);
    expect(at(DEADLINE_GRACE_SECONDS)).toEqual({ kind: "pending" });
    expect(at(DEADLINE_GRACE_SECONDS + 1)).toEqual({ kind: "expired" });
  });

  it("a spent nonce with no receipt of ours waits for the receipt, then reads as someone else's", () => {
    const f = { ...base, permit2NonceUsed: true, facilitatorConfirmedNonce: 8 };
    expect(decidePending({ ...f, broadcastAgeSeconds: DROP_AFTER_SECONDS }, e)).toEqual({ kind: "pending" });
    expect(decidePending({ ...f, nowSeconds: NOW + 10_000, broadcastAgeSeconds: CONSUMED_AFTER_SECONDS - 1 }, e)).toEqual({
      kind: "pending",
    });
    expect(decidePending({ ...f, broadcastAgeSeconds: CONSUMED_AFTER_SECONDS }, e)).toEqual({ kind: "consumed" });
  });
});
