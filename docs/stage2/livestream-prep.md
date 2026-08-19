# Livestream — read this off a second screen

*Wed 19 Aug, 9:00 AM EST · Panel: Finality Labs, Triage, Sage, Aitch, Agora*

Read the bold block. Stop. Let the host come back to you. The small bits are only if they dig.

---

## The loop — this is the answer to almost everything

Sage is an AI agent. This is what it does, in order:

1. **It opens your product and uses it itself.** Real browser. Clicks, signs up, tries things.
2. **It writes the testing missions** from what it actually saw in there.
3. **Real people do those missions** and write up what happened.
4. **It checks their report against what it saw with its own eyes.**
5. **It pays them in USDC, or refuses them.**

**I am not in any of those five steps.** That sentence is the product.

---

# Q1 — Introduce yourself and what you're building

> I'm Shariq. I built Sage, on my own.
>
> Sage is an AI agent that gets real people to use your product and pays them for honest feedback.
>
> What it actually does: it opens your product and uses it itself. It writes the testing missions
> from what it saw. Real people do those missions. It reads their reports, checks them against what
> it saw with its own eyes, and pays them in USDC.
>
> That's the whole loop, and I'm not in any step of it.
>
> It's for solo builders. People with a product and no users.

---

# Q2 — Why did you build this?

**Your strongest answer. Nobody else can give it.**

> I read the goal of this bootcamp before I joined. Real economic activity. Agents past the demo
> stage.
>
> I've built agents before. My last one was a marketplace where AI agents found compute, negotiated
> for it, and paid each other. No human anywhere.
>
> It was cool. But no real money ever entered it. Agents paying agents in a circle.
>
> So this time I wanted a real person putting money in at one end, a real person taking money out at
> the other, and the agent doing all the work in between.

**Agora is on this panel building the compute marketplace. Add this so it lands friendly:**

> That's not a knock on that direction. Agora's building there and I think it's where things go. I
> just wanted the outside-money part first.

*"Why is autonomous QA better than testing tools?"*
> Testing tools tell you your code works. They don't tell you a person can use it. Your tests pass
> and a stranger still can't find the signup button.

*"Why can agents change how software is tested?"*
> The expensive part was never the testing. It was the coordinating. Finding people, writing tasks,
> checking the work, paying. The agent does all four, for a ten dollar budget.

*"What changed your assumptions?"*
> I thought paying people would be the hard part. It wasn't. The hard part was teaching the agent to
> say no.

---

# Q3 — Hardest part of building it

> Teaching the agent to refuse someone.
>
> Paying people is easy. Refusing a real person who did real work is where you lose trust forever.
>
> So the agent doesn't judge writing. Before any tester shows up, it goes into the product and uses
> it itself. Then it compares the tester's report against what it saw.
>
> It checks people against its own eyes. That's the whole trick.

*"Any moment you got it badly wrong?"*
> The agent kept telling me products were dead. They weren't. Its own clicking was broken, and it
> was writing that down as a fact about the product. Nothing crashed. It just confidently told me
> something false. Now there's a rule: the agent's own failure can never become a finding about the
> product.

*"Anything technical you didn't expect?"*
> Money bugs don't look like bugs. A retry loop quietly burned nine dollars of credits overnight
> with nobody using the app. Nothing went red. Anything touching money needs a ceiling, not a retry.

---

# Q4 — What have you learned from real users?

> Eighteen people have been paid. Around fifty dollars, on GOAT Mainnet. Every payment is a public
> transaction you can go check.
>
> The number I like more is that the agent refused half of them. Twenty out of forty two.
>
> And the thing I learned about myself: testers write genuinely good feedback for two dollars. I
> thought they didn't, for weeks. I'd just never built a screen that showed it to me. It was sitting
> in their submissions the whole time.

*"Who are your earliest users?"*
> Testers, which works. One campaign filled ten slots in six hours. And founders, which is newer.
> Builders from this bootcamp, ten to twenty five dollar budgets.

*"Did feedback change the product?"*
> I had a rule that one wallet gets paid once, to stop farming. It also punished honest testers who
> did two missions properly. I was blocking my best users to stop my worst ones.

*"What surprised you?"*
> How good the refusals are. It caught two submissions that were nearly identical to each other. I
> didn't check that by hand. It just held them.

*"Biggest assumption you're still testing?"* — **say this before they ask**
> Whether founders fund it with their own money. So far I funded every campaign. The tester side is
> proven, the founder side isn't. There's one starting this week. His product, his ten dollars.

---

# Q5 — What's next?

> Three things.
>
> One, founders funding their own campaigns.
>
> Two, the agent should read the reports for you. Right now it hands you fifteen reports. It should
> say "four people got stuck at the same screen."
>
> Three, close the loop. You fix the thing, and the agent goes and tests whether the fix worked,
> with new people, without you asking.
>
> Success in six months is a founder I've never met running a campaign, and me never touching it.

*"Bigger role for agents later?"*
> More autonomy over the money, earned slowly. Anything it's unsure about gets held for a human
> today. That ceiling moves up when the agent earns it, not when I get impatient.

---

# Q6 — What's missing from the agent ecosystem?

**This closes back to Q2. Good finish.**

> Not infrastructure. We have rails now. Agents can pay each other.
>
> What's missing is a reason for money to enter in the first place.
>
> Most agent economies, including the one I built, are a closed circle. Agents paying agents. Turn
> off the grant and the whole thing stops.
>
> So I'd build the edges. A real person paying in because they got something they wanted. A real
> person getting paid because they did real work. The middle gets interesting on its own.

*"What tooling is missing?"*
> Limits. It's easy to give an agent a key. There's no standard way to give an agent a budget it
> can't go over. I had to build that myself as a contract.

*"Biggest barrier?"*
> Agents fail quietly. Mine didn't crash, it lied confidently. Until an agent can prove what it
> did, nobody sane lets one spend money.

*"What will the next wave build?"*
> Boring agents. One job, end to end, with someone actually paying at the end of it.

---

# Closing — one sentence (30 sec)

> **Sage is an AI agent that pays strangers to use your product and tell you the truth, and it
> decides who deserves the money. Not me.**

Stop there. Don't add anything.

---

## Spares

*"How does it work?"*
> It uses your product itself. It writes missions from what it saw. People do them. It checks their
> report against what it saw. It pays. About two and a half minutes.

*"Isn't it risky letting an AI spend money?"* — only if asked
> The agent doesn't hold the money. It sits in a contract the founder owns. All the agent can do is
> say "this person did this work." The contract works out the amount and checks its own limits. The
> agent proposes, the contract decides.

*"Why GOAT and Metis?"*
> I'm paying people two or three dollars. That only works if the fee is nearly nothing. And every
> payout becomes a public receipt, so nobody has to take my word for it.

*"Business model?"*
> A small fee on what settles. It only earns when a payout actually goes through.

---

## Numbers (from prod this morning)

| | |
|---|---|
| People paid | **18** |
| Payouts | **22**, about **$50** USDC |
| Refused by the agent | **20 of 42** |
| Products inspected | **68** |
| Time to payout | **~2½ min** |

Say them flat. Small and real is the story.

---

## If you blank

> You build something and nobody uses it. Sage finds people who will, and pays them for telling you
> the truth.

Stop. Silence is the host's problem, not yours.

## Don't

- Don't explain the contract unless asked.
- Don't talk down the compute-marketplace idea. Agora is right there.
- Don't round any number up.

**sagepays.xyz** — the inspection is free.
