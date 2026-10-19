import { describe, expect, it } from "vitest";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  getAddress,
  keccak256,
  parseTransaction,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { MetisChain } from "./chain";
import { ERC20_ABI, EXACT_PROXY_ABI, M_USDC, METIS_CHAIN_ID, PERMIT2_ABI, PROXY_BUILDS, REASON } from "./constants";
import { createSendLane, settlePayment, type SettleDeps } from "./settle";
import { paymentKey, type ReceiptFact } from "./settle-core";
import { dbClaimStore } from "./store";
import { FACILITATOR_KEY, NOW, PAYER_KEY, edited, signedPayment } from "./testing";
import type { FacilitatorRequestWire } from "./types";
import { verifyPayment } from "./verify";

/**
 * The verify and settle orchestrators against a fake Metis (no network) and the REAL claim ledger
 * (store.ts on the suite's in-memory SQLite, migrations applied). Each test uses its own Permit2
 * nonce, so the ledger rows of one test never meet another's.
 */

const payer = privateKeyToAccount(PAYER_KEY).address;
const facilitator = privateKeyToAccount(FACILITATOR_KEY);
const proxy = PROXY_BUILDS.paris.address;
const ONE_CENT = BigInt(10_000);

const lc = (a: string) => a.toLowerCase();

/** A small Metis: balances, Permit2 approvals and nonces, and a miner the test controls. */
class FakeMetis implements MetisChain {
  balances = new Map<string, bigint>([[lc(payer), ONE_CENT * BigInt(100)]]);
  allowances = new Map<string, bigint>([[lc(payer), BigInt(2) ** BigInt(255)]]);
  bitmaps = new Map<string, bigint>();
  simulation: { ok: true } | { ok: false; revertData?: Hex } = { ok: true };
  /** What happens to the next sent transaction. */
  mode: "mine" | "revert" | "hold" | "throw" = "mine";
  sent: Hex[] = [];
  receipts = new Map<string, ReceiptFact>();
  confirmed = 0;
  pending = 0;
  gasHeld = BigInt(10) ** BigInt(18);

  async chainId() {
    return METIS_CHAIN_ID;
  }
  async codeHash() {
    return null;
  }
  async hasCode() {
    return false;
  }
  async permit2DomainSeparator() {
    return null;
  }
  async proxyPermit2() {
    return null;
  }
  async proxyWitnessTypehash() {
    return null;
  }
  async proxyWitnessTypeString() {
    return null;
  }
  async balanceOf(_token: Address, owner: Address) {
    return this.balances.get(lc(owner)) ?? BigInt(0);
  }
  async allowance(_token: Address, owner: Address) {
    return this.allowances.get(lc(owner)) ?? BigInt(0);
  }
  async nonceBitmap(owner: Address, wordPos: bigint) {
    return this.bitmaps.get(`${lc(owner)}:${wordPos}`) ?? BigInt(0);
  }
  async simulate() {
    return this.simulation;
  }
  async estimateGas() {
    return BigInt(121_385);
  }
  async gasPrice() {
    return BigInt(13_387_439_848);
  }
  async nativeBalance() {
    return this.gasHeld;
  }
  async transactionCount(_address: Address, tag: "latest" | "pending") {
    return tag === "latest" ? this.confirmed : this.pending;
  }
  /** Spend a Permit2 nonce and emit the payment's Transfer, as settle() would. */
  mine(hash: Hex, serialized: Hex) {
    const tx = parseTransaction(serialized);
    if (!tx.data) throw new Error("no calldata");
    const call = decodeFunctionData({ abi: EXACT_PROXY_ABI, data: tx.data });
    if (call.functionName !== "settle") throw new Error("not a settle call");
    const [permit, owner, witness] = call.args;
    const key = `${lc(owner)}:${permit.nonce >> BigInt(8)}`;
    this.bitmaps.set(key, (this.bitmaps.get(key) ?? BigInt(0)) | (BigInt(1) << (permit.nonce & BigInt(255))));
    this.confirmed += 1;
    this.receipts.set(hash, {
      status: "success",
      logs: [
        {
          address: permit.permitted.token,
          topics: encodeEventTopics({ abi: ERC20_ABI, eventName: "Transfer", args: { from: owner, to: witness.to } }) as Hex[],
          data: encodeAbiParameters([{ type: "uint256" }], [permit.permitted.amount]),
        },
      ],
    });
  }
  async sendRawTransaction(serialized: Hex) {
    if (this.mode === "throw") throw new Error("connection reset");
    const hash = keccak256(serialized);
    this.sent.push(serialized);
    this.pending += 1;
    if (this.mode === "mine") this.mine(hash, serialized);
    if (this.mode === "revert") {
      this.confirmed += 1;
      this.receipts.set(hash, { status: "reverted" });
    }
    return hash;
  }
  async waitForReceipt(hash: Hex) {
    return this.receipts.get(hash) ?? { status: "unknown" as const };
  }
  async receipt(hash: Hex) {
    return this.receipts.get(hash) ?? { status: "unknown" as const };
  }
}

