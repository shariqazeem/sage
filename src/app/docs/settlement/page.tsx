import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/site";
import { Doc, Next } from "../parts";

export const metadata: Metadata = {
  title: "Settlement and proof — how a Sage payout actually happens",
  description:
    "The vault computes the reward, enforces caps, rejects replays and emits the settlement event. Every payout publishes a public receipt anchored to an on-chain transaction anyone can verify.",
  alternates: { canonical: `${siteUrl()}/docs/settlement` },
};

export default function Settlement() {
  return (
    <Doc crumb="The agent">
      <h1>Settlement &amp; proof</h1>

      <div className="prose-answer">
        <p>
          <strong>The vault settles, not the agent.</strong> Once work is approved, an on-chain
          CampaignVault derives the exact reward, checks the caps, rejects replays and emits the
          settlement event that is the single source of truth. A public receipt is then published,
          citing the evidence the payout was made for.
        </p>
      </div>

      <h2>What the vault enforces</h2>
      <ul>
        <li>the exact reward, derived from the funded budget rather than supplied by a caller</li>
        <li>the per-mission cap and the completion limit</li>
        <li>replay protection, so the same approval can never settle twice</li>
        <li>the operator identity baked into the vault at deploy time</li>
      </ul>
      <p>
        The agent cannot exceed any of these by being wrong, by being persuaded, or by being
        compromised — they are contract conditions, not application logic.
      </p>

      <h2>Before a payout is signed</h2>
      <p>
        A payout is never broadcast against a chain the system cannot show is current: if the RPC
        head looks stale, settlement holds rather than signing into uncertainty. Gas is never taken
        at the bare estimate, and a failed estimate does not take the payout down with it. A
        transaction the node explicitly refused is treated as retryable; a nonce consumed by some
        other transaction is never treated as proof this payout happened.
      </p>
      <p>
        These sound like small operational details. They are the difference between &ldquo;we think
        it paid&rdquo; and a ledger you can stand behind.
      </p>

      <h2>The receipt</h2>
      <p>
        Every settled payout publishes a page at <code>/proof/&lt;tx&gt;</code> showing the
        transaction, the recipient, the mission, and the evidence the agent read to justify it. It is
        a durable public artifact: the tester can share it, and anyone can check the transaction on
        the network explorer without our cooperation.
      </p>
      <p>
        The payout ledger and the feedback log published with the project are{" "}
        <em>generated from production data</em> rather than written by hand, which is why every
        figure in them can be re-derived.
      </p>

      <h2>Getting unspent money back</h2>
      <p>
        Stopping a campaign revokes the vault and returns the remaining balance on-chain. Because the
        budget compiler holds the exactness invariant, the amount still in the vault is always
        exactly the amount that was never claimed.
      </p>
      <p>
        When a campaign ends with submissions still open, those submissions are resolved with an
        honest written reason rather than left pending — see{" "}
        <Link href="/docs/judging">Judging evidence</Link>.
      </p>

      <Next
        items={[
          { href: "/docs/safety", title: "The safety model" },
          { href: "/docs/interfaces", title: "Web, Telegram & API", label: "Or" },
        ]}
      />
    </Doc>
  );
}
