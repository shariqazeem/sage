import "../content.css";
import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/site";

/**
 * ARCHITECTURE DOCS — the public, readable version.
 *
 * The as-built docs in docs/fable-review/ are internal review material: they carry candid
 * "what is stubbed" and "honest flaws" sections written for a design reviewer, and they are not
 * what a founder or an answer engine should be reading. This page is written fresh for the outside
 * reader, and it makes one argument: the safety property is structural, not a promise. Every claim
 * here names the mechanism that enforces it, because "the agent is careful" is worth nothing and
 * "the contract computes the amount" is checkable.
 *
 * Same extraction-first shape as /vs and /case-studies: question-shaped headings, the answer
 * directly beneath, and no paragraph that survives only to sound impressive.
 */
export const metadata: Metadata = {
  title: "How Sage works — architecture and the safety model",
  description:
    "Sage is an AI agent that pays human testers in USDC for verified work. Three separate model layers design missions and judge evidence; an on-chain vault computes every amount and enforces every limit. The architecture, the invariants, and why a jailbroken model still cannot move money.",
  alternates: { canonical: `${siteUrl()}/docs` },
};

export default function DocsPage() {
  return (
    <main className="prose-page">
      <div className="prose-wrap">
        <p className="prose-eyebrow">Documentation</p>
        <h1>How Sage works</h1>

        <div className="prose-answer">
          <p>
            <strong>The short answer.</strong> Sage is an AI agent that turns one product URL and one
            budget into paid, verified testing. It browses the product itself, designs the missions,
            judges what testers submit, and pays them in USDC on GOAT Network. Three separate model
            layers do the reasoning. None of them can move money — an on-chain vault computes every
            amount and enforces every limit, and it is the only thing that can release funds.
          </p>
        </div>

        <h2>What does the agent actually do?</h2>
        <p>Five steps, in this order:</p>
        <ol>
          <li>Opens the product in a real headless browser and explores it — screenshots, rendered
            content, console errors, the states a visitor can actually reach.</li>
          <li>Designs testing missions from what it observed, not from the marketing copy.</li>
          <li>Real people complete those missions and submit written accounts.</li>
          <li>Checks each account against its own observations of the product.</li>
          <li>Pays in USDC, or refuses — with a written reason either way.</li>
        </ol>
        <p>
          No human is in any of those five steps. The founder does exactly two things across the whole
          lifecycle: approve the plan, and fund it.
        </p>

        <h2>Why are there three separate model layers?</h2>
        <p>
          Because a single model that designs the work, judges the work and talks to the customer can
          be talked out of all three at once. They are split on purpose, and they do not share state.
        </p>
        <div className="prose-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Layer</th>
                <th>Job</th>
                <th>What it is forbidden to do</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Mission Brain</td>
                <td>Designs missions from an inspected product — architect, then critic, then a
                  deterministic validation gate</td>
                <td>Ship anything the gate rejects. Model output is untrusted until it passes.</td>
              </tr>
              <tr>
                <td>Payout brain</td>
                <td>Judges tester evidence and proposes pay, review or hold</td>
                <td>State an amount. Ever.</td>
              </tr>
              <tr>
                <td>Concierge</td>
                <td>The conversational front door on Telegram</td>
                <td>Do its own money arithmetic, or import the judgment layer at all</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          The concierge deliberately does not import the judging code, so a conversation can never
          perturb the layer that decides payouts. They share an LLM endpoint and nothing else.
        </p>

        <h2>What stops the agent from paying for bad work?</h2>
        <p>
          Several things, in layers, and the important ones are not made of prompts.
        </p>
        <p>
          <strong>The evidence must be checkable.</strong> A tester&rsquo;s account has to line up with
          what Sage itself saw while exploring, so a report that could have been written without
          opening the product does not clear. Any quote in a decision brief must be an exact substring
          of the fetched evidence — anything else is dropped before a human ever sees it.
        </p>
        <p>
          <strong>Untrusted text stays marked as untrusted.</strong> Inspected pages, fetched evidence
          and submitter notes are wrapped in delimiters, and forged delimiters are stripped. A
          detector covering eight families of prompt injection runs over everything a stranger wrote.
        </p>
        <p>
          <strong>Auto-payment is an AND-gate, not a judgement call.</strong> Confidence has to clear a
          fixed threshold, the reasoning engine has to be the real model rather than the fallback, and
          the fraud signals have to be clear. With no model available at all, the system degrades to a
          transparent keyword heuristic that <em>cannot auto-pay anything</em> — it can only hold work
          for review.
        </p>

        <h2>What happens if the model is jailbroken anyway?</h2>
        <p>
          It still cannot move money, because it was never the thing that moves money.
        </p>
        <p>
          Each campaign&rsquo;s budget sits in an on-chain vault. The vault derives the exact reward
          from the funded budget, enforces the per-mission cap and the completion limit, rejects
          replays, and emits the settlement event that is the single source of truth. A model output
          is a recommendation arriving at a contract that has its own opinion.
        </p>
        <p>
          The budget itself is compiled deterministically: the sum of every possible payout equals
          exactly what was funded, to the base unit. Money that is never claimed is recoverable —
          stopping a campaign revokes the vault and returns the balance on-chain.
        </p>
        <p>
          <strong>The agent proposes. The vault disposes.</strong> That sentence is the whole security
          model, and it is enforced by a contract rather than by careful behaviour.
        </p>

        <h2>Is there an agent loop running somewhere?</h2>
        <p>
          No — and that is deliberate. Autonomy here is a stateless gate with two triggers. A tester
          submits, and the decision pipeline runs once. Separately, an authenticated sweep re-evaluates
          pending work, settles matured approvals, and pays operator fees on a short cadence, with a
          lock that makes overlapping ticks harmless.
        </p>
        <p>
          The pipeline never throws for control flow. Any failure resets the work to pending, so the
          next sweep picks it up. Nothing is lost because a request died halfway.
        </p>

        <h2>Can the founder be sure a payout really happened?</h2>
        <p>
          Every payout is a public transaction with a receipt page citing the evidence it was paid
          for. The payout ledger and the user feedback log are generated from production data rather
          than written by hand, so a reader can re-derive any figure we publish, and check every
          transaction on the network explorer without our cooperation.
        </p>

        <h2>Do I need a wallet?</h2>
        <p>
          No. <a href="https://t.me/sagedeputybot">@sagedeputybot</a> runs the entire loop from
          Telegram: it creates a server wallet bound to a spending policy and funds the campaign from
          it, so you never connect anything or leave the chat. Or use a browser wallet on this site if
          you prefer one. Sage never holds your keys either way.
        </p>

        <div className="prose-caveat">
          <p>
            <strong>What Sage is not.</strong> It is not a generic agent platform, a chatbot, or a bug
            bounty. It is deliberately narrow: one product and one budget become paid, verified
            testing, and it is judged on whether the payouts hold up. Deep exploratory testing by a
            domain expert, and anything needing credentials a tester should never share, are still
            jobs for a person.
          </p>
        </div>

        <div className="prose-footer">
          <p>
            See it against real numbers in the{" "}
            <Link href="/case-studies/autonomous-paid-testing">case study</Link>, compare it to{" "}
            <Link href="/vs/beta-testers">hiring beta testers</Link>, read the{" "}
            <Link href="/faq">FAQ</Link>, or read the source at{" "}
            <a href="https://github.com/shariqazeem/sage">github.com/shariqazeem/sage</a>.
          </p>
        </div>
      </div>
    </main>
  );
}
