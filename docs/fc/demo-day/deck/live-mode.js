// Which network the live walkthrough runs on, and the words that depend on it. One switch:
//   SAGE_LIVE=mainnet (default) — real USDC on Arc mainnet
//   SAGE_LIVE=testnet           — test USDC on Arc testnet (the proven fallback)
// build-deck.js and build-script.mjs fill these into script.js's {placeholders}.
const MODES = {
  mainnet: {
    // the account door names the network by its registry name: "…from your account on Arc"
    chipLabel: "Arc",
    promise: "In the next few minutes, you'll watch it pay someone. Live, with real money.",
    openingLive: "Live, with real money.",
    liveIntro: "Let me show you. Live, with real money, on Arc, where the dollar pays its own fee.",
    liveFootnote: (payments) => `Real USDC on Arc mainnet. Every payment is a public transaction. ${payments} mainnet payments since July.`,
    paysIn: "≈ $1.01 in USDC · real money",
  },
  testnet: {
    chipLabel: "Arc Testnet",
    promise: "In the next few minutes, you'll watch it pay someone. Live.",
    openingLive: "Live.",
    liveIntro: "Let me show you. Live, on Arc's test network, so these are test dollars. The same engine pays real money on mainnet.",
    liveFootnote: (payments) => `On Arc's test network: test dollars, the real engine. Real money since July: ${payments} mainnet payments on the public ledger.`,
    paysIn: "one payment · test USDC",
  },
};
module.exports = function liveMode() {
  const m = (process.env.SAGE_LIVE ?? "mainnet").trim();
  if (!MODES[m]) throw new Error(`SAGE_LIVE must be mainnet or testnet, not "${m}"`);
  return { name: m, ...MODES[m] };
};
