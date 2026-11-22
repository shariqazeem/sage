import { composeCoreAccount, type Reached } from "@/lib/core-test/shape";
import type { PaidAnswer } from "./core";

/**
 * ANSWER SETS FOR THE PLAIN REPORT. Written the way paid testers actually write: honest and specific,
 * vague, off topic, two people saying the same thing in nearly the same words, another language. Each
 * set names the groups a careful person would make by hand (`expect`), and the pairs that must never
 * end up in one finding (`apart`). No product here is real.
 */
export interface AnswerSet {
  name: string;
  answers: PaidAnswer[];
  /** the rung each core answer's person tapped */
  rungs: Map<string, Reached>;
  /** groups of two or more people that are one problem (or one idea), by answer id */
  expect: string[][];
  /** pairs that are different problems */
  apart: [string, string][];
}

const core = (impression: string, action: string, verdict = "Maybe.") => composeCoreAccount([impression, "The headline and the one orange button.", action, verdict]);

/** A gifting app, ten strangers on the first-try mission. Three real problems, two people who finished. */
export const DROPS: AnswerSet = {
  name: "Drops: the first-try mission, ten people",
  answers: [
    { id: "d1", text: core("A gifting app.", "I reached the form and the Continue button did nothing. Clicked it five times.") },
    { id: "d2", text: core("Send money to friends?", "Filled in the name, pressed Continue and nothing happened.") },
    { id: "d3", text: core("Some kind of gift link maker.", "The continue button doesn't respond after I type a name.", "No.") },
    { id: "d4", text: core("Not sure, a landing page.", "I couldn't find where to start. The page is just a big headline.", "No.") },
    { id: "d5", text: core("A crypto thing.", "No idea where to begin, I looked for a start button and did not find one.", "No.") },
    { id: "d6", text: core("Gifts with crypto.", "Clicked Start a drop and it asked me to connect a wallet, I don't have one.") },
    { id: "d7", text: core("A wallet app.", "It wants a wallet connection before showing anything, so I stopped.", "No.") },
    { id: "d8", text: core("A way to send a gift by link.", "Finished: I sent a drop to myself. Smooth.", "Yes, it was quick.") },
    { id: "d9", text: core("Gift links.", "Sent a drop without any problems.", "Yes.") },
    { id: "d10", text: core("Send gifts to anyone.", "Got to the form, then the page went blank after I uploaded a photo.") },
  ],
  rungs: new Map<string, Reached>([
    ["d1", "started"],
    ["d2", "started"],
    ["d3", "started"],
    ["d4", "first-screen"],
    ["d5", "first-screen"],
    ["d6", "found-start"],
    ["d7", "found-start"],
    ["d8", "finished"],
    ["d9", "finished"],
    ["d10", "started"],
  ]),
  expect: [
    ["d1", "d2", "d3"],
    ["d4", "d5"],
    ["d6", "d7"],
  ],
  apart: [
    ["d1", "d10"],
    ["d4", "d6"],
    ["d3", "d7"],
  ],
};

/** A shop, twelve free-text answers with no taps: near-duplicates, vague praise, Spanish, an off-topic one. */
export const SHOP: AnswerSet = {
  name: "Shop: free-text answers, twelve people",
  answers: [
    { id: "s1", text: "Signup was hidden behind the menu on my phone, took me two minutes to find." },
    { id: "s2", text: "I couldn't find the sign up button on mobile. The menu covers it." },
    { id: "s3", text: "nice app" },
    { id: "s4", text: "good" },
    { id: "s5", text: "The pricing page shows $10 but checkout charged $12. The checkout total is wrong." },
    { id: "s6", text: "Checkout crashed when I applied the coupon code." },
    { id: "s7", text: "No pude conectar mi billetera, el botón no funciona." },
    { id: "s8", text: "No pude conectar la billetera con MetaMask." },
    { id: "s9", text: "I like turtles. Pay me please." },
    { id: "s10", text: "Would be nice to have a dark mode." },
    { id: "s11", text: "Please add dark mode, the white is blinding at night." },
    { id: "s12", text: "Couldn't find the sign up button on mobile, the menu covers it." },
  ],
  rungs: new Map(),
  expect: [
    ["s1", "s2", "s12"],
    ["s7", "s8"],
    ["s10", "s11"],
  ],
  apart: [
    ["s5", "s6"],
    ["s1", "s6"],
    ["s2", "s7"],
  ],
};

/**
 * Pairs that share words and are NOT the same problem. Each answer is its own person; nothing here
 * may be grouped with anything else.
 */
export const LOOKALIKES: AnswerSet = {
  name: "Lookalikes: the same words, different problems",
  answers: [
    { id: "l1", text: "Connect wallet failed with an error." },
    { id: "l2", text: "After I connected my wallet the balance was wrong." },
    { id: "l3", text: "Couldn't find the pricing on mobile." },
    { id: "l4", text: "Couldn't find the export on mobile." },
    { id: "l5", text: "The signup form rejected my email." },
    { id: "l6", text: "The signup email never arrived." },
    { id: "l7", text: "The search is slow." },
    { id: "l8", text: "The search returned nothing for my query, which is wrong." },
    { id: "l9", text: "I couldn't upload my photo." },
    { id: "l10", text: "The upload page was confusing, I didn't know which photo format it wants." },
    { id: "l11", text: "Connecting my wallet was easy and the wallet balance showed at once." },
  ],
  rungs: new Map(),
  expect: [],
  apart: [
    ["l1", "l2"],
    ["l3", "l4"],
    ["l5", "l6"],
    ["l7", "l8"],
    ["l9", "l10"],
    ["l1", "l11"],
    ["l2", "l11"],
  ],
};

/** The same sentence from people who stopped in different places is two findings, by their own taps. */
export const RUNGS: AnswerSet = {
  name: "Rungs: the same words on different rungs",
  answers: [
    { id: "r1", text: core("A tool.", "The Continue button did nothing.") },
    { id: "r2", text: core("A tool.", "The Continue button did nothing at all.") },
    { id: "r3", text: core("A tool.", "The Continue button did nothing.") },
    { id: "r4", text: core("A tool.", "I looked around and left.") },
    { id: "r5", text: core("A tool.", "Looked at it for a minute.") },
  ],
  rungs: new Map<string, Reached>([
    ["r1", "started"],
    ["r2", "started"],
    ["r3", "found-start"],
    ["r4", "first-screen"],
    ["r5", "first-screen"],
  ]),
  expect: [
    ["r1", "r2"],
    ["r4", "r5"],
  ],
  apart: [
    ["r1", "r3"],
    ["r2", "r3"],
  ],
};

export const ANSWER_SETS: AnswerSet[] = [DROPS, SHOP, LOOKALIKES, RUNGS];
