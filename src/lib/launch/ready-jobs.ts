import { METIS_MAINNET_CHAIN_ID } from "@/lib/deputy/networks";
import type { Tranche } from "./composer";

/**
 * READY TO GO (28 Oct 2026). The founder, about Post: "im lazy to think what to launch". A blank box
 * that asks "describe the work" makes them invent the job before Sage can do anything, and the examples
 * that answered it sat below the form, generic ("my designer", "my menu"). These are whole jobs, written
 * for the founder's own product: the brief, the criteria Sage checks, the proof, the price. One tap fills
 * the composer and the job is ready to launch, with no drafting wait and no model: the words are written
 * here and the money is a fixed number the founder can change. Nothing is launched without their click.
 */

/** The product the jobs are written for: the workspace's name and the product Sage last tested for them. */
export interface ReadyProduct {
  name: string | null;
  url: string | null;
}

/** A composer filled in full, minus the parts every job shares (the currency is USD, there is no drafted "why"). */
export interface ReadyDraft {
  who: string;
  slots: string;
  inviteOnly: boolean;
  splitTotal: string;
  tranches: Tranche[];
}

export type ReadyJob =
  | {
      key: string;
      kind: "pay";
      title: string;
      line: string;
      price: string;
      /** what the founder still has to add before it can launch, in their words; null = nothing */
      needs: string | null;
      draft: ReadyDraft;
    }
  | {
      key: string;
      kind: "test";
      title: string;
      line: string;
      price: string;
      /** the goal it starts the product test with */
      goal: string;
    };

/** The first-impressions goal, shared with the product test's own goal chips. */
export const FIRST_IMPRESSIONS_GOAL =
  "Can a first-time visitor understand what this product does and find where to start? Report what you actually saw on each screen.";

const tranche = (t: Partial<Tranche> & Pick<Tranche, "amount" | "deliverable" | "verify">): Tranche => ({ expectedText: "", toAddr: "", title: "", ...t });

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function readyJobs(product: ReadyProduct): ReadyJob[] {
  const name = (product.name?.trim() || hostOf(product.url) || "your product").slice(0, 40);
  const at = product.url ? ` at ${product.url}` : "";
  return [
    {
      key: "try",
      kind: "test",
      title: `Have people try ${name}`,
      line: "Sage looks at your product first, writes the tasks, and checks every answer against what it saw.",
      price: "From $5",
      goal: FIRST_IMPRESSIONS_GOAL,
    },
    {
      key: "guide",
      kind: "pay",
      title: "A getting-started guide",
      line: `One person uses ${name} for real and writes a step-by-step guide on their own blog.`,
      price: "$10 · 1 person",
      needs: null,
      draft: {
        who: "a writer",
        slots: "1",
        inviteOnly: false,
        splitTotal: "",
        tranches: [
          tranche({
            amount: "10",
            title: `A getting-started guide to ${name}`.slice(0, 80),
            deliverable: `a step-by-step guide to getting started with ${name} is published on a public page`,
            verify: "link",
            instructions: [
              `1. Use ${name}${at} for real, from signing up to the first useful result.`,
              `2. Write a guide a newcomer could follow: what ${name} is for, how to start, the first useful thing to do, and anything that tripped you up.`,
              "3. Publish it on your own blog, dev.to, Medium, Notion or a GitHub gist, with your wallet address at the end.",
              "4. Submit the link.",
            ].join("\n"),
            criteria: [
              `It walks a newcomer through getting started with ${name}, step by step, to a first useful result`,
              "It is written from the author's own use, with details only someone who tried it would know",
              `It is in the author's own words, not copied from ${name}'s own pages`,
            ],
            minWords: 300,
            effortMinutes: 60,
          }),
        ],
      },
    },
    {
      key: "onchain",
      kind: "pay",
      title: "First users on-chain",
      line: `Three people each make their first transaction with ${name} on Metis, checked on the chain.`,
      price: "$2 each · 3 people",
      needs: "Add the contract address the transaction must go to.",
      draft: {
        who: "new users",
        slots: "3",
        inviteOnly: false,
        splitTotal: "",
        tranches: [
          tranche({
            amount: "2",
            title: `A first transaction with ${name}`.slice(0, 80),
            deliverable: `they send their first transaction to ${name}'s contract on Metis, from their own wallet`,
            verify: "onchain",
            toAddr: "",
            txChain: METIS_MAINNET_CHAIN_ID,
            instructions: [
              `1. Open ${name}${at} and do the main thing it offers on Metis, from your own wallet.`,
              "2. Copy the transaction hash from your wallet or the Metis explorer.",
              "3. Submit the transaction hash.",
            ].join("\n"),
            criteria: [`The transaction goes to ${name}'s contract on Metis`, "The transaction was sent by the submitting wallet"],
            effortMinutes: 10,
          }),
        ],
      },
    },
    {
      key: "grant",
      kind: "pay",
      title: "A builder grant",
      line: `One builder makes something with ${name} in three milestones, each paid when Sage checks it.`,
      price: "$30 · 3 milestones",
      needs: null,
      draft: {
        who: "a builder",
        slots: "1",
        inviteOnly: false,
        splitTotal: "30",
        tranches: [
          tranche({
            amount: "",
            title: "The plan",
            deliverable: `a short public plan of what they will build with ${name}, and by when, is published`,
            verify: "link",
            instructions: [
              `1. Decide what you will build with ${name}${at}: a tool, an integration, a template or a demo.`,
              "2. Write a short plan: what it does, who it is for, and when each part will be done.",
              "3. Publish it on a public page (a GitHub README, a gist or your own blog) with your wallet address on it, and submit the link.",
            ].join("\n"),
            criteria: [
              `It says what will be built with ${name}, who it is for, and when each part will be done`,
              "It is specific enough that someone else could check the finished work against it",
            ],
            minWords: 120,
            effortMinutes: 30,
          }),
          tranche({
            amount: "",
            title: "A working first version",
            deliverable: `a working first version of what they built with ${name} is live at a public link`,
            verify: "link",
            instructions: [
              "1. Build the first version of what your plan describes.",
              "2. Put it where anyone can see it work: a live link, or a public repository with a demo.",
              "3. Add your wallet address to the page or the README, and submit the link.",
            ].join("\n"),
            criteria: [
              `The page shows a working first version of something built with ${name}`,
              "Anyone can see it work from the page: a live link, runnable code or a demo",
            ],
            effortMinutes: 240,
          }),
          tranche({
            amount: "",
            title: "The write-up",
            deliverable: `a public write-up of what they built with ${name}, how it works and what comes next`,
            verify: "link",
            instructions: [
              `1. Write up what you built: what it does, how it works with ${name}, what you learned and what comes next.`,
              "2. Link the working version.",
              "3. Publish it on a public page with your wallet address on it, and submit the link.",
            ].join("\n"),
            criteria: [`It explains what was built with ${name} and how it works`, "It links a working version anyone can open"],
            minWords: 200,
            effortMinutes: 60,
          }),
        ],
      },
    },
  ];
}
