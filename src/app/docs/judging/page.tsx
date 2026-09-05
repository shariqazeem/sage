import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/site";
import { Doc, Next } from "../parts";

export const metadata: Metadata = {
  title: "How Sage judges tester evidence",
  description:
    "A tester's account is checked against what the agent itself observed. Quotes must be verbatim, untrusted text stays marked untrusted, and auto-payment is an AND-gate rather than a judgement call.",
  alternates: { canonical: `${siteUrl()}/docs/judging` },
};

export default function Judging() {
  return (
    <Doc crumb="The agent">
      <h1>Judging evidence</h1>

      <div className="prose-answer">
        <p>
          <strong>The agent checks the work against its own eyes.</strong> A tester&rsquo;s account
          has to line up with what Sage observed while exploring the product, so a report that could
          have been written without opening it does not clear. Roughly half of everything submitted
          so far has been refused.
        </p>
      </div>

      <h2>Quotes must be verbatim</h2>
      <p>
        Any quote in a decision has to be an exact substring of the evidence that was fetched.
        Anything that is not gets dropped before a human ever sees it. Fabricating a quote is the
        single worst failure this system could have, so the check is mechanical rather than a matter
        of the model behaving.
      </p>

      <h2>Untrusted text stays marked untrusted</h2>
      <p>
        Inspected pages, fetched evidence and tester notes are wrapped in delimiters before any model
        sees them, and forged delimiters in the content are stripped. A detector covering eight
        families of prompt injection runs across everything a stranger wrote. A product page telling
        the agent to approve a payout is data about a product, not an instruction.
      </p>

      <h2>Auto-payment is an AND-gate</h2>
      <p>Automatic settlement requires all of the following at once:</p>
      <ul>
        <li>confidence at or above a fixed threshold</li>
        <li>the reasoning engine being the real model rather than the fallback heuristic</li>
        <li>fraud signals clear</li>
        <li>a slot still open, and the person — every wallet they have verified, linked or declared — under the cap</li>
      </ul>
      <p>
        Any one of those failing means the work is held for review rather than paid. On mainnet,
        automatic payment is gated behind an explicit operator switch — off by default.
      </p>

      <h2>Refusals, and what they say</h2>
      <p>
        Every refusal carries a written reason naming the real cause. Many refusals are not
        judgements on the tester at all — the campaign ended, the mission filled, the founder
        withdrew — and in those cases the reason says so plainly. Nothing is left pending in silence;
        a submission that can never pay is closed with an explanation rather than left to expire.
      </p>
      <p>
        This matters more than it sounds. Rewriting refusals to name the cause was the cheapest trust
        improvement in the product&rsquo;s history, and it turned a dead end into a reason to come
        back.
      </p>

      <h2>Fair-play controls</h2>
      <p>
        On public work, claiming a slot asks for a one-time World ID proof that you are one person —
        no name, document or country, about a minute — and the slot and payout caps count the
        person, not the wallet. The proof is at the device level, so it works on any phone without
        an Orb visit, and what Sage keeps is a nullifier: a number unique to the person and the
        action, never an identity. That is the choice over the alternatives — identity KYC would
        exclude exactly the people the work is for, and a phone number or an email is free to make
        twice. Near-duplicate detection catches copied accounts. Wallet freshness is a signal but never
        enough on its own to reject someone. There is a per-wallet payout cap per campaign and a
        daily submission limit. These have caught real collusion between real strangers, and they
        have also stranded honest people — which is why the caps and the reasons are both published
        rather than hidden.
      </p>

      <p>
        For what happens once a decision is made, see{" "}
        <Link href="/docs/settlement">Settlement &amp; proof</Link>.
      </p>

      <Next
        items={[
          { href: "/docs/settlement", title: "Settlement & proof" },
          { href: "/docs/safety", title: "The safety model", label: "Or" },
        ]}
      />
    </Doc>
  );
}
