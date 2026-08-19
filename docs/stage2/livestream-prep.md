# Livestream — read this, don't prepare

*Wednesday 19 Aug, 9:00 AM EST · "What Is the Next Wave of AI Builders Building?"*
*Host: Arshiya · Panel: Finality Labs, Triage, Sage, Aitch, Agora · ~60 min*

You are unwell. Do not memorise anything. Every answer below is written the way you talk, so you
can read it off a second screen and it will still sound like you. Short sentences on purpose — you
can breathe between them.

**It is a panel, not a presentation.** You get 1–2 minutes per question. That is about one screen of
text below. Read the bold answer, stop, and let the host come back to you. The extra bits are only
if they ask a follow-up.

**Rule for the whole hour: when you say a number, say where it can be checked.** "Eighteen people,
and every payment is a public transaction you can go look at" beats any adjective.

---

## The only line to actually know

> **"Sage is an AI agent that finds real people to use your product, and pays them for honest
> feedback."**

If your mind goes blank at any point, say that sentence and stop talking. Someone will ask a
follow-up. Silence is fine.

---

# Q1 — "Introduce yourself, your team, and what you're building" (1–2 min)

> I'm Shariq. I built Sage, and it's just me.
>
> So you know how you build something, you ship it, and then nothing happens? You send it to your
> friends and they say "looks nice." Nobody actually uses it.
>
> Sage fixes that. You give it your product link and a small budget. It goes and finds real
> strangers to use your product, and it pays them in USDC for honest feedback.
>
> The part I care about is that I'm not in the middle. The agent decides who did real work and who
> didn't, and it pays them itself. I approve nothing.
>
> I'm building it for solo builders and small teams. The people who have a product and no users, and
> no budget for a research agency.

*If they ask for one more beat:*

> So far it's paid eighteen different people, around fifty dollars, all on GOAT Mainnet. And it
> refused about half of what came in.

---

# Q2 — "What made you build this?" (1–2 min)

**This is your best answer of the day. It's the one nobody else on the panel can give.**

> Honestly it came from reading the purpose of this bootcamp before I joined.
>
> It said real economic activity. Agents past the demo stage. And that hit something for me, because
> I've built AI agents before, and they were the other kind.
>
> The one I was most proud of was a marketplace where AI agents could discover compute, negotiate
> for it, and pay for it themselves, with no human involved. It was genuinely cool. I still think
> that's the future.
>
> But I sat with it and realised something uncomfortable. There was no real economic activity in it.
> Agents paying agents, in a loop. No actual person at either end. Nothing entering the system, and
> nothing coming out.
>
> So this time I wanted the opposite. I wanted the money to come from a real person, and go to a
> real person, and the agent to be the thing in the middle that does the judging. That's Sage.

**Careful, and this is the generous version — Agora is on this panel building the compute
marketplace.** Do not make it sound like you're saying their thing doesn't work. Say this:

> And that's not a knock on that direction at all. Agora is building in that space and I think it's
> where things are going. I just wanted to work on the part where the money enters from outside
> first.

### Follow-up: "What makes autonomous QA valuable compared with traditional testing tools?"

> Traditional testing tools tell you if your code works. They don't tell you if a person can use it.
>
> Your tests can be green and a stranger still can't find the signup button. There's no assertion for
> confusion.
>
> Sage covers the other half. Real humans, real confusion, in their own words. And an agent that
> checks they actually did the work before paying them.

### Follow-up: "Why can AI agents fundamentally change how software is tested?"

> Because the expensive part of user testing was never the testing. It was the coordinating.
>
> Finding people, writing the tasks, checking they did it, paying them. That's a person's whole job
> and it's why only funded companies do it.
>
> An agent can do all four of those, all day, for a ten dollar budget. That's the change. It's not
> better testing, it's testing that small builders can actually afford.

### Follow-up: "What did the bootcamp change about your assumptions?"

> Two things.
>
> I assumed the hard part would be paying people. It wasn't. Payment was the easy part.
>
> The hard part was getting the agent to say no to somebody. And I assumed testers wouldn't write
> real feedback for two or three dollars. They absolutely do. Some of it was better than what I get
> from friends.

---

# Q3 — "What was the hardest part of building it?" (1–2 min)

**Lead with this one. It's short and it lands.**

> Getting the agent to say no.
>
> Anyone can build something that pays people. It's very hard to build something you'd trust to
> refuse someone. Because the moment it refuses a real person who did real work, they're angry, and
> they're right to be.
>
> So most of my time didn't go into the payment side at all. It went into the agent's eyes.
>
> Before anyone tests your product, Sage opens it in a real browser and uses it itself. Clicks
> around, signs up, tries the flows. Then when a tester writes up what they did, the agent compares
> their words against what it saw with its own eyes.
>
> That's the whole trick. It's not judging the writing. It's checking the writing against something
> it independently knows is true.

