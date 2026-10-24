import "server-only";
import { decodeEventLog, encodeFunctionData, erc20Abi, getAddress, parseAbi, type Address, type Hash } from "viem";
import { publicClient } from "@/lib/deputy/chain";
import { chainConfig, explorerTxUrl } from "@/lib/deputy/networks";
import type { AgentWallet } from "@/lib/db/schema";
import { recordAccountMove } from "@/lib/db/account-moves";
import { launchChainConfig } from "@/lib/launch/deployment-service";
import { privyPost } from "@/lib/privy/client";
import { executeViaPrivy } from "@/lib/privy/executor";
import { AccountBusyError, accountBaseSpec, withScopedPolicy } from "@/lib/privy/scoped";
import { buildSwapPolicy, SWAP_METIS_FOR_TOKENS_ABI, SWAP_TOKENS_FOR_METIS_ABI } from "@/lib/privy/swap-policy";
import { formatNative, minLaunchGasWei, needsFeeMessage, SWAP_GAS_UNITS } from "./gas-policy";
import {
  DEFAULT_SLIPPAGE_BPS,
  MAX_PRICE_IMPACT_BPS,
  METIS_SWAP_VENUE,
  MIN_SWAP_METIS_WEI,
  MIN_SWAP_USDC_BASE,
  metisPriceUsdcBase,
  minimumOut,
  priceImpactBps,
  SWAP_DEADLINE_SECONDS,
  swapPath,
  swapsOn,
  type SwapSide,
} from "./swap-venue";

/**
 * SWAP INSIDE THE ACCOUNT: USDC ⇄ METIS on Metis, through Netswap (swap-venue.ts says why that pool).
 *
 * A founder who brings METIS from an exchange turns it into the USDC Sage pays people with; a founder
 * who holds USDC keeps a little METIS for network fees. Both without leaving Sage or connecting a
 * wallet. The account pays the swap's own network fee, in METIS.
 *
 * Three rules hold every swap:
 *   - THE NUMBERS ARE THE CHAIN'S. The quote is the router's own `getAmountsOut`; the price impact is
 *     arithmetic on the pool's reserves. No model is anywhere near an amount.
 *   - THE FOUNDER SEES THE WORST CASE FIRST. A quote carries the least the swap may return (1% under
 *     the quote), the founder confirms that number, and it is the `amountOutMin` the router enforces.
 *     If the price has moved below it by the time the swap is sent, nothing is sent.
 *   - THE PERMIT PINS CUSTODY. The scoped policy allows one router, the confirmed amount, and a payout
 *     to this account only; the wallet is re-locked to its mandate right after (scoped.ts).
 */

const ROUTER_ABI = parseAbi(["function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)"]);
const PAIR_ABI = parseAbi([
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
]);

export interface SwapQuote {
  side: SwapSide;
  /** in the input asset's base units (USDC 6 dp, METIS 18 dp) */
  amountIn: bigint;
  amountOut: bigint;
  /** the least the swap may return; the router refuses anything below it */
  minOut: bigint;
  slippageBps: number;
  priceImpactBps: number;
  /** the pool's mid price: USDC base units for one METIS */
  metisPriceUsdcBase: bigint;
  /** the network fee this swap is expected to cost, in METIS wei */
  feeWei: bigint;
  venue: string;
}

export type SwapRefusal =
  | "not_here"
  | "too_small"
  | "insufficient"
  | "gas"
  | "impact"
  | "quote_failed"
  | "price_moved"
  | "busy"
  | "failed";

export type SwapCheck = { ok: true; quote: SwapQuote } | { ok: false; code: SwapRefusal; message: string };

const usd = (base: bigint) => `$${(Number(base) / 1e6).toFixed(2)}`;

interface PoolRead {
  amountOut: bigint;
  reserveIn: bigint;
  reserveOut: bigint;
  metisPrice: bigint;
  gasPrice: bigint;
}

