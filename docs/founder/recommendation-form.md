# Founder profile — reusable answers

Raw material for LinkedIn recommendations, award forms, grant applications and accelerator
intros. Written once, reused everywhere.

## The rule that keeps this from going stale

**Scope every number to a window, in the past tense.** "During the bootcamp it judged 42
submissions" is true forever. "It has judged 42 submissions" is wrong tomorrow. The counts only
ever grow, so an unscoped present-tense number is a promise to keep editing this file — and the
one time you forget, a stale figure is sitting in something permanent and public.

Anything in `{{BRACES}}` is a live number. Fill it from the ledger, never from memory:

```bash
ssh ubuntu@80.225.209.190 'cd /home/ubuntu/sage && node -e "
const db=require(\"better-sqlite3\")(\"./var/sage.db\",{readonly:true});
const g=s=>db.prepare(s).get().n;
const paid=g(\"SELECT COUNT(*) n FROM submissions WHERE status=%27paid%27\");
const rej=g(\"SELECT COUNT(*) n FROM submissions WHERE status=%27rejected%27\");
console.log({paid, refused:rej, judged:paid+rej, refusalPct:Math.round(100*rej/(paid+rej)),
  earners:g(\"SELECT COUNT(DISTINCT wallet) n FROM submissions WHERE status=%27paid%27\"),
  submitters:g(\"SELECT COUNT(DISTINCT wallet) n FROM submissions\"),
  campaigns:g(\"SELECT COUNT(*) n FROM campaigns\")});
"'
```

**Which numbers are safe to publish.** Payment and judgment counts moved real money or refused
to, so testing cannot inflate them. Inspection counts CAN be inflated — every evaluation-battery
run against motherfuckingwebsite.com, tailwindcss.com, play2048.co and the rest is a real
inspection and not a real customer. Quote inspections only for a stated window you can defend.

**Never lead with the dollar total.** The counts prove the system works; the total understates it
because the campaigns were deliberately run small. Never hide it if asked directly.

---

## Achievements — the core answer

> Three things, with the numbers so they're checkable.
>
> **1. I shipped to mainnet, not to a demo.** Sage is an autonomous AI agent that pays people in
> USDC for verified work. During the bootcamp {{SUBMITTERS}} people submitted work to it. It judged
> {{JUDGED}} submissions, paid {{EARNERS}} different people, and refused {{REFUSED}}. No human
> approved a single payment.
>
> That {{REFUSAL_PCT}}% refusal rate is what I'd most want highlighted. Anyone can build an agent
> that pays. Building one that reads the work and says no is the whole difficulty, and it's what
> makes a payout mean anything.
>
> **2. I owned the go-to-market myself.** I designed and self-funded my own user acquisition
> campaign, with no grant gas and no program promotion. Putting it in front of strangers found what
> no test would have, including a coordinated fraud attempt where four apparently separate testers
> turned out to be one person rotating wallets. I caught it on-chain, built the defence, and
> published the write-up, including publicly correcting a payout I had described as organic.
>
> **3. The hard part was never the agent, it was making autonomy safe with money.** The agent
> decides and pays with nobody in the loop, but an on-chain vault enforces the limits, so it cannot
> exceed what the contract allows no matter what any input tells it. Every payout leaves a receipt
> anyone can verify.

**Optional fourth item — only if the agent-to-agent payout is real.** It is the most distinctive
fact for an AI-focused reader, and unverifiable in the submissions table, so it rests on your own
recollection:

> **4. An AI agent earned from it.** An autonomous agent found one of Sage's jobs, did the work,
> submitted the same evidence a human submits, was judged by the same verifier, and was paid.

---

## Personal brand direction

> Entrepreneurship backed by technical depth. A founder who ships production systems, not
> prototypes.
>
> I build at the intersection of autonomous agents and payments: systems that handle money safely
> on their own, with verification built in rather than bolted on. Where I'm taking Sage next is
> turning its payment history into portable proof of work, so someone with no credit history
> accumulates a record a lender can actually check. Same infrastructure, aimed at financial
> inclusion.
>
> The reputation I want is simple: trusted to build autonomous systems that touch real money.

---

## What could be improved (asked by most programs)

> What I valued most was that the programme rewarded real economic activity over demos. That pushed
> me past "this looks good on stage" into the problems that only appear with real users and real
> payments, and the freedom to execute independently is where the actual learning happened.
>
> For future cohorts, I'd suggest more structured guidance on production realities: key management,
> adversarial testing, agent safety, and what "verified" has to mean before money moves. Those were
> the most important parts of my build and the least covered. Everyone hits them the moment they
> leave the demo.

---

## Memorable moment / why you built it

> The moment Sage stopped being something I had built and started working for someone else.
>
> Watching the agent read a stranger's work, decide on its own, and complete an on-chain USDC
> payment with a receipt anyone could check, was when it stopped being a demonstration and became a
> thing that operates.
>
> Winning 1st Place was an incredible moment. But that first autonomous payout, to someone I'd
> never spoken to, is what I'll actually remember.

---

## Short forms

**One line:** Founder of Sage, an autonomous AI agent that pays people in USDC for verified work on
mainnet, with an on-chain vault enforcing every limit.

**Two sentences:** I build autonomous agents that handle money safely. Sage judges human work and
pays USDC with nobody in the loop, refusing roughly half of what it's shown, and every payout
leaves a receipt anyone can verify.

**Bio line:** Building verifiable AI payments. 1st Place, OpenClaw Summer Bootcamp 2026.

---

## When a recommendation draft comes back for approval

Check it contains at least one number. If it reads "demonstrated strong ownership and technical
excellence," ask for specifics:

> Thank you, this is very kind. One small request: would it be possible to include a couple of the
> concrete numbers? Something like "paid {{EARNERS}} people autonomously and refused
> {{REFUSAL_PCT}}% of submissions", or "self-funded his own user acquisition campaign and took it
> live on mainnet". I've found specifics land better than adjectives with the people who read
> these, and everything there is verifiable.

A recommendation full of adjectives is forgettable. One with a verifiable fact in it keeps working
for years.

---

## Checklist before sending anything

- [ ] Every `{{PLACEHOLDER}}` replaced from the ledger, not from memory
- [ ] Numbers scoped to a window and in the past tense
- [ ] LinkedIn URL filled in
- [ ] Name spelling confirmed if a certificate is being printed
- [ ] Form submitted BEFORE the reply that says you submitted it
