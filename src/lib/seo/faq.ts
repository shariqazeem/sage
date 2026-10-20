import { PLANS } from "@/lib/plans/catalog";
import { planPriceUsd } from "@/lib/plans/billing-math";

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
 *  · prices and limits come from the plan catalog the server enforces, never typed here.
 *
 * Rewritten 20 Oct 2026 for the company: any work that can be checked (not only testing), Metis and
 * GOAT as the primary networks, paid plans, and the records people keep.
 */
export interface FaqEntry {
  q: string;
  a: string;
}

const free = PLANS.free;
const PRICE_ANSWER = [
  `Free to start: ${free.liveJobs === 1 ? "one live job" : `${free.liveJobs} live jobs`} at a time and up to $${free.monthlyUsd.toLocaleString("en-US")} of work a month, paying real people.`,
  `Pro is $${planPriceUsd("pro")} a month and Team $${planPriceUsd("team")} a month, paid in USDC; ${PLANS.programs.name} is set up with you.`,
  "There is no fee on payouts, Sage pays the network fee, and the people doing the work never pay.",
].join(" ");

export const FAQ: readonly FaqEntry[] = [
  {
    q: "What is Sage at sagepays.xyz?",
    a: "An AI agent that pays people in USDC for work it has verified. You describe the work and set a budget; Sage checks every submission and pays from an on-chain vault it cannot overspend, with a public receipt for every payout and a written reason for every refusal. It runs on Metis and GOAT Network, also settles on Arc and Starknet, and is registered as an on-chain agent under ERC-8004.",
  },
  {
    q: "What kind of work can Sage pay for?",
    a: "Work whose delivery can be checked: product testing, gigs and bounties with proof of delivery, and grants paid one milestone at a time. Sage turns a one-sentence description into tasks with a fixed reward each, and checks every submission against links, on-chain state and what it observed itself.",
  },
  {
    q: "How do I get paid for work on Sage?",
    a: "Open Find work at sagepays.xyz/marketplace, pick a task, do it and submit what it asks for. There is no application and no interview, and working through Sage is always free. Verified work is paid in USDC to your own wallet, and every payout adds to your record of verified work.",
  },
  {
    q: "Does Sage actually pay, or is it a claim?",
    a: "Every payout is an on-chain transaction with a receipt page anyone can open and check. The public ledger at sagepays.xyz/ledger lists every payout and every refusal, read from settled transactions rather than typed in.",
  },
  {
    q: "What stops the AI agent from overspending?",
    a: "The AI proposes and the vault decides. Each job's budget sits in an on-chain vault that pays the exact reward fixed when the job was made, enforces the per-task cap and the completion limit, and rejects anything outside them. No model output can move money by itself, and no model ever sets an amount.",
  },
  {
    q: "Do I have to review every submission?",
    a: "No. Sage judges each submission against the job's checks and pays the work that passes. Work it cannot verify is held for the person who posted the job to decide, rather than guessed at, and every refusal carries its reason.",
  },
  {
    q: "How much does Sage cost?",
    a: PRICE_ANSWER,
  },
  {
    q: "Do I need a crypto wallet?",
    a: "No, neither to post work nor to do it. Sign in with an email and Sage opens an account for you, a wallet held under spending rules that only let Sage launch your jobs within your cap; or run everything from Telegram through @sagedeputybot. A browser wallet works too.",
  },
  {
    q: "Which networks does Sage pay on?",
    a: "USDC on Metis and GOAT Network, Sage's primary networks, and also on Arc and Starknet. On Starknet a payout can be private: the receipt proves the payment without naming who collected it.",
  },
  {
    q: "Can a lender or a team see what someone has been paid?",
    a: "Yes. Everyone paid through Sage has a public record of verified work at sagepays.xyz/record/<wallet>, with a printable statement and a lender's view, and every line links to its receipt. The person can choose to withhold the amounts. Teams open each member's record from Team.",
  },
  {
    q: "Can I write my submission in my own words or my own language?",
    a: "Yes. For testing work Sage matches your account against phrases from inside the product rather than requiring particular wording, so a genuine account in your own voice or another language still verifies. Use the product's own words for what you saw on screen, such as button and heading labels; copying the task description back scores nothing.",
  },
  {
    q: "What if my product is behind a login or a Connect Wallet screen?",
    a: "Sage inspects everything it can reach, and when a wall stops it, it reads the product's own documentation to understand what is behind it, then designs tasks a person with their own account can genuinely perform. It never asks anyone for credentials, a seed phrase or a private key.",
  },
  {
    q: "What does Sage not do?",
    a: "It is not a bug bounty, a chatbot or a general agent platform. It pays people for work it can verify, and it is judged on whether those payouts hold up.",
  },
] as const;
