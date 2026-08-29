import { CHAINS } from "@/lib/deputy/networks";
import { currencyOf, formatLocal, fromUsdBase, type RateQuote } from "./currency";

/**
 * GETTING THE MONEY OUT — the half that decides whether any of this was real.
 *
 * Sage can pay someone in seconds. That is worth nothing to a shop owner in Kingston if the result
 * is a token they cannot spend, and the honest finding from the first cohort is exactly that:
 * people were paid and then struggled to move the money anywhere. A payment rail that ends in an
 * asset nobody local accepts has not moved capital, it has moved a number.
 *
 * So this states, plainly and without selling anything:
 *   · what the recipient actually holds, in their own currency as well as the token's,
 *   · how widely that asset can be moved from the chain it is on, INCLUDING when the answer is
 *     "not very" — a thin chain is a real constraint on a real person and hiding it would be the
 *     same dishonesty this product exists against,
 *   · what the realistic next hop is.
 *
 * It names no exchange and recommends no service. Availability differs by country and changes
 * constantly, and a stale recommendation about someone's money is worse than none. Sage states
 * facts it can stand behind and lets the person choose.
 */

/** How reachable an asset is once it lands — the thing that decides if a payout became money. */
export type Liquidity = "broad" | "limited" | "testnet";

export interface ExitPicture {
  chainId: number;
  chainName: string;
  /** the settlement asset, always a USD stablecoin today. */
  asset: string;
  amountUsd: number;
  /** the same amount in the recipient's own currency, when a rate could be stamped. */
  localAmount: number | null;
  localCurrency: string | null;
  liquidity: Liquidity;
  /** one plain sentence about where this can go. */
  reach: string;
  /** the realistic next hop, in order. Never a recommendation of a named service. */
  steps: string[];
  /** true when the honest answer is "this chain is thin" — the UI should not bury it. */
  constrained: boolean;
}

/**
 * Chains Sage can settle on, and how far the money travels from each.
 *
 * GOAT is marked `limited` deliberately. It is where the vault lives today and it settles reliably,
 * but few venues list it, which is precisely the friction the first cohort hit. Recording that
 * honestly is what makes the case for settling somewhere broader — and a recipient deserves to know
 * before they are paid, not after.
 */
const LIQUIDITY: Record<number, Liquidity> = {
  2345: "limited", // GOAT Network
  1088: "limited", // Metis Andromeda
  59902: "testnet", // Metis Sepolia
};

export function exitPicture(
  amountBase: bigint,
  chainId: number,
  quote: RateQuote | null = null,
): ExitPicture {
  const cfg = CHAINS[chainId];
  const chainName = cfg?.name ?? `chain ${chainId}`;
  const liquidity: Liquidity = LIQUIDITY[chainId] ?? "limited";
  const amountUsd = Number(amountBase) / 1_000_000;

  const local =
    quote && quote.currency !== "USD" && currencyOf(quote.currency)
      ? { amount: fromUsdBase(amountBase, quote), code: quote.currency }
      : null;

  if (liquidity === "testnet") {
    return {
      chainId, chainName, asset: "test USDC", amountUsd,
      localAmount: null, localCurrency: null, liquidity,
      reach: `This is ${chainName}, a test network. The balance is not real money and cannot be cashed out.`,
      steps: ["Nothing to withdraw — this campaign settled on a test network."],
      constrained: true,
    };
  }

  const reach =
    liquidity === "broad"
      ? `USDC on ${chainName} is accepted by most major wallets and exchanges, so this can be moved or converted in the usual ways.`
      : `USDC on ${chainName} settles reliably, but few exchanges list this network directly — so getting it into local currency usually means one extra hop.`;

  const steps =
    liquidity === "broad"
      ? [
          `Send it to any wallet or exchange account that supports USDC on ${chainName}.`,
          "Convert to your local currency there, on whatever route is cheapest where you are.",
        ]
      : [
          `Withdraw to any address that accepts USDC on ${chainName} — Sage covers the gas, so you need no crypto of your own.`,
          `Bridge it to a network your local exchange supports. ${chainName} is not widely listed, and that is the step most people get stuck on.`,
          "Convert to your local currency there.",
        ];

  return {
    chainId, chainName, asset: "USDC", amountUsd,
    localAmount: local?.amount ?? null,
    localCurrency: local?.code ?? null,
    liquidity, reach, steps,
    constrained: liquidity !== "broad",
  };
}

/** One line a person can read without knowing what a chain is. */
export function exitSummary(p: ExitPicture): string {
  const usd = `$${p.amountUsd.toFixed(2)} ${p.asset}`;
  const local = p.localAmount !== null && p.localCurrency
    ? ` — about ${formatLocal(p.localAmount, p.localCurrency)}`
    : "";
  return `You have ${usd}${local} on ${p.chainName}. ${p.reach}`;
}
