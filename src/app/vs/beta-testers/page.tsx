import "../../content.css";
import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/site";

/**
 * COMPARISON PAGE — one of the two content shapes that earn AI citations and that this site had
 * none of (GOAT Growth Tip Sheet §3.3, Ops Manual Play 15).
 *
 * Written for extraction rather than persuasion: a question-shaped heading with its answer directly
 * beneath, the direct answer inside the first 60 words, short paragraphs, and every number stated
 * with where a reader can check it. The "where hiring people is still better" section is not
 * humility for its own sake — a comparison that concedes nothing reads as marketing and gets
 * discounted by readers and models alike, so the honest limits are part of the argument.
 *
 * Every claim here is one Sage can back today. The two third-party statistics found during the GEO
 * baseline are deliberately absent: they were never confirmed against a primary source, and a wrong
 * number invites a correction that costs more reach than the citation was worth.
 */
export const metadata: Metadata = {
  title: "Paid AI-run product testing vs hiring beta testers",
  description:
    "Hiring beta testers means you recruit, brief, chase and review. Sage on GOAT Network does all four itself, then pays testers in USDC for verified evidence. An honest comparison, including where hiring people is still the better choice.",
  alternates: { canonical: `${siteUrl()}/vs/beta-testers` },
};

export default function VsBetaTestersPage() {
  return (
    <main className="prose-page">
      <div className="prose-wrap">
        <p className="prose-eyebrow">Comparison</p>
        <h1>Sage vs hiring beta testers</h1>

        <div className="prose-answer">
          <p>
            <strong>The short answer.</strong> Hiring beta testers costs you the recruiting, the
            briefing, the chasing and the reviewing. Sage on GOAT Network does all four itself: it
            browses your product in a real browser, writes the missions from what it saw, checks each
            tester&rsquo;s report against its own observations, and pays them in USDC automatically.
            You approve the plan and fund it. That is the entire human involvement.
          </p>
        </div>

        <h2>How is this different from a testing marketplace?</h2>
        <p>
          A marketplace gives you testers and hands the work back to you. You still write the brief,
          read every submission, and decide who gets paid. Sage writes the brief from first-hand
          observation and makes the payment decision itself, and every decision publishes a receipt
          at <code>/proof/&lt;txHash&gt;</code> that is recomputed from the chain each time it loads
          rather than read from a stored flag.
        </p>

        <h2>What stops the AI from paying out badly?</h2>
        <p>
          The agent proposes and a smart contract disposes. Each campaign&rsquo;s budget sits in an
          on-chain vault that derives the exact reward, enforces the per-mission cap and the
          completion limit, and rejects anything outside them. No model output moves money on its
          own, and Sage never holds your keys.
        </p>
        <p>
          A tester&rsquo;s report must quote things Sage itself observed while exploring, so an
          account that could have been written without opening the product does not clear. A mission
          whose evidence cannot be checked is discarded before anyone is shown it.
        </p>

        <h2>What does it cost?</h2>
        <p>
          You set the budget. Rewards are derived from it deterministically, so the sum of every
          possible payout equals exactly what you funded. Money that is never claimed is recoverable:
          stopping a campaign revokes the vault and returns the balance on-chain.
        </p>

        <h2>Do I need a wallet?</h2>
        <p>
          No. <a href="https://t.me/sagedeputybot">@sagedeputybot</a> on Telegram runs the whole loop
          walletless. It creates a server wallet bound to a spending policy and funds the campaign
          from it, so you never connect anything or leave the chat. Or use a browser wallet on
          sagepays.xyz if you prefer one.
        </p>

        <h2>Honest comparison</h2>
        <div className="prose-table-scroll">
          <table>
            <thead>
              <tr>
                <th />
                <th>Hiring beta testers</th>
                <th>Sage (sagepays.xyz)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Who writes the test plan</td>
                <td>You</td>
                <td>The agent, from browsing your product</td>
              </tr>
              <tr>
                <td>Who reviews submissions</td>
                <td>You, every one</td>
                <td>The agent, against what it observed</td>
              </tr>
              <tr>
                <td>Who decides payment</td>
                <td>You</td>
                <td>The vault, within limits it cannot exceed</td>
              </tr>
              <tr>
                <td>Proof of payment</td>
                <td>Your word</td>
                <td>An on-chain transaction and a receipt page</td>
              </tr>
              <tr>
                <td>Setup time</td>
                <td>Days</td>
                <td>About ninety seconds to a live plan</td>
              </tr>
              <tr>
                <td>Where it runs</td>
                <td>Anywhere</td>
                <td>GOAT Network mainnet, in USDC</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="prose-caveat">
          <p>
            <strong>Where hiring people is still better.</strong> Deep exploratory testing by a
            domain expert, anything requiring judgement about taste, and any flow that genuinely
            needs credentials Sage must never ask a tester to share. Sage is narrow on purpose: it
            turns one product and one budget into paid, verified testing, and it is judged on whether
            the payouts hold up.
          </p>
        </div>

        <div className="prose-footer">
          <p>
            Compare it instead to <Link href="/vs/bug-bounty">running a bug bounty</Link>, read the{" "}
            <Link href="/faq">FAQ</Link>, or point it at your own product and watch it work.
          </p>
        </div>
      </div>
    </main>
  );
}
