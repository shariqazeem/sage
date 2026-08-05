/**
 * Can the x402 rail actually take money right now?
 *
 * It checks its own instrument first, because the instrument is what lied. The GOAT merchant
 * PORTAL (flow-merchant.goat.network) and the facilitator API (flow-api.goat.network) are
 * different hosts, and the portal is a single-page app that answers 200 with index.html for every
 * path including /api/v1/orders. The SDK parses that HTML into an empty object, so pointing at the
 * portal produces orders with `payToAddress: ""` and an empty payment challenge — which is
 * indistinguishable, from the outside, from a merchant that has no receiving address configured.
 * That misreading cost a false diagnosis: the address had been configured since July.
 *
 * So step 1 is "is this host even an API", and only then "is the merchant configured".
 *
 *   npm run x402:merchant
 *
 * Reads GOATX402_API_KEY / _API_SECRET / _MERCHANT_ID / _API_URL from .env. Read-only: it fetches
 * the merchant record and never creates an order, so it is safe against production at any time.
 */

const API_URL = process.env.GOATX402_API_URL?.trim() || "https://flow-api.goat.network";
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

/* ── 1. Is this host an API at all? ───────────────────────────────────────────────── */

// Unauthenticated, so a real facilitator MUST reject it. The point is what it rejects with:
// an API says 401 and names the missing signature headers. A web app serves its landing page.
let probe;
try {
  probe = await fetch(`${API_URL}/api/v1/merchants/${encodeURIComponent(MERCHANT)}`, {
    signal: AbortSignal.timeout(20_000),
  });
} catch (err) {
  console.error(`\n[x402] ${API_URL} is unreachable: ${err?.message ?? err}`);
  console.error(`       The facilitator API is https://flow-api.goat.network.\n`);
  process.exit(1);
}
const contentType = probe.headers.get("content-type") ?? "";
const looksLikeApi = probe.status === 401 || contentType.includes("json");

if (!looksLikeApi) {
  console.error(`\nWRONG HOST. ${API_URL} answered HTTP ${probe.status} as ${contentType || "unknown"}.`);
  console.error(`An API rejects an unsigned request with 401. This served a web page, so it is the`);
  console.error(`merchant PORTAL, not the facilitator. Every order against it comes back empty and`);
  console.error(`looks like a merchant misconfiguration.`);
  console.error(`\nSet GOATX402_API_URL=https://flow-api.goat.network and run this again.\n`);
  process.exit(1);
}

/* ── 2. Is the merchant configured for the pair we charge in? ─────────────────────── */

const { GoatX402Client } = await import("goatx402-sdk-server");
const client = new GoatX402Client({ baseUrl: API_URL, apiKey: KEY, apiSecret: SECRET });

let merchant;
try {
  merchant = await client.getMerchant(MERCHANT);
} catch (err) {
  console.error(`\n[x402] Could not read merchant "${MERCHANT}": ${err?.message ?? err}\n`);
  process.exit(1);
}

// A merchant record with no id is the parse failure again, not an empty account. Never read
// "supportedTokens: []" off an object the API did not actually send.
if (!merchant?.merchantId) {
  console.error(`\n[x402] ${API_URL} returned no merchant record for "${MERCHANT}".`);
  console.error(`       Treating that as "no tokens configured" would be a guess, so this stops here.\n`);
  process.exit(1);
}

const tokens = Array.isArray(merchant.supportedTokens) ? merchant.supportedTokens : [];
const sameAddr = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
const goatUsdc = tokens.find(
  (t) => Number(t?.chainId) === GOAT_CHAIN_ID && sameAddr(t?.tokenContract, GOAT_USDC),
);

console.log(`\nMerchant     ${merchant.merchantId}  (receive type ${merchant.receiveType ?? "unknown"})`);
console.log(`Facilitator  ${API_URL}`);
console.log(`Accepting    ${tokens.length} chain/token pair${tokens.length === 1 ? "" : "s"}`);
for (const t of tokens) {
  console.log(`  · chain ${t?.chainId} ${t?.symbol} ${t?.tokenContract}`);
}

if (!goatUsdc) {
  console.log(`\nNOT READY. No receiving address for GOAT (chain ${GOAT_CHAIN_ID}) USDC.`);
  console.log(`Add it in the portal at https://flow-merchant.goat.network under Receiving Tokens &`);
  console.log(`Addresses, receive type DIRECT, for the pair:`);
  console.log(`    chain ${GOAT_CHAIN_ID} (GOAT Network) · USDC ${GOAT_USDC}\n`);
  process.exit(2);
}

console.log(`\nREADY. Buyers can pay ${goatUsdc.symbol} on GOAT (${GOAT_CHAIN_ID}).`);
console.log(`Minimum charge is ${MIN_USDC} USDC, so no service can be priced below that.`);
console.log(`The receiving address is set in the portal and appears on each order as payTo.\n`);
