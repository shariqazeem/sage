import type { Metadata } from "next";
import Link from "next/link";
import { ReadHead, ReadPage } from "@/components/site/read-page";

export const metadata: Metadata = {
  title: "Paid AI-run product testing vs hiring beta testers",
  description:
    "Hiring beta testers means you recruit, brief, chase and review. Sage does all four itself, then pays testers in USDC for verified evidence. An honest comparison, including where hiring people is still the better choice.",
  alternates: { canonical: "/vs/beta-testers" },
};

/**
 * COMPARISON PAGE (restored 20 Oct 2026, in the company frame) — one of the two content shapes that
 * earn AI citations.
 *
 * Written for extraction rather than persuasion: a question-shaped heading with its answer directly
 * beneath, the direct answer inside the first 60 words, short paragraphs, and every claim one Sage
 * can back today. The "where hiring people is still better" section is part of the argument: a
 * comparison that concedes nothing reads as marketing and gets discounted by readers and models alike.
 */
export default function VsBetaTestersPage() {
  return (
    <ReadPage>
      <ReadHead eyebrow="Comparison" title="Sage vs hiring beta testers" />

      <div className="site-wrap read-col">
        <div className="read-answer">
          <p>
            <strong>The short answer.</strong> Hiring beta testers costs you the recruiting, the briefing, the chasing and
            the reviewing. Sage does all four itself: it browses your product in a real browser, writes the tasks from what
            it saw, checks each tester&apos;s report against its own observations, and pays them in USDC automatically.
            You approve the plan and fund it.
          </p>
        </div>

        <section className="read-sec">
          <h2>How is this different from a testing marketplace?</h2>
          <p>
            A marketplace gives you testers and hands the work back to you. You still write the brief, read every
            submission and decide who gets paid. Sage writes the brief from what it observed first-hand and makes the
            payment decision itself, and every payout publishes a receipt at <code>/proof/&lt;transaction&gt;</code> that
            anyone can check against the chain.
          </p>
        </section>

        <section className="read-sec">
          <h2>What stops the AI from paying out badly?</h2>
          <p>
            The AI proposes and the vault decides. Each job&apos;s budget sits in an on-chain vault that pays the exact
            reward, enforces the per-task cap and the completion limit, and rejects anything outside them. No model output
            moves money on its own.
          </p>
          <p>
            A tester&apos;s report has to match things Sage itself observed while exploring, so an account that could have
            been written without opening the product does not pass. A task whose evidence cannot be checked is dropped
            before anyone is shown it.
          </p>
        </section>

        <section className="read-sec">
          <h2>What does it cost?</h2>
          <p>
            You set the budget, and all of it goes to the people you pay: Sage takes no fee per payout and pays the network
            fee itself. Rewards are fixed from the budget when the job is made, so every possible payout adds up to exactly
            what you funded, and stopping a job returns what is left to you. Sage is{" "}
            <Link href="/pricing">free to start</Link>; paid plans add more live jobs and team features.
          </p>
        </section>

        <section className="read-sec">
          <h2>Do I need a wallet?</h2>
          <p>
            No. Sign in with an email and Sage opens an account for you to fund jobs from, under spending rules that only let
            it launch your jobs within your cap. Or run the whole thing from{" "}
            <a href="https://t.me/sagedeputybot">@sagedeputybot</a> on Telegram. A browser wallet works too.
          </p>
        </section>

        <section className="read-sec">
          <h2>An honest comparison</h2>
          <div className="read-table wide">
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="faint">Question</span>
                  </th>
                  <th scope="col">Hiring beta testers</th>
                  <th scope="col">Sage</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Who writes the test plan</td>
                  <td>You</td>
                  <td>Sage, from browsing your product</td>
                </tr>
                <tr>
                  <td>Who reviews submissions</td>
                  <td>You, every one</td>
                  <td>Sage, against what it observed</td>
                </tr>
                <tr>
                  <td>Who decides payment</td>
                  <td>You</td>
                  <td>The vault, inside limits it cannot exceed</td>
                </tr>
                <tr>
                  <td>Proof of payment</td>
                  <td>Your word</td>
                  <td>An on-chain transaction and a receipt page</td>
                </tr>
                <tr>
                  <td>Setup time</td>
                  <td>Days</td>
                  <td>Minutes to a live job</td>
                </tr>
                <tr>
                  <td>How people are paid</td>
                  <td>However you arrange it</td>
                  <td>USDC on Metis or GOAT Network (also Arc and Starknet)</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="read-note">
            <p>
              <strong>Where hiring people is still better.</strong> Deep exploratory testing by a domain expert, anything
              that needs judgement about taste, and any flow that genuinely needs credentials Sage must never ask a tester
              to share. Sage is judged on whether its payouts hold up, and every one of them is on the{" "}
              <Link href="/ledger">ledger</Link>.
            </p>
          </div>
        </section>

        <div className="read-foot">
          <p>
            Compare it instead to <Link href="/vs/bug-bounty">running a bug bounty</Link>, read the{" "}
            <Link href="/case-studies/autonomous-paid-testing">case study</Link> or the <Link href="/faq">FAQ</Link>, or{" "}
            <Link href="/start">point it at your own product</Link> and watch it work.
          </p>
        </div>
      </div>
    </ReadPage>
  );
}