async function readPool(side: SwapSide, amountIn: bigint): Promise<PoolRead> {
  const client = publicClient(METIS_SWAP_VENUE.chainId);
  const [amounts, reserves, gasPrice] = await Promise.all([
    client.readContract({ address: METIS_SWAP_VENUE.router, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [amountIn, swapPath(side)] }),
    client.readContract({ address: METIS_SWAP_VENUE.pair, abi: PAIR_ABI, functionName: "getReserves" }),
    client.getGasPrice(),
  ]);
  // token0 is METIS, token1 is m.USDC (read from the pair 24 Oct 2026; swap-venue.ts)
  const [reserveMetis, reserveUsdc] = [reserves[0], reserves[1]];
  return {
    amountOut: amounts[amounts.length - 1] ?? BigInt(0),
    reserveIn: side === "usdc_to_metis" ? reserveUsdc : reserveMetis,
    reserveOut: side === "usdc_to_metis" ? reserveMetis : reserveUsdc,
    metisPrice: metisPriceUsdcBase(reserveMetis, reserveUsdc),
    gasPrice,
  };
}

/**
 * THE PURE DECISION: may this account make this swap, and on what terms. Everything read from the
 * chain is handed in, so each refusal is a sentence the founder can act on and every branch is tested.
 */
export function decideSwap(input: {
  chainId: number;
  side: SwapSide;
  amountIn: bigint;
  usdcBase: bigint;
  metisWei: bigint;
  pool: PoolRead;
  slippageBps?: number;
}): SwapCheck {
  const c = chainConfig(input.chainId);
  if (!swapsOn(input.chainId)) return { ok: false, code: "not_here", message: `Swapping inside Sage is on Metis only. On ${c.name}, ${c.nativeSymbol === "USDC" ? "USDC is the network fee, so there is nothing to swap." : "send the token you need to the account."}` };
  const usdcSide = input.side === "usdc_to_metis";
  if (input.amountIn < (usdcSide ? MIN_SWAP_USDC_BASE : MIN_SWAP_METIS_WEI)) {
    return { ok: false, code: "too_small", message: usdcSide ? "Swap at least 0.10 USDC: below that, the network fee is most of it." : `Swap at least ${formatNative(MIN_SWAP_METIS_WEI)} METIS: below that, the network fee is most of it.` };
  }
  const feeWei = (SWAP_GAS_UNITS * input.pool.gasPrice * BigInt(12)) / BigInt(10);
  if (usdcSide && input.amountIn > input.usdcBase) {
    return { ok: false, code: "insufficient", message: `The account holds ${usd(input.usdcBase)} USDC, less than the ${usd(input.amountIn)} you asked to swap.` };
  }
  if (!usdcSide && input.amountIn + feeWei > input.metisWei) {
    const most = input.metisWei > feeWei ? input.metisWei - feeWei : BigInt(0);
    return { ok: false, code: "insufficient", message: `The account holds ${formatNative(input.metisWei)} METIS. After the network fee, the most you can swap is ${formatNative(most)}.` };
  }
  if (input.metisWei < feeWei) {
    return { ok: false, code: "gas", message: needsFeeMessage({ chainId: input.chainId, action: "swap", needWei: feeWei, haveWei: input.metisWei, nativeSymbol: c.nativeSymbol, network: c.name }) };
  }
  if (input.pool.amountOut <= BigInt(0)) return { ok: false, code: "quote_failed", message: "The pool returned no quote for that amount. Try a smaller swap." };
  const impact = priceImpactBps({ amountIn: input.amountIn, amountOut: input.pool.amountOut, reserveIn: input.pool.reserveIn, reserveOut: input.pool.reserveOut });
  if (impact > MAX_PRICE_IMPACT_BPS) {
    return { ok: false, code: "impact", message: `That swap would move the price ${(impact / 100).toFixed(1)}%, more than the ${MAX_PRICE_IMPACT_BPS / 100}% Sage allows. Swap a smaller amount.` };
  }
  const slippageBps = input.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  return {
    ok: true,
    quote: {
      side: input.side,
      amountIn: input.amountIn,
      amountOut: input.pool.amountOut,
      minOut: minimumOut(input.pool.amountOut, slippageBps),
      slippageBps,
      priceImpactBps: impact,
      metisPriceUsdcBase: input.pool.metisPrice,
      feeWei,
      venue: METIS_SWAP_VENUE.name,
    },
  };
}

