/**
 * THE CANONICAL FAQ — one list, rendered twice.
 *
 * These questions appear in two places: as FAQPage structured data in the root layout, and as the
 * visible `/faq` page. They must be the SAME list. Two separately maintained copies is how a site
 * ends up telling an answer engine one thing in its schema and a reader another on the page, and the
 * schema is the copy that gets quoted back at you.
 *
 * It also solves a concrete duplication problem: `StructuredData` renders in the root layout, so it
 * is present on `/faq` too. Emitting a second FAQPage there would put two competing FAQPage entities
 * on one URL. Instead there is one entity, built from here, and the page renders the human view of
 * the same source.
 *
 * WRITING RULES, because these strings get restated by models that cannot check them:
 *  · every answer is a claim Sage can back today; nothing aspirational, nothing unverified.
 *  · no positioning language — nothing we would object to being attributed to us in someone
 *    else's answer.
 *  · the answer's first sentence must stand alone, because an extractor may take only that.
 *  · never the bare word "Sage" where the subject could be mistaken for Sage Group, Sage Pay or
 *    Ask Sage; pair it with what it does or with the domain.
 */
export interface FaqEntry {
  q: string;
  a: string;
}

export const FAQ: readonly FaqEntry[] = [
  {
    q: "What is Sage at sagepays.xyz?",
    a: "An AI agent that turns one product URL and one budget into paid user-testing missions, then pays human testers in USDC for verified evidence. It settles on two mainnet rails — GOAT Network for public receipts and Starknet for private payouts — and is registered on-chain as ERC-8004 agent #79.",
  },
  {
    q: "How do I get paid to test products on Sage?",
    a: "Open the Sage marketplace, pick a mission, do the short task it describes, and write what you actually saw. There is no application and no interview. Sage checks your account against what it observed exploring the product itself and pays in USDC.",
  },
  {
    q: "Does Sage actually pay, or is it a claim?",
    a: "Every payout is an on-chain transaction on GOAT Network or Starknet and publishes a receipt page anyone can open and verify. The marketplace lists recent payouts with links to those transactions, so the total paid is read from settled transfers rather than typed in.",
  },
  {
    q: "Who pays the testers?",
    a: "The agent does, autonomously, out of a campaign vault the founder funded. Each payout is a transaction with a public receipt, and the founder never reviews a submission by hand.",
  },
  {
    q: "What stops the AI agent from overspending?",
    a: "The agent proposes, a smart contract disposes. Each campaign has an on-chain vault that derives the exact reward, enforces the per-mission cap and completion limits, and rejects anything outside them. No model output can move money by itself.",
  },
  {
    q: "Do I have to review submissions?",
    a: "No, and that is the product. Sage judges each report against its own first-hand observations and pays the genuine ones. Work it cannot verify is held for a human decision rather than guessed at.",
  },
  {
    q: "Can I write my submission in my own words or my own language?",
    a: "Yes. Sage matches your account against phrases from inside the product rather than requiring particular wording, so a genuine account written in your own voice or another language still verifies. One thing to keep: write the product's own words for what you saw on screen, such as button and heading labels, because those are what Sage matches against. Copying the mission description back scores nothing.",
  },
  {
    q: "Do I need a crypto wallet to launch a campaign?",
    a: "No. The Telegram bot @sagedeputybot runs the whole loop walletless: it creates a server wallet bound to a spending policy and funds the campaign from it, so you never connect anything or leave the chat. A browser wallet on sagepays.xyz works too if you prefer one.",
  },
  {
    q: "What does a founder give Sage to start?",
    a: "A product URL, what you want proven, who should test it, and a budget in USDC. Sage browses the product itself and designs the missions, so there is nothing else to fill in.",
  },
  {
    q: "What if my product is behind a login or a Connect Wallet screen?",
    a: "Sage inspects everything it can reach, and when a wall stops it, it reads the product's own documentation to understand what is behind it, then designs missions a tester who has their own account can genuinely perform. It will never ask a tester for credentials, a seed phrase or a private key.",
  },
  {
    q: "How long does an inspection take?",
    a: "Usually about ninety seconds to a plan you can read, and you watch the browsing happen on screen while it works, page by page.",
  },
  {
    q: "What does Sage not do?",
    a: "It is not a bug bounty, a generic agent platform, or a chatbot. It turns one product and one budget into paid, verified testing, and it is judged on whether the payouts hold up.",
  },
] as const;
