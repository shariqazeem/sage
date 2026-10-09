// THE SCRIPT — the one source for the deck's speaker notes, SCRIPT.md and the printable PDF.
// Edit words here, then run `node build-deck.js && node build-script.mjs`.
// A line starting with "DO " is an action (bold caps in print); everything else is spoken.
// `slide` is the Keynote slide shown; entries with `where` instead happen in Chrome.
// `by` is the clock time the step should END at. Target finish 4:35; 6:00 is the hard stop.
// `{refusals}` is filled from the live ledger at build time.
module.exports = [
  { slide: 1, name: "Opening", by: "0:15", note: "Learn these three lines by heart.", lines: [
    "Hi, I'm Shariq, and I built Sage.",
    "In the next few minutes I'll post a job, and an AI agent will check the work and pay for it. Live. Nobody will approve that payment, not even me.",
    "But first, why it matters here.",
  ]},
  { slide: 2, name: "The problem", by: "0:45", lines: [
    "Think of a seller in Kingston. She delivers, she gets paid on WhatsApp, and the proof stays in a chat.",
    "So when she asks a bank for credit, she has nothing to show.",
    "In Jamaica, small businesses are ninety percent of jobs, and over forty percent of firms say finance is a major constraint. Not bad businesses. Unrecorded ones.",
  ]},
  { slide: 3, name: "Sage", by: "1:10", lines: [
    "Sage fixes the record by fixing the payment. It's an AI agent that checks the work, pays for it in minutes from a vault it can't overspend, and turns every payment into a record a lender can read.",
    "And it's not a prototype. It has paid real people real money since July. In August it won first place, Grand Champion, at the OpenClaw Summer Bootcamp, from Metis, GOAT Network, ClawUp and CryptoChicks.",
  ]},
  { slide: 4, name: "Live", by: "1:15", lines: [
    "Let me show you. Live, on Arc's test network, so these are test dollars. The same engine pays real money on mainnet.",
    "DO Cmd+Tab to Chrome: the buyer's window, on sagepays.xyz, already signed in.",
  ]},
  { where: "Chrome · buyer", name: "Post the job", by: "1:55", lines: [
    "I'm the buyer. I write what I want in one sentence, in my own money: put my shop's price list online, three items in Jamaican dollars, J$160.",
    "DO Click \"Draft with Sage\".",
    "Sage is turning that sentence into a real job: the steps, what must be true when it's done, and what counts as proof. Those are the rules it will judge by.",
    "DO When the form fills, point at the rules and the price. Tick \"Only people I invite\". Click \"Create the gig\".",
  ]},
  { where: "Chrome · buyer", name: "Launch it", by: "2:15", lines: [
    "Now I fund it. I don't send money to anyone. Sage creates a vault on chain, funds it from my account, and switches it on.",
    "DO Click \"Let Sage launch it from your account on Arc Testnet\".",
    "Live. The vault holds exactly the reward, and Sage can't pay a cent more.",
    "DO Click \"the board\". Copy the address: Cmd+L, Cmd+C.",
  ]},
  { where: "Chrome · seller", name: "Do the work", by: "2:35", lines: [
    "DO Switch to the seller's window (Cmd+`). Paste the address: Cmd+L, Cmd+V, Enter.",
    "Now I'm the seller, a different person with my own wallet. I've already put my price list online.",
    "DO Click \"Submit evidence\". Type the shop link. Click \"Sign + submit evidence\".",
    "Submitted.",
  ]},
  { where: "Chrome · seller", name: "Sage decides", by: "3:25", note: "The money moment. Slow down.", lines: [
    "DO Scroll down to \"Sage activity\".",
    "Watch. Sage is opening my page itself, not trusting my word.",
    "It checks every rule the buyer set: three items, prices in J-dollars, the shop's name, and my wallet on the page, so nobody else can claim my work.",
    "It has to quote the exact words it relied on. And it can say no: it has refused {refusals} times so far, every time with the reason written down.",
    "DO If it is still checking, say nothing. Silence while the room watches is fine.",
    "DO When it says Paid: stop talking for two seconds.",
    "Paid. Nobody approved that. Not me, not anyone.",
    "DO Click \"proof\" on the Paid line. Scroll to \"Sage decision receipt\".",
    "Here's the receipt: the decision, how sure it was, and the exact words from my page. Anyone in this room can open it.",
    "DO Cmd+Tab to Keynote. Press →.",
  ], ifStuck: [
    "Drafting takes over 60 seconds, or launch fails: \"Here's the same job, posted this morning.\" Open the buyer's second tab (the backup job), copy its address, and carry on from the seller step.",
    "No Paid after 60 seconds: \"It's checking on chain. Here's the one I ran an hour ago.\" Cmd+Tab to Keynote and →. The next slide shows that receipt.",
    "It says Held: \"It held this one for a person to check. That's the guard working: it would rather wait than pay for weak proof.\" Cmd+Tab and →.",
  ]},
  { slide: 5, name: "Receipt and record", by: "3:50", note: "Works whether the live run paid or stalled.", lines: [
    "If it paid live: \"That's the receipt you just saw, and that payment just became a line in my record.\"",
    "If it stalled: \"Here's the receipt from the run an hour ago, and the record it became.\"",
    "Verified income over thirty and ninety days, who paid me and for how long, how often my work passes. Published formulas over real receipts, not a black-box score. A lender reads it in one call.",
  ]},
  { slide: 6, name: "Next", by: "4:15", lines: [
    "Now imagine where this goes. Next, you won't even post the job: you give Sage a goal and a budget, and it decides what to buy and tells you why before it spends.",
    "Every small business gets an AI finance worker that pays on proof and turns every job into credit. After a hurricane, a programme could pay a thousand people for verified clean-up in minutes.",
  ]},
  { slide: 7, name: "The ask", by: "4:30", lines: [
    "The engine is live. It needs the institutions it was built for: an MSME programme, a cooperative, and a lender who'd price verified cash flow instead of collateral. Twenty minutes with any of you is our next milestone.",
    "DO Press → for the last slide.",
  ]},
  { slide: 8, name: "Close", by: "4:35", lines: [
    "Sage. Payments that verify themselves. Credit records that write themselves. Thank you.",
    "DO Then stop talking.",
  ]},
];