/** Balances of one account: USDC (base units) and METIS (wei). */
async function balances(address: Address, chainId: number): Promise<{ usdcBase: bigint; metisWei: bigint }> {
  const client = publicClient(chainId);
  const usdc = chainConfig(chainId).usdcAddress;
  const [usdcBase, metisWei] = await Promise.all([
    usdc ? client.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] }) : Promise.resolve(BigInt(0)),
    client.getBalance({ address }),
  ]);
  return { usdcBase, metisWei };
}

/** Quote a swap for this account, with every check the swap itself will run. Read-only. */
export async function quoteAccountSwap(wallet: AgentWallet, side: SwapSide, amountIn: bigint, slippageBps?: number): Promise<SwapCheck> {
  if (!swapsOn(wallet.chainId)) return decideSwap({ chainId: wallet.chainId, side, amountIn, usdcBase: BigInt(0), metisWei: BigInt(0), pool: { amountOut: BigInt(0), reserveIn: BigInt(0), reserveOut: BigInt(0), metisPrice: BigInt(0), gasPrice: BigInt(0) } });
  try {
    const account = getAddress(wallet.privyWalletAddress);
    const [pool, bal] = await Promise.all([readPool(side, amountIn), balances(account, wallet.chainId)]);
    return decideSwap({ chainId: wallet.chainId, side, amountIn, usdcBase: bal.usdcBase, metisWei: bal.metisWei, pool, slippageBps });
  } catch (e) {
    console.warn("[swap] quote failed:", e instanceof Error ? e.message : e);
    return { ok: false, code: "quote_failed", message: "Sage couldn't read the pool just now. Try again in a moment." };
  }
}

export type SwapResult =
  | { ok: true; side: SwapSide; amountIn: bigint; amountOut: bigint; txHash: Hash; approveTxHash: Hash | null; explorerUrl: string }
  | { ok: false; code: SwapRefusal; message: string };

/** What actually moved, read from the pair's own Swap event in the receipt. Null when it can't be read. */
export function swapAmountsFromLogs(side: SwapSide, logs: readonly { address: string; data: `0x${string}`; topics: readonly `0x${string}`[] }[]): { amountIn: bigint; amountOut: bigint } | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== METIS_SWAP_VENUE.pair.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: PAIR_ABI, data: log.data, topics: [...log.topics] as [`0x${string}`, ...`0x${string}`[]] });
      if (ev.eventName !== "Swap") continue;
      const a = ev.args;
      // token0 = METIS, token1 = USDC
      return side === "usdc_to_metis" ? { amountIn: a.amount1In, amountOut: a.amount0Out } : { amountIn: a.amount0In, amountOut: a.amount1Out };
    } catch {
      /* not the event we want */
    }
  }
  return null;
}

/**
 * MAKE THE SWAP the founder confirmed. `agreedMinOut` is the least they agreed to receive; it is
 * what the router enforces (or the fresh quote's own minimum, if that is higher), and a fresh quote
 * already below it means the price moved, so nothing is sent.
 */
