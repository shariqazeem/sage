import "server-only";
import { createWalletClient, http, type Address, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { publicClient } from "./chain";
import { chainConfig, viemChainFor } from "./networks";

/**
 * A NATIVE (gas-token) transfER FROM THE OPERATOR — kept OUT of the frozen signer, which only ever
 * writes to vaults. Used for one thing: a bounded gas stipend to a wallet that already holds the
 * USDC for its launch. Same key, same chain registry, same 1559-then-legacy strategy.
 */
function operatorKey(chainId: number): `0x${string}` {
  const raw = (chainConfig(chainId).chainId === 2345 ? process.env.GOAT_AGENT_PRIVATE_KEY : (process.env.OPERATOR_PRIVATE_KEY ?? process.env.PRIVATE_KEY))?.trim();
  if (!raw) throw new Error("operator key not configured");
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

export function operatorAddressFor(chainId: number): Address {
  return privateKeyToAccount(operatorKey(chainId)).address;
}

export async function operatorNativeBalanceWei(chainId: number): Promise<bigint> {
  return publicClient(chainId).getBalance({ address: operatorAddressFor(chainId) });
}

export async function sendNative(chainId: number, to: Address, valueWei: bigint): Promise<Hash> {
  const account = privateKeyToAccount(operatorKey(chainId));
  const chain = viemChainFor(chainId);
  const cfg = chainConfig(chainId);
  const wallet = createWalletClient({ account, chain, transport: http(cfg.writeRpcUrl ?? cfg.rpcUrl) });
  const legacyPrice = async () => ((await publicClient(chainId).getGasPrice()) * BigInt(12)) / BigInt(10);
  const send = (gasPrice?: bigint) => wallet.sendTransaction({ account, chain, to, value: valueWei, gas: BigInt(21_000), ...(gasPrice != null ? { gasPrice } : {}) });
  if (cfg.gas === "legacy") return send(await legacyPrice());
  try {
    return await send();
  } catch {
    return send(await legacyPrice());
  }
}
