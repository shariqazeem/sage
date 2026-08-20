import "../../content.css";
import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/site";

/**
 * CASE STUDY — the third content shape the site had none of (GOAT Growth Tip Sheet §3.3), and the
 * one the GEO report kept listing as a gap: a publicly readable account of real results that lives
 * on our own domain rather than inside a GitHub markdown file.
 *
 * Written for extraction, same as the comparison pages: question-shaped headings with the answer
 * directly beneath, the direct answer inside the first 60 words, and every number stated with the
 * place a reader can re-derive it. Every figure below was read from the production database or from
 * GOAT Mainnet on 2026-08-19; where a number is small we say so rather than dressing it up, because
 * a case study that concedes nothing reads as marketing and gets discounted accordingly.
 *
 * The "what we got wrong" section is deliberately the longest. It is the most useful thing in here
 * for anyone building something similar, and honest failure is the most citable thing a case study
 * can contain.
 */
export const metadata: Metadata = {
  title: "Case study: an AI agent paid 16 people in USDC to test software",
  description:
    "Between July and August 2026 an autonomous agent inspected 68 products, judged 42 tester submissions, refused 20 of them, and settled $48.10 USDC to 16 people on GOAT Network — with no human approving any individual payment. The real numbers, the defects testers found, and what we got wrong.",
  alternates: { canonical: `${siteUrl()}/case-studies/autonomous-paid-testing` },
};

