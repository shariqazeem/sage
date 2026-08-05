/**
 * Can the x402 rail actually take money yet?
 *
 * Sage's paid endpoints are wired and the merchant credentials are live, but a customer still
 * cannot pay us: the facilitator returns `payToAddress: ""` and an empty payment challenge, so
 * every buyer gets a 402 with nowhere to send funds. The cause is not in our code. It is that the
 * merchant account has no receiving address configured for the chain and token we accept, and the
 * facilitator will not invent one.
 *
 * This asks the merchant account itself and answers one question plainly: ready, or not ready, and
 * if not, what is missing. Run it before wiring pricing and again after changing the portal.
 *
 *   npm run x402:merchant
 *
 * Reads GOATX402_API_KEY / _API_SECRET / _MERCHANT_ID from .env. Read-only: it fetches the merchant
 * record and nothing else, so it is safe to run against production at any time.
 */

const API_URL = process.env.GOATX402_API_URL?.trim() || "https://flow-merchant.goat.network";
const KEY = process.env.GOATX402_API_KEY?.trim();
const SECRET = process.env.GOATX402_API_SECRET?.trim();
const MERCHANT = process.env.GOATX402_MERCHANT_ID?.trim();

/** The one pair Sage charges in: GOAT mainnet USDC. Mirrors src/lib/x402/facilitator.ts. */
const GOAT_CHAIN_ID = 2345;
const GOAT_USDC = "0x3022b87ac063DE95b1570F46f5e470F8B53112D8";
const MIN_USDC = 0.1;

if (!KEY || !SECRET || !MERCHANT) {
  console.error(
    "[x402] No merchant credentials in .env (GOATX402_API_KEY / _API_SECRET / _MERCHANT_ID).\n" +
      "       Without all three the rail is off and every paid route runs free by design.",
  );
  process.exit(1);
}

const { GoatX402Client } = await import("goatx402-sdk-server");
const client = new GoatX402Client({ baseUrl: API_URL, apiKey: KEY, apiSecret: SECRET });

let merchant;
try {
  merchant = await client.getMerchant();
} catch (err) {
  console.error(`[x402] Could not read the merchant account: ${err?.message ?? err}`);
  console.error(`       Facilitator: ${API_URL}`);
  process.exit(1);
}

const tokens = Array.isArray(merchant?.supportedTokens) ? merchant.supportedTokens : [];
const sameAddr = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();

const goatUsdc = tokens.find(
  (t) =>
    Number(t?.chainId ?? t?.chain_id) === GOAT_CHAIN_ID &&
    (sameAddr(t?.tokenAddress ?? t?.token_address ?? t?.address, GOAT_USDC) ||
      String(t?.symbol ?? "").toUpperCase() === "USDC"),
);
const payTo =
  goatUsdc?.receivingAddress ?? goatUsdc?.receiving_address ?? goatUsdc?.payToAddress ?? null;

console.log(`\nMerchant   ${MERCHANT}`);
console.log(`Facilitator ${API_URL}`);
console.log(`Accepting   ${tokens.length} chain/token pair${tokens.length === 1 ? "" : "s"}`);
for (const t of tokens) {
  const addr = t?.receivingAddress ?? t?.receiving_address ?? t?.payToAddress ?? "(none)";
  console.log(`  · chain ${t?.chainId ?? t?.chain_id ?? "?"} ${t?.symbol ?? t?.tokenAddress ?? ""} → ${addr}`);
}

if (payTo && /^0x[0-9a-fA-F]{40}$/.test(String(payTo))) {
  console.log(`\nREADY. Payments on GOAT (${GOAT_CHAIN_ID}) USDC land at ${payTo}.`);
  console.log(`Minimum charge is ${MIN_USDC} USDC, so no service can be priced below that.\n`);
  process.exit(0);
}

console.log(`\nNOT READY. There is no receiving address for GOAT (chain ${GOAT_CHAIN_ID}) USDC.`);
console.log(`This is why buyers get an empty payment challenge: the facilitator has no address to`);
console.log(`quote, so payToAddress comes back as "". Nothing in Sage's code can fix it.`);
console.log(`\nFix it in the merchant portal at ${API_URL} — the account must be approved and`);
console.log(`enabled, receive type DIRECT, then add a receiving address for the pair:`);
console.log(`    chain ${GOAT_CHAIN_ID} (GOAT Network) · USDC ${GOAT_USDC}`);
console.log(`Then run this again. It should print READY.\n`);
process.exit(2);
