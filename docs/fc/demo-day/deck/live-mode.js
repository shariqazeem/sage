// The words that depend on where the live walkthrough runs. MAINNET ONLY since 10 Oct 2026: real
// USDC on Arc mainnet. The testnet mode is retired — Sage no longer launches on a testnet at all
// (LAUNCH_ENABLED_CHAINS), so a testnet fallback would be a button that refuses on stage.
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
};
module.exports = function liveMode() {
  const m = (process.env.SAGE_LIVE ?? "mainnet").trim();
  if (!MODES[m]) throw new Error(`SAGE_LIVE must be mainnet (the testnet mode is retired), not "${m}"`);
  return { name: m, ...MODES[m] };
};