function settleDeps(chain: FakeMetis, clock: { now: number } = { now: NOW }): SettleDeps {
  return {
    config: { account: facilitator, proxy, assets: [M_USDC.address], payToAllowlist: null },
    chain,
    claims: dbClaimStore,
    nowSeconds: () => clock.now,
    lane: createSendLane(),
    takeBroadcastSlot: () => true,
    receiptTimeoutMs: 1_000,
  };
}

let nextNonce = 1_000;
async function freshPayment(): Promise<{ body: FacilitatorRequestWire; key: string }> {
  nextNonce += 1;
  const nonce = BigInt(nextNonce);
  const { body } = await signedPayment({ nonce });
  return { body, key: paymentKey(payer, nonce) };
}

describe("POST /verify is read-only and complete", () => {
  it("a good payment is valid, and verifying it writes nothing", async () => {
    const chain = new FakeMetis();
    const { body, key } = await freshPayment();
    expect(await verifyPayment(body, settleDeps(chain))).toEqual({ isValid: true, payer });
    expect(dbClaimStore.get(key)).toBeNull();
    expect(chain.sent).toEqual([]);
  });

  it("names the missing Permit2 approval", async () => {
    const chain = new FakeMetis();
    chain.allowances.set(lc(payer), BigInt(0));
    const { body } = await freshPayment();
    expect((await verifyPayment(body, settleDeps(chain))).invalidReason).toBe(REASON.permit2AllowanceRequired);
  });

  it("a settle call that would revert is not valid, and says why", async () => {
    const chain = new FakeMetis();
    chain.simulation = { ok: false, revertData: encodeErrorResult({ abi: PERMIT2_ABI, errorName: "InvalidSigner" }) };
    const { body } = await freshPayment();
    const r = await verifyPayment(body, settleDeps(chain));
    expect(r.invalidReason).toBe(REASON.permit2SimulationFailed);
    expect(r.invalidMessage).toContain("InvalidSigner");
  });

  it("REPLAY: a payment already settled is not valid, from the chain and from the ledger", async () => {
    const chain = new FakeMetis();
    const { body } = await freshPayment();
    expect((await settlePayment(body, settleDeps(chain))).success).toBe(true);
    expect((await verifyPayment(body, settleDeps(chain))).invalidReason).toBe(REASON.permit2InvalidNonce);
    // the ledger alone is enough, before the chain shows it
    const fresh = new FakeMetis();
    expect((await verifyPayment(body, settleDeps(fresh))).invalidReason).toBe(REASON.permit2InvalidNonce);
  });
});

