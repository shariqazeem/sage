import "server-only";

import { RpcProvider } from "starknet";

import { starknetAddresses } from "./config";

/**
 * A wallet's USDC balance on Starknet, in 6-decimal base units — or null when it cannot be read.
 *
 * Read-only: uses the public read config (no signing key), so a page can show a founder what their
 * own wallet holds without any secret present. Null, not a throw: a balance the page cannot read is
 * a line the page leaves out, never a page that fails to render.
 */
export async function starknetUsdcBalance(address: string): Promise<bigint | null> {
  const cfg = starknetAddresses();
  if (!cfg || !/^0x[0-9a-fA-F]+$/.test(address.trim())) return null;
  try {
    const provider = new RpcProvider({ nodeUrl: cfg.rpcUrl });
    // A slow node must not hold the page: the balance is a line, not the page.
    const r = await Promise.race([
      provider.callContract({ contractAddress: cfg.token, entrypoint: "balanceOf", calldata: [address.trim()] }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000)),
    ]);
    return (BigInt(r[1] ?? 0) << BigInt(128)) + BigInt(r[0] ?? 0);
  } catch {
    return null;
  }
}
