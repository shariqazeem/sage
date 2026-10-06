// THE SCRIPT — the one source for the deck's speaker notes, SCRIPT.md and the printable PDF.
// Edit words here, then run `node build-deck.js && node build-script.mjs`.
// A line starting with "DO " is an action (shown in bold caps); everything else is spoken.
// `by` is the clock time the slide should END at (6:00 is the hard stop). `{refusals}` is filled from
// the live ledger at build time.
module.exports = [
  { slide: 1, name: "Opening", by: "0:20", note: "Learn these four lines by heart.", lines: [
    "Hi, I'm Shariq, and I built Sage.",
    "In the next six minutes, an AI agent will check someone's work and pay them. Live. With real money.",
    "Nobody will approve that payment. Not me. Not anyone.",
    "But first, why it matters here.",
  ]},
  { slide: 2, name: "The seller", by: "0:42", lines: [
    "Think of a seller in Kingston. She delivers an order. She gets paid on WhatsApp.",
    "The money moves. The proof stays in a chat.",
    "So when she asks a bank for credit, she has nothing to show. To the bank, her business doesn't exist.",
  ]},
  { slide: 3, name: "The gap", by: "1:02", lines: [
    "And she's not alone. In Jamaica, small businesses are ninety percent of jobs.",
    "More than forty percent of firms say finance is a major constraint.",
    "They're not bad businesses. Nothing trustworthy records that they're good.",
  ]},
  { slide: 4, name: "What Sage is", by: "1:22", lines: [
    "Sage fixes the record by fixing the payment.",
    "It's an AI agent with a budget. It checks the work. It pays in minutes.",
    "And every payment becomes a line in a credit record a lender can read.",
  ]},
  { slide: 5, name: "Not a prototype", by: "1:46", lines: [
    "And this is not a prototype. Sage has paid real people, real money, since July.",
    "Every payment opens to a public transaction.",
    "In August it won first place, Grand Champion, at the OpenClaw Summer Bootcamp, from Metis, GOAT Network, ClawUp and CryptoChicks.",
  ]},
  { slide: 6, name: "A budget, not your keys", by: "2:06", lines: [
    "Why trust an agent with money? Because it gets a budget, not your keys.",
    "The agent decides who gets paid. A vault on the blockchain decides how much, and the agent cannot change those limits.",
  ]},
  { slide: 7, name: "LIVE", by: "3:36", note: "The only part with actions.", lines: [
    "So let's do it. Earlier today I posted this job, priced in Jamaican dollars: put your shop's price list online. J$160.",
    "I'm playing the seller. This is my phone.",
    "DO Cmd+Tab → Chrome (the job page).",
    "DO Hold up the phone. Tap Submit.",
    "I'm submitting my link — now.",
    "This is the job's public page. Watch the activity.",
    "Sage is opening my page itself. Not my note: the page.",
    "It checks every rule the buyer set: three items, prices in J-dollars, the shop's name, and my wallet on the page, so nobody else can claim my work.",
    "It has to quote the exact words it relied on. If it can't quote it, it can't pay for it.",
    "And it can say no. It has refused {refusals} times so far, and wrote down why every time.",
    "The amount isn't up to the AI. The vault already holds exactly J$160 for this job.",
    "DO If it is still checking: say nothing. Silence while the room watches is fine.",
    "DO When \"Paid\" appears: stop talking for two seconds.",
    "Paid. I didn't approve that. Nobody did.",
    "DO Click \"proof\" on the Paid line. The receipt opens.",
    "DO Scroll down once, to the card that says \"Sage decision receipt\".",
    "Here's the receipt. The decision, how sure it was, and the exact words from my page it decided on. Anyone in this room can open it.",
    "DO Cmd+Tab → back to Keynote. Press →.",
  ], ifStuck: [
    "Nothing after 60 seconds: \"It's real money, so it settles in its own time. Here's the same job from my rehearsal an hour ago.\" Then Cmd+Tab back to Keynote and →. The next slide is that rehearsal receipt.",
    "It says HELD: \"It held this one for a person to check. That's the guard working: it would rather wait than pay for weak proof.\" Then Cmd+Tab and →.",
    "The phone fails: don't fix it on stage. \"Let me show you the one I ran an hour ago.\" Cmd+Tab and →.",
  ]},
  { slide: 8, name: "The receipt", by: "3:52", note: "Same slide whether the live run paid or stalled. Only this sentence changes.", lines: [
    "If it paid live: \"Every payout carries what you just saw. This is the decision Sage wrote down, in its own words.\"",
    "If it stalled: \"Here's the same job, paid at rehearsal an hour ago. This is the decision Sage wrote down, in its own words.\"",
  ]},
  { slide: 9, name: "The record", by: "4:24", lines: [
    "Now the part that matters for finance. That payment just became a line in my record:",
    "verified income over thirty and ninety days, how many different people paid me, how long I've earned, how often my work passes.",
    "Published formulas over real receipts. Not a black-box score.",
    "A lender reads all of it in one call.",
  ]},
  { slide: 10, name: "The region", by: "4:46", lines: [
    "And it speaks the region's money: J-dollars, TT-dollars, EC-dollars, Barbados dollars, and six more.",
    "It settles in digital dollars, at a flat ten cents. The person paid keeps everything.",
    "Sending two hundred dollars home to Guyana costs almost eight percent.",
  ]},
  { slide: 11, name: "Next", by: "5:22", lines: [
    "Now imagine where this goes.",
    "Next, you won't even post the job. You give Sage a goal and a budget, and it decides what work to buy, and tells you why before it spends.",
    "Every small business gets an AI finance worker: it pays on proof, keeps the books as receipts, and turns every job into credit.",
    "After a hurricane, a recovery programme could pay a thousand people for verified clean-up in minutes, not weeks.",
  ]},
  { slide: 12, name: "The ask", by: "5:40", lines: [
    "The engine is live. Now it needs the institutions it was built for.",
    "An MSME programme that wants to pay on proof. A cooperative. And a lender who'd price verified cash flow instead of collateral.",
    "Twenty minutes with any of you is our next milestone. The code on screen takes you to everything you saw.",
  ]},
  { slide: 13, name: "Close", by: "5:50", lines: [
    "Sage. Payments that verify themselves. Credit records that write themselves.",
    "Thank you.",
    "DO Then stop talking.",
  ]},
];