export async function swapFromAccount(founder: string, wallet: AgentWallet, side: SwapSide, amountIn: bigint, agreedMinOut: bigint): Promise<SwapResult> {
  const check = await quoteAccountSwap(wallet, side, amountIn);
  if (!check.ok) return check;
  const q = check.quote;
  if (q.amountOut < agreedMinOut) {
    return { ok: false, code: "price_moved", message: "The price moved since your quote, below the least you agreed to receive. Nothing was swapped; look at the new quote." };
  }
  const amountOutMin = q.minOut > agreedMinOut ? q.minOut : agreedMinOut;
  const account = getAddress(wallet.privyWalletAddress);
  const spec = accountBaseSpec(wallet, launchChainConfig(wallet.chainId));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + SWAP_DEADLINE_SECONDS);
  const path = swapPath(side);

  try {
    const sent = await withScopedPolicy(
      wallet,
      async () => (await privyPost<{ id: string }>("/policies", buildSwapPolicy(spec, { side, router: METIS_SWAP_VENUE.router, account, amountIn }))).id,
      async () => {
        let approveTxHash: Hash | null = null;
        if (side === "usdc_to_metis") {
          const approve = await executeViaPrivy(
            wallet.privyWalletId,
            account,
            { to: METIS_SWAP_VENUE.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [METIS_SWAP_VENUE.router, amountIn] }), label: "swap-approve" },
            wallet.chainId,
          );
          approveTxHash = approve.txHash as Hash;
        }
        const swap = await executeViaPrivy(
          wallet.privyWalletId,
          account,
          side === "usdc_to_metis"
            ? { to: METIS_SWAP_VENUE.router, data: encodeFunctionData({ abi: SWAP_TOKENS_FOR_METIS_ABI, functionName: "swapExactTokensForMetis", args: [amountIn, amountOutMin, path, account, deadline] }), label: "swap" }
            : { to: METIS_SWAP_VENUE.router, value: amountIn, data: encodeFunctionData({ abi: SWAP_METIS_FOR_TOKENS_ABI, functionName: "swapExactMetisForTokens", args: [amountOutMin, path, account, deadline] }), label: "swap" },
          wallet.chainId,
        );
        return { txHash: swap.txHash as Hash, approveTxHash };
      },
    );
    const receipt = await publicClient(wallet.chainId).getTransactionReceipt({ hash: sent.txHash }).catch(() => null);
    const moved = receipt ? swapAmountsFromLogs(side, receipt.logs) : null;
    const amountOut = moved?.amountOut ?? q.amountOut;
    recordAccountMove({
      founder,
      wallet: account,
      chainId: wallet.chainId,
      kind: "swap",
      assetIn: side === "usdc_to_metis" ? "usdc" : "metis",
      amountIn: moved?.amountIn ?? amountIn,
      assetOut: side === "usdc_to_metis" ? "metis" : "usdc",
      amountOut,
      counterparty: METIS_SWAP_VENUE.pair,
      txHash: sent.txHash,
      approveTxHash: sent.approveTxHash,
    });
    return { ok: true, side, amountIn: moved?.amountIn ?? amountIn, amountOut, txHash: sent.txHash, approveTxHash: sent.approveTxHash, explorerUrl: explorerTxUrl(wallet.chainId, sent.txHash) };
  } catch (e) {
    if (e instanceof AccountBusyError) return { ok: false, code: "busy", message: e.message };
    console.warn(`[swap] ${side} failed for ${account}:`, e instanceof Error ? e.message : e);
    return { ok: false, code: "failed", message: "The swap didn't go through, so your USDC and METIS stay where they were (a step that was sent still cost its network fee). Try again, or swap a smaller amount." };
  }
}

/**
 * The most METIS a "swap all" may sell: the balance less this swap's fee and the launch floor, so an
 * account that swaps everything can still launch a job afterwards without being topped up.
 */
export function maxMetisToSwap(metisWei: bigint, feeWei: bigint, chainId: number): bigint {
  const keep = feeWei + minLaunchGasWei(chainId);
  return metisWei > keep ? metisWei - keep : BigInt(0);
}

let priceCache: { at: number; price: bigint } | null = null;

/** The pool's METIS price in USDC base units, read at most once a minute; null when the pool can't be read. */
export async function readMetisPriceUsdcBase(): Promise<bigint | null> {
  if (priceCache && Date.now() - priceCache.at < 60_000) return priceCache.price;
  try {
    const r = await publicClient(METIS_SWAP_VENUE.chainId).readContract({ address: METIS_SWAP_VENUE.pair, abi: PAIR_ABI, functionName: "getReserves" });
    const price = metisPriceUsdcBase(r[0], r[1]);
    priceCache = { at: Date.now(), price };
    return price;
  } catch {
    return priceCache?.price ?? null;
  }
}