describe("POST /settle moves the money once", () => {
  it("settles through the proxy with a legacy transaction and answers with the hash, network and payer", async () => {
    const chain = new FakeMetis();
    const { body, key } = await freshPayment();
    const r = await settlePayment(body, settleDeps(chain));
    expect(chain.sent).toHaveLength(1);
    const tx = parseTransaction(chain.sent[0]!);
    expect(tx.type).toBe("legacy");
    expect(tx.chainId).toBe(METIS_CHAIN_ID);
    expect(tx.to && getAddress(tx.to)).toBe(proxy);
    expect(tx.gasPrice).toBe((BigInt(13_387_439_848) * BigInt(120)) / BigInt(100));
    expect(r).toEqual({
      success: true,
      transaction: keccak256(chain.sent[0]!),
      network: "eip155:1088",
      payer,
      amount: ONE_CENT.toString(),
    });
    expect(dbClaimStore.get(key)).toMatchObject({ status: "settled", txHash: r.transaction });
  });

  it("REPLAY: the same payment again is refused without a second broadcast", async () => {
    const chain = new FakeMetis();
    const { body } = await freshPayment();
    expect((await settlePayment(body, settleDeps(chain))).success).toBe(true);
    const again = await settlePayment(body, settleDeps(chain));
    expect(again.success).toBe(false);
    expect(again.errorReason).toBe(REASON.permit2InvalidNonce);
    expect(again.transaction).toBe("");
    expect(chain.sent).toHaveLength(1);
  });

  it("REPLAY: a re-encoded signature of the same permit is the same payment", async () => {
    const chain = new FakeMetis();
    const { body } = await freshPayment();
    expect((await settlePayment(body, settleDeps(chain))).success).toBe(true);
    const sig = body.paymentPayload.payload.signature;
    const n = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
    const s = BigInt(`0x${sig.slice(66, 130)}`);
    const v = parseInt(sig.slice(130), 16);
    const flipped = edited(body, (b) => {
      b.paymentPayload.payload.signature = `${sig.slice(0, 66)}${(n - s).toString(16).padStart(64, "0")}${(v === 27 ? 28 : 27).toString(16)}`;
    });
    const r = await settlePayment(flipped, settleDeps(chain));
    expect(r.success).toBe(false);
    expect(chain.sent).toHaveLength(1);
  });

  it("REPLAY: two concurrent settles of one payment produce one broadcast and one success", async () => {
    const chain = new FakeMetis();
    const { body } = await freshPayment();
    const deps = settleDeps(chain);
    const results = await Promise.all([settlePayment(body, deps), settlePayment(body, deps), settlePayment(body, deps)]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(chain.sent).toHaveLength(1);
  });

  it("a nonce already used for a DIFFERENT payment is refused", async () => {
    const chain = new FakeMetis();
    const { body } = await freshPayment();
    expect((await settlePayment(body, settleDeps(chain))).success).toBe(true);
    const nonce = BigInt(body.paymentPayload.payload.permit2Authorization.nonce);
    const { body: other } = await signedPayment({ nonce, amount: BigInt(20_000), requirementAmount: BigInt(20_000) });
    const r = await settlePayment(other, settleDeps(chain));
    expect(r.errorReason).toBe(REASON.permit2InvalidNonce);
    expect(chain.sent).toHaveLength(1);
  });
});

describe("a receipt that does not come in time", () => {
  it("answers settlement_pending with the hash, then reconciles to ONE success, never re-sending", async () => {
    const chain = new FakeMetis();
    chain.mode = "hold";
    const { body, key } = await freshPayment();
    const first = await settlePayment(body, settleDeps(chain));
    expect(first).toMatchObject({ success: false, errorReason: REASON.settlementPending });
    expect(first.transaction).toBe(keccak256(chain.sent[0]!));
    expect(dbClaimStore.get(key)?.status).toBe("pending");

    // still in flight: a retry says so again, and sends nothing
    expect((await settlePayment(body, settleDeps(chain))).errorReason).toBe(REASON.settlementPending);
    // it lands
    chain.mine(first.transaction as Hex, chain.sent[0]!);
    const second = await settlePayment(body, settleDeps(chain));
    expect(second).toMatchObject({ success: true, transaction: first.transaction });
    // and that was the only success
    const third = await settlePayment(body, settleDeps(chain));
    expect(third.success).toBe(false);
    expect(chain.sent).toHaveLength(1);
  });

  it("a reverted settle moves nothing; the payment can be settled again", async () => {
    const chain = new FakeMetis();
    chain.mode = "revert";
    const { body, key } = await freshPayment();
    const first = await settlePayment(body, settleDeps(chain));
    expect(first).toMatchObject({ success: false, errorReason: REASON.transactionFailed });
    expect(first.transaction).toBe(keccak256(chain.sent[0]!));
    expect(dbClaimStore.get(key)?.status).toBe("failed");
    chain.mode = "mine";
    expect((await settlePayment(body, settleDeps(chain))).success).toBe(true);
    expect(chain.sent).toHaveLength(2);
  });

  it("a send that fails mid-flight is pending, until the nonce is provably taken by another transaction", async () => {
    const chain = new FakeMetis();
    const clock = { now: NOW };
    chain.mode = "throw";
    const { body, key } = await freshPayment();
    const first = await settlePayment(body, settleDeps(chain, clock));
    expect(first.errorReason).toBe(REASON.settlementPending);
    expect(first.transaction).toMatch(/^0x[0-9a-f]{64}$/);
    expect(dbClaimStore.get(key)?.status).toBe("pending");

    // another payment takes the facilitator's nonce and confirms
    chain.mode = "mine";
    const other = await freshPayment();
    expect((await settlePayment(other.body, settleDeps(chain, clock))).success).toBe(true);
    // too soon to conclude anything from an absence
    expect((await settlePayment(body, settleDeps(chain, clock))).errorReason).toBe(REASON.settlementPending);
    // a minute later: the first transaction can never be mined, nothing moved, so try again
    clock.now += 60;
    const dropped = await settlePayment(body, settleDeps(chain, clock));
    expect(dropped).toMatchObject({ success: false, errorReason: REASON.transactionFailed, transaction: "" });
    const retried = await settlePayment(body, settleDeps(chain, clock));
    expect(retried.success).toBe(true);
  });
});

describe("refusals that cost nothing", () => {
  it("the daily cap: no claim, no broadcast", async () => {
    const chain = new FakeMetis();
    const { body, key } = await freshPayment();
    const r = await settlePayment(body, { ...settleDeps(chain), takeBroadcastSlot: () => false });
    expect(r.errorReason).toBe(REASON.unexpectedSettleError);
    expect(dbClaimStore.get(key)).toBeNull();
    expect(chain.sent).toHaveLength(0);
  });

  it("a facilitator without the METIS for gas does not try", async () => {
    const chain = new FakeMetis();
    chain.gasHeld = BigInt(0);
    const { body, key } = await freshPayment();
    expect((await settlePayment(body, settleDeps(chain))).errorReason).toBe(REASON.unexpectedSettleError);
    expect(dbClaimStore.get(key)).toBeNull();
    expect(chain.sent).toHaveLength(0);
  });

  it("too close to the deadline to be mined in time", async () => {
    const chain = new FakeMetis();
    nextNonce += 1;
    const { body } = await signedPayment({ nonce: BigInt(nextNonce), deadline: BigInt(NOW + 10) });
    expect((await settlePayment(body, settleDeps(chain))).errorReason).toBe(REASON.permit2DeadlineExpired);
    expect(chain.sent).toHaveLength(0);
  });
});