### Follow-up: "Was there a moment you got it wrong?"

**This is the story people will remember. Use it if there's room.**

> Yes, and it's embarrassing.
>
> There was a point where the agent kept reporting that products were broken. Dead pages, nothing
> working. And I believed it for a while.
>
> The products were fine. The agent's clicking was broken. My server was too small, so the clicks
> were silently timing out, and the agent was writing that down as "this product is dead."
>
> It was recording its own failure as a fact about the world. That's the scariest bug I've ever
> written, because nothing crashed. It just confidently told me something false.
>
> Now there's a rule in the codebase. If the agent's own tools fail, that can never be recorded as a
> finding about the product.

### Follow-up: "Anything technical you had to figure out that you didn't expect?"

> Money bugs don't look like bugs.
>
> I had a retry that kept asking the model to re-judge some stuck submissions. It never crashed,
> nothing went red, and it quietly burned about nine dollars of my API credits overnight with nobody
> even using the app.
>
> I only found it because I read the raw error log. My database showed nothing, because a failed run
> doesn't write a row.
>
> Lesson I actually use now: if something touches money, it needs a ceiling. Not a retry.

---

# Q4 — "Now that real users have used it, what have you learned?" (1–2 min)

> The main thing I learned is that I was measuring the wrong side.
>
> Four people got paid early on, and afterwards I asked them for feedback and nobody replied. So I
> wrote it down as a finding. Paid testers don't give feedback.
>
> That was completely wrong. They'd all written detailed feedback. Exact steps, real bugs, things I
> didn't know about. It was sitting inside their submissions the whole time.
>
> I'd just never built a screen that showed it to me.
>
> So I'd concluded something about human behaviour when the real problem was my own dashboard. I
> spent this week rebuilding that page so a founder reads every tester's words as one page.

### Follow-up: "Who are your earliest users?"

> Two sides.
>
> Testers, which is working. Eighteen people paid, they came from Telegram and X, and one campaign
> filled ten slots in under six hours.
>
> And founders, which is the newer side. Builders from this bootcamp, mostly. Small products,
> ten to twenty five dollar budgets.

### Follow-up: "Did any user feedback change how you think about the product?"

> Yes. My anti-fraud rules were too strict in a way I couldn't see.
>
> I had a rule that one wallet gets paid once. It was there to stop farming. But it also meant an
> honest tester who did two different missions properly only got paid for one.
>
> I was punishing my best users to block my worst ones. That was real people, not a theory.

### Follow-up: "What surprised you most?"

> How good the refusals were.
>
> The agent has refused about half of everything submitted. Twenty out of forty two. Thin work,
> copied work, people who clearly didn't open the product.
>
> And it caught two submissions that were almost identical to each other. I didn't hand-check that.
> It just held them.
>
> An agent that pays everybody isn't doing a job. It's a faucet.

### Follow-up: "What's the biggest assumption you're still validating?"

**Say this before anyone digs for it. Saying it first sounds like someone who knows where they
stand.**

> Whether founders will fund it with their own money.
>
> Every campaign so far, I funded. The tester side is proven, people show up and do real work and
> get paid. The founder side isn't proven yet.
>
> There's one starting this week. A builder from this bootcamp, his product, his ten dollars. That's
> the number I want to be able to report next time, not the tester number.

---

# Q5 — "What's next?" (1–2 min)

> Three things, in order.
>
> First, founders funding their own campaigns. That's the only thing that matters right now, and I
> just said where I am with it.
>
> Second, the agent should tell you what it learned, not just show you a list. Right now a founder
> reads fifteen reports. It should be reading them for you and saying, four people got stuck at the
> same screen, here's what they said.
>
> Third, the loop should close. Fix the thing, and the agent should go and test whether the fix
> actually worked, with new people, without you asking.
>
> In six months, success for me is very simple. A founder I've never spoken to launches a campaign,
> funds it themselves, and gets useful feedback, and I never touch it.

### Follow-up: "Where do AI agents play a bigger role in your product later?"

> The judging gets better and the agent gets more autonomous with the money over time.
>
> Right now on mainnet I hold anything the agent isn't confident about, and a human looks at it. As
> the evidence gets stronger, that ceiling can move up.
>
> But it should move up because the agent earned it, not because I got impatient.

---

# Q6 — "What's still missing from the AI agent ecosystem?" (1–2 min)