export default function AutonomousPaidTestingCaseStudy() {
  return (
    <main className="prose-page">
      <div className="prose-wrap">
        <p className="prose-eyebrow">Case study</p>
        <h1>What happened when an AI agent paid 16 people to test software</h1>

        <div className="prose-answer">
          <p>
            <strong>The short answer.</strong> Between July and August 2026, Sage ran seven paying
            campaigns on GOAT Network. It inspected 68 different products, judged 42 tester
            submissions and refused 20 of them. Total settled: <strong>$48.10 USDC across 20 payouts
            to 16 different wallets</strong>. No human approved any individual payment. Every
            payout has a public receipt anchored to an on-chain transaction.
          </p>
        </div>

        <h2>What does the agent actually do?</h2>
        <p>
          Five steps, in order. It opens the product in a real headless browser and explores it. It
          writes testing missions from what it observed, not from the marketing copy. Real people
          complete those missions and submit written accounts. It checks each account against its own
          observations of the product. Then it pays in USDC, or refuses.
        </p>
        <p>
          A human is not in any of those five steps. The founder does exactly two things in the whole
          lifecycle: approve the plan and fund it.
        </p>

        <h2>The numbers</h2>
        <div className="prose-table-scroll">
          <table>
            <thead>
              <tr>
                <th />
                <th>Result</th>
                <th>Where it can be checked</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>USDC settled</td>
                <td>$48.10</td>
                <td>GOAT Mainnet, chain 2345</td>
              </tr>
              <tr>
                <td>Autonomous payouts</td>
                <td>20</td>
                <td>One receipt page per transaction</td>
              </tr>
              <tr>
                <td>Distinct people paid</td>
                <td>16 wallets</td>
                <td>On-chain transfer log</td>
              </tr>
              <tr>
                <td>Submissions judged</td>
                <td>42</td>
                <td>20 refused, each with a written reason</td>
              </tr>
              <tr>
                <td>Refusal rate</td>
                <td>48%</td>
                <td>Every refusal carries a written reason</td>
              </tr>
              <tr>
                <td>Products inspected</td>
                <td>68 distinct URLs</td>
                <td>733 inspection jobs</td>
              </tr>
              <tr>
                <td>Median time to payout</td>
                <td>175 seconds</td>
                <td>Submission to settled transaction</td>
              </tr>
              <tr>
                <td>Fastest payout</td>
                <td>15 seconds</td>
                <td>Half of all payouts landed under 90s</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>Campaign one: testing another company&rsquo;s product</h2>
        <p>
          The agent was pointed at <code>clawup.org</code>, an AI agent platform. Before designing
          anything it signed into the product itself with its own test account — password, emailed
          verification code and all — created an agent, and interacted with it. The missions came out
          of that observed workflow.
        </p>
        <p>
          Two missions shipped: create your first agent and chat with it, and connect a messaging
          channel to a fresh agent. Six people submitted eight reports. Four were paid —
          two at $5.26 and two at $4.74, the vault splitting the $20 budget to the exact base unit. Every one of those six ended the session with a working agent connected to
          a live messaging channel.
        </p>
        <p>
          The reports came back specific enough to be useful to the tested company: a
          verification-code button that changes to &ldquo;sending&rdquo; and reverts with no countdown,
          agent creation taking about 120 seconds with no progress signal, and a channel-pairing flow
          that spans three separate surfaces. None of those testers had used the product before that
          day.
        </p>

        <h2>Campaign two: ten strangers paid in forty-five minutes</h2>
        <p>
          The second campaign funded $25 and asked testers to run an inspection and report what they
          saw. Fourteen people submitted. Ten were paid $2.50 each. The first payout settled at 03:50
          UTC and the last at 04:36 — <strong>the entire campaign filled and paid out in
          forty-five minutes</strong>, with no human approving any of the ten payments.
        </p>
        <p>
          That result changed our model of the problem. We had assumed finding testers would be the
          hard part. It is not. The binding constraint is budget, not supply.
        </p>

        <h2>Why were 48% of submissions refused?</h2>
        <p>
          Because an agent that can only say yes is not judging anything. Building something that
          pays is easy; building something that looks at work and declines is the entire difficulty,
          and it is what makes a payout mean anything.
        </p>
        <p>
          Refusals are not all judgements on the tester. Every one carries a written reason naming the
          real cause — the campaign ended, the mission filled, the founder withdrew, the wallet was
          already paid — and says so plainly when the work itself was fine. Nothing is left pending:
          all 42 submissions are resolved.
        </p>

        <h2>What did the testers find?</h2>
        <p>
          Real users found defects that code review did not. Two testers independently reported that
          an inspection failed with &ldquo;the reviewer returned an unusable response.&rdquo; The
          cause was that the model had wrapped its reply in a markdown fence and our parser treated a
          fence as malformation. The planner had been dead for two days with a green test suite.
        </p>
        <p>
          Four testers had submissions that could never pay, because the campaign had ended, and they
          were left waiting indefinitely with no explanation. Terminal campaigns now resolve every
          dependent submission with an honest written reason. A separate bug fired 239 hold
          notifications for four submissions, because a hold was being treated as an event rather than
          a state.
        </p>
        <p>
          Nine defects reported by real users were fixed during the period. Four more remain open and
          are listed publicly rather than quietly closed.
        </p>

        <h2>What did we get wrong?</h2>
        <p>
          We recorded &ldquo;paid testers give no feedback&rdquo; as a finding. Four testers had been
          paid and none replied when asked for feedback afterwards, so we wrote down that paid testers
          are not willing feedback sources.
        </p>
        <p>
          That reading was wrong, and finding out why was the most valuable thing the period taught
          us. All eight of those testers had written detailed feedback — the exact pairing command,
          the three credential shapes each channel needs, the deployment state sequence, a timing
          measurement. It was inside their submissions the entire time. Nobody had withheld anything.
          We had simply never built a screen that showed a founder what the people they paid had
          written, and then concluded from that silence that the feedback did not exist.
        </p>
        <p>
          The lesson generalises past this product: <strong>a metric reading zero is a claim about
          your instrument before it is a claim about the world.</strong> Two changes came out of it.
          Feedback became the paid work itself on the next campaign, which produced thirteen pieces of
          real feedback in a few hours. And the founder console now shows every tester&rsquo;s written
          account, including the ones the agent held or refused.
        </p>

        <h2>How is any of this verifiable?</h2>
        <p>
          Every payout resolves to a transaction on GOAT Mainnet and has a public receipt page citing
          the evidence it was paid for. The payout ledger and the feedback log are generated from
          production data rather than written by hand. None of it rests on our word: a reader can
          check each transaction on the network explorer without our cooperation.
        </p>

        <div className="prose-caveat">
          <p>
            <strong>The honest limits.</strong> These numbers are small. $48.10 is not a business, and
            eighteen testers is not a market. More importantly, every campaign so far was funded by us
            rather than by an outside founder — the supply side is proven and the demand side is not.
            We state that here for the same reason we publish the refusals: a result that concedes
            nothing is not a result, it is an advertisement.
          </p>
        </div>

        <div className="prose-footer">
          <p>
            Compare it to <Link href="/vs/beta-testers">hiring beta testers</Link> or{" "}
            <Link href="/vs/bug-bounty">running a bug bounty</Link>, read the{" "}
            <Link href="/faq">FAQ</Link>, or point it at your own product and watch it work.
          </p>
        </div>
      </div>
    </main>
  );
}
