import { describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { assertSignedLegacy, embeddedSender, ensureMetis, injectedSender, type Eip1193 } from "./browser";
import { legacyTx, type LegacyTx } from "./plan";

const account = privateKeyToAccount(generatePrivateKey());
const FACTORY = "0xdD9a45c181dD95e48CDdC0149C8b821D604C45C9" as const;
const tx: LegacyTx = legacyTx({ chainId: 1088, from: account.address, call: { to: FACTORY, data: "0xdeadbeef" }, gasEstimate: BigInt(100_000), gasPriceWei: BigInt(16_000_000_000) });
const NONCE = 5;

const signLegacy = (over: Partial<{ to: `0x${string}`; data: `0x${string}`; nonce: number; gas: bigint; gasPrice: bigint; chainId: number; value: bigint }> = {}, signer = account) =>
  signer.signTransaction({ type: "legacy", chainId: 1088, to: tx.to, data: tx.data, value: BigInt(0), nonce: NONCE, gas: tx.gas, gasPrice: tx.gasPrice, ...over });

/** A pretend wallet: answers what it is told to, and keeps what it was asked. */
function wallet(answers: Record<string, (params: unknown[]) => unknown>): Eip1193 & { asked: { method: string; params?: unknown[] }[] } {
  const asked: { method: string; params?: unknown[] }[] = [];
  return {
    asked,
    request: async (args) => {
      asked.push(args);
      const answer = answers[args.method];
      if (!answer) throw new Error(`unexpected ${args.method}`);
      return answer(args.params ?? []);
    },
  };
}

describe("an injected wallet (MetaMask, Rabby)", () => {
  it("is sent a type-0 transaction with a gas price, on Metis", async () => {
    const w = wallet({ eth_chainId: () => "0x440", eth_sendTransaction: () => "0xhash" });
    expect(await injectedSender(w)(tx)).toBe("0xhash");
    const sent = w.asked.find((a) => a.method === "eth_sendTransaction")!.params![0] as Record<string, string>;
    expect(sent.type).toBe("0x0");
    expect(BigInt(sent.gasPrice)).toBe(tx.gasPrice);
    expect(BigInt(sent.gas)).toBe(tx.gas);
    expect(sent.from).toBe(account.address);
    expect(sent.to).toBe(FACTORY);
    expect(sent.data).toBe("0xdeadbeef");
    expect(sent).not.toHaveProperty("maxFeePerGas");
    expect(sent).not.toHaveProperty("maxPriorityFeePerGas");
  });

  it("is switched to Metis first, and taught the network when it doesn't know it", async () => {
    let chain = "0x929"; // GOAT
    const w = wallet({
      eth_chainId: () => chain,
      wallet_switchEthereumChain: () => {
        throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
      },
      wallet_addEthereumChain: () => {
        chain = "0x440";
        return null;
      },
      eth_sendTransaction: () => "0xhash",
    });
    await injectedSender(w)(tx);
    expect(w.asked.map((a) => a.method)).toEqual(["eth_chainId", "wallet_switchEthereumChain", "wallet_addEthereumChain", "eth_chainId", "eth_sendTransaction"]);
    const added = w.asked.find((a) => a.method === "wallet_addEthereumChain")!.params![0] as { chainId: string; rpcUrls: string[]; nativeCurrency: { symbol: string } };
    expect(added.chainId).toBe("0x440");
    expect(added.nativeCurrency.symbol).toBe("METIS");
    expect(added.rpcUrls[0]).toMatch(/^https:\/\/andromeda\.metis\.io/);
  });

  it("takes no for an answer: a declined switch is not followed by a second prompt, and nothing is sent", async () => {
    const w = wallet({
      eth_chainId: () => "0x1",
      wallet_switchEthereumChain: () => {
        throw Object.assign(new Error("User rejected"), { code: 4001 });
      },
    });
    await expect(injectedSender(w)(tx)).rejects.toMatchObject({ code: 4001 });
    expect(w.asked.map((a) => a.method)).not.toContain("wallet_addEthereumChain");
    expect(w.asked.map((a) => a.method)).not.toContain("eth_sendTransaction");
  });

  it("sends nothing while the wallet is still on another network", async () => {
    const w = wallet({ eth_chainId: () => "0x1", wallet_switchEthereumChain: () => null });
    await expect(ensureMetis(w)).rejects.toThrow(/isn't on the Metis network/);
  });
});

describe("a Privy embedded wallet: the signed bytes are checked before Metis sees them", () => {
  it("accepts exactly the type-0 transaction that was asked for", async () => {
    await expect(assertSignedLegacy(await signLegacy(), tx, NONCE)).resolves.toBeUndefined();
  });

  it("refuses an EIP-1559 transaction: Metis only takes type 0", async () => {
    const raw = await account.signTransaction({ type: "eip1559", chainId: 1088, to: tx.to, data: tx.data, nonce: NONCE, gas: tx.gas, maxFeePerGas: tx.gasPrice, maxPriorityFeePerGas: BigInt(1) });
    await expect(assertSignedLegacy(raw, tx, NONCE)).rejects.toThrow(/Metis only takes type 0/);
  });

  it.each([
    ["another contract", { to: "0x9999999999999999999999999999999999999999" as const }, /the contract/],
    ["another call", { data: "0xfeedface" as const }, /the call/],
    ["another network", { chainId: 2345 }, /the network/],
    ["a value", { value: BigInt(1) }, /a value/],
    ["another nonce", { nonce: NONCE + 1 }, /the nonce/],
    ["another gas price", { gasPrice: tx.gasPrice * BigInt(100) }, /the fee/],
    ["another gas limit", { gas: tx.gas * BigInt(100) }, /the fee/],
  ])("refuses bytes for %s", async (_n, over, why) => {
    await expect(assertSignedLegacy(await signLegacy(over), tx, NONCE)).rejects.toThrow(why);
  });

  it("refuses bytes signed by a different key", async () => {
    const stranger = privateKeyToAccount(generatePrivateKey());
    await expect(assertSignedLegacy(await signLegacy({}, stranger), tx, NONCE)).rejects.toThrow(/the signer/);
  });

  const pub = (sendRaw = vi.fn(async () => "0xbroadcast" as const)) =>
    ({ getTransactionCount: async () => NONCE, sendRawTransaction: sendRaw }) as unknown as Parameters<typeof embeddedSender>[1] & { sendRawTransaction: typeof sendRaw };

  it("asks for a type-0 signature in Privy's own field names, then broadcasts the checked bytes itself", async () => {
    const raw = await signLegacy();
    const w = wallet({ eth_signTransaction: () => raw });
    const sendRaw = vi.fn(async () => "0xbroadcast" as const);
    expect(await embeddedSender(w, pub(sendRaw))(tx)).toBe("0xbroadcast");
    const asked = w.asked[0].params![0] as Record<string, unknown>;
    expect(asked).toEqual({ from: account.address, to: FACTORY, data: "0xdeadbeef", value: "0x0", nonce: NONCE, gasLimit: `0x${tx.gas.toString(16)}`, gasPrice: `0x${tx.gasPrice.toString(16)}`, chainId: 1088, type: 0 });
    expect(asked).not.toHaveProperty("maxFeePerGas");
    expect(sendRaw).toHaveBeenCalledWith({ serializedTransaction: raw });
  });

  it("broadcasts NOTHING when the wallet hands back something else", async () => {
    const raw = await account.signTransaction({ type: "eip1559", chainId: 1088, to: tx.to, data: tx.data, nonce: NONCE, gas: tx.gas, maxFeePerGas: tx.gasPrice, maxPriorityFeePerGas: BigInt(1) });
    const w = wallet({ eth_signTransaction: () => raw });
    const sendRaw = vi.fn(async () => "0xbroadcast" as const);
    await expect(embeddedSender(w, pub(sendRaw))(tx)).rejects.toThrow(/Nothing was sent/);
    expect(sendRaw).not.toHaveBeenCalled();
  });
});
