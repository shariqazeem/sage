import { NextResponse } from "next/server";
import { erc20Abi, getAddress, type Address } from "viem";
import { getSessionAddress } from "@/lib/auth/session";
import { publicClient } from "@/lib/deputy/chain";
import { chainConfig, DEFAULT_EVM_LAUNCH_CHAIN, GOAT_USDC, isPausedNetwork, pausedNetworkReason } from "@/lib/deputy/networks";
import { computeDomainSeparator, readTokenState, VALID_FOR_SECONDS } from "@/lib/privy/recipient-withdraw";
import { TRANSFER_GAS_UNITS } from "@/lib/treasury/gas-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether this network's USDC takes a signed transfer (EIP-3009), so Sage's operator can send a
 * withdrawal the wallet only signs. GOAT's does. Metis m.USDC does not (no DOMAIN_SEPARATOR, no
 * version, no nonces: measured 26 Oct 2026), so on Metis the wallet sends its own transfer and pays
 * its own small fee, as every account does there. Asked of the token itself, once per process.
 */
const gaslessByToken = new Map<string, boolean>();
async function takesSignedTransfers(chainId: number, token: Address, holder: Address): Promise<boolean> {
  const key = `${chainId}:${token.toLowerCase()}`;
  const known = gaslessByToken.get(key);
  if (known !== undefined) return known;
  const ok = await readTokenState(chainId, token, holder)
    .then((s) => computeDomainSeparator(s.name, s.version, chainId, token).toLowerCase() === s.domainSeparator.toLowerCase())
    .catch(() => false);
  gaslessByToken.set(key, ok);
  return ok;
}

/**
 * The signed-in wallet's own money on one network: where to deposit, what it holds, and how a
 * withdrawal leaves (signed for Sage to send, or sent by the wallet with its own fee). EVM sessions
 * only. An email sign-in and a MetaMask sign-in read exactly the same thing: the session's address.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const wallet = await getSessionAddress();
  if (!wallet) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const address = getAddress(wallet);
  const asked = Number(new URL(req.url).searchParams.get("chainId"));
  const chainId = Number.isFinite(asked) && chainConfig(asked).chainId === asked && chainConfig(asked).evm ? asked : DEFAULT_EVM_LAUNCH_CHAIN;
  const cfg = chainConfig(chainId);
  const token = getAddress(cfg.usdcAddress ?? GOAT_USDC);
  try {
    const client = publicClient(chainId);
    // A plain balanceOf: every ERC-20 answers it, whatever else the token supports.
    const [balance, nativeWei, gasPrice, gasless] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
      client.getBalance({ address }),
      client.getGasPrice(),
      takesSignedTransfers(chainId, token, address),
    ]);
    // What the wallet's own transfer costs, priced as Sage prices every write (+20%), at the gas limit it is sent with.
    const feeWei = ((gasPrice * BigInt(12)) / BigInt(10)) * TRANSFER_GAS_UNITS;
    return NextResponse.json({
      ok: true,
      address,
      chainId,
      network: cfg.name,
      token,
      usdcBase: balance.toString(),
      usd: Number(balance) / 1_000_000,
      explorerUrl: `${cfg.explorerUrl}/address/${address}`,
      validForSeconds: VALID_FOR_SECONDS,
      gasless,
      nativeSymbol: cfg.nativeSymbol,
      nativeWei: nativeWei.toString(),
      feeWei: feeWei.toString(),
      legacyGas: cfg.gas === "legacy",
      paused: isPausedNetwork(chainId),
      pausedReason: pausedNetworkReason(chainId),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "could not read the balance" }, { status: 502 });
  }
}