**This closes the loop back to Q2. Strong finish.**

> I'll give an unpopular answer. I don't think what's missing is infrastructure.
>
> We have a lot of rails now. Agents can pay each other, discover each other, negotiate. That part is
> genuinely getting solved.
>
> What's missing is a reason for money to enter the system in the first place.
>
> Almost every agent economy I've seen, including the one I built myself, is a closed loop. Agents
> paying agents. Very impressive, and no outside money in it. If you turn off the grant, it stops.
>
> So the thing I'd want more people building is the edges. Agents where a real person pays money in
> at one end because they got something they wanted, and a real person takes money out at the other
> end because they did real work.
>
> Get the edges working and the middle gets interesting on its own.

### Follow-up: "What tooling or standards do builders still need?"

> The one I hit constantly is limits.
>
> It's easy to give an agent a key. There's nothing standard for giving an agent a budget. A thing
> that says: you can spend this much, on this, and no more, and it's enforced somewhere the agent
> can't reach.
>
> I had to build that myself as a contract. It should be a primitive everybody gets.

### Follow-up: "What's the biggest barrier to agents being useful in the real world?"

> Trust, and specifically that agents fail quietly.
>
> Mine didn't crash when it broke. It confidently told me products were dead. That's much worse than
> an error.
>
> Until an agent can prove what it actually did, no normal person is going to let one spend money.
> That's why every payment mine makes ends up as a public receipt.

### Follow-up: "What will the next wave of builders build?"

> I think boring ones, and I mean that as a compliment.
>
> The first wave was agents that could talk. The next one is agents that do one job, end to end,
> where somebody's actually paying at the end of it.
>
> Less general, more finished.

---

# Closing — "One sentence people should remember" (30 sec)

> **Sage is an AI agent that pays real strangers to use your product and tell you the truth, and it
> decides who deserves the money, not me.**

Then stop. Don't add anything after it.

---

## Spare answers, if the host goes off-script

**"How does it actually work?"**

> Three steps and the agent does all of them.
>
> It opens your product in a real browser and uses it, like a person would. Then it writes the
> testing missions itself, based on what it actually saw in there. Then people do those missions,
> and it checks their write-up against what it saw itself. If it lines up, they get paid. Usually in
> about two and a half minutes.

**"Isn't it risky to let an AI spend money?"** — *only if asked. Don't bring it up yourself.*

> Yes, and that's why the agent doesn't hold the money.
>
> The money sits in a contract the founder owns. The agent can't take money out of it. All it can do
> is say "this person did this work" — and the contract works out the amount itself and checks its
> own limits.
>
> The agent proposes, the contract decides. Even if someone stole my keys, they couldn't drain it.
> They could only ask, same as the agent.

**"Why GOAT and Metis?"**

> Because the payments are tiny and they have to be provable.
>
> I'm paying people two or three dollars. That only works if the fee is nearly nothing. And every
> payout becomes a public transaction, which is the actual product. A tester can show someone their
> receipt, and a founder can check I'm not making the numbers up.

**"What's your business model?"**

> A small fee on what settles. The agent only earns when a payout actually goes through.
>
> Right now I'd rather have ten founders using it free than one paying, so I'm not pushing it yet.

---

## Your numbers (checked on prod this morning)

| | |
|---|---|
| People paid | **18 different people** |
| Payouts made | **22** |
| USDC settled | **about $50**, all on GOAT Mainnet |
| Refused by the agent | **20 out of 42 — about half** |
| Products inspected | **68** |
| Typical time to payout | **about 2½ minutes** |
| Campaign filled | **10 slots in under 6 hours** |

Say them plainly. Eighteen people and fifty dollars is small and real, and you sound better saying
it flat than dressing it up. Small and real is the story — this bootcamp asked for real economic
activity, and yours is real, just small.

---

## If your mind blanks completely

Say this. It works for almost any question:

> Honestly the simplest way to say it. You build something and nobody uses it. Sage goes and finds
> people who will, and pays them for telling you the truth about it.

Then stop.

---

## Four things not to do

- **Don't explain the contract unless asked.** Nobody on a livestream wants architecture. They want
  to know what the agent does.
- **Don't talk down the compute-marketplace idea.** Agora is on this panel. Say "I think that's the
  future, I just wanted the outside-money part first."
- **Don't oversell.** If you're tempted to round up, say the real number and say it's checkable.
- **Don't fill silence.** If you finish and nobody speaks, that's the host's job, not yours.

---

## Where to send people

> sagepays.xyz — the inspection is free, you just point it at your product and watch it browse.
