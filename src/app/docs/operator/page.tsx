import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/site";
import { Doc, Next } from "../parts";

export const metadata: Metadata = {
  title: "Fund once, then stop deciding — the standing mandate",
  description:
    "Sage decides where to spend and never how much: a founder funds a treasury once, the agent proposes each next piece of work with its reason and price, waits out a veto window, and the vault enforces the ceilings.",
  alternates: { canonical: `${siteUrl()}/docs/operator` },
};

export default function Operator() {
  return (
    <Doc crumb="The agent">
      <h1>Fund once, then stop deciding</h1>

      <div className="prose-answer">
        <p>
          <strong>Sage decides where to spend. It never decides how much.</strong> A founder funds a
          treasury once and names the product. From then on the agent chooses the next piece of work
          to buy — which surface, what kind of work — and a pure policy prices it from the ceilings
          the founder set and from what the board has actually produced. Every move is written down
          with its reason and its price before a dollar leaves, and waits out a window in which the
          founder can stop it.
        </p>
      </div>

      <h2>What it decides, and what it cannot</h2>
      <p>
        The model&rsquo;s one decision is <em>position</em>: a surface the founder named, and whether
        the next thing to buy there is a testing run, a gig or a grant. That is the whole of its
        authority. A proposal that names an amount is rejected, not corrected; a surface outside the
        founder&rsquo;s own set is refused rather than sanitised. The amount comes from arithmetic
        nobody can argue with: a first probe (default $5), scaled by results up to three times, and
        held under a per-campaign ceiling ($15), a weekly ceiling ($50), a reserve floor the treasury
        never drops below, a cap on how much may sit on the board unclaimed (60% of the treasury), a
        concurrency limit (three campaigns at once) and a spacing rule (90 minutes between moves).
        Every figure in that sentence is the founder&rsquo;s to change; none of them is the
        model&rsquo;s to touch.
      </p>

      <h2>Proposed first, then a window</h2>
      <p>
        A move is recorded before money moves — the surface, the kind, the goal, the reason and the
        price — and then it waits. Inside the window (default 20 minutes) the founder can stop it
        with one click, or tell it to go now. When the window passes, Sage deploys the campaign,
        funds it from the treasury inside the per-campaign cap, and activates it; the missions it
        buys are public work, claimable by anyone who has proved they are one person. Every move,
        stopped or launched, stays on the workspace ledger with its reason.
      </p>

      <h2>What the board teaches it</h2>
      <p>
        Work that gets claimed earns a larger budget next time. Work nobody comes to is stopped after
        a stall window and the money returns to the treasury. And it never buys the same silence
        twice: while unclaimed work already sits on the board past the exposure cap, the answer to
        &ldquo;what next&rdquo; is to wait for it to be worked — stated as the reason, not hidden.
      </p>

      <h2>Alive at $0 — the rehearsal</h2>
      <p>
        Before any money is in, the workspace shows the move Sage would make: the same closed set of
        surfaces, the same ceilings, the same sizing, run against a treasury imagined at the floor
        plus one campaign. Nothing is recorded and nothing can commit; the line a founder reads is
        the line the agent would propose. When the board is full it says so — &ldquo;three campaigns
        are already running&rdquo; — and still shows the move that follows.
      </p>

      <h2>What it will never do</h2>
      <ul>
        <li>spend past the ceilings — the vault enforces the payout side on-chain</li>
        <li>buy work against a product the founder did not name</li>
        <li>set its own prices — the amount is the policy&rsquo;s, never the model&rsquo;s</li>
        <li>move before the founder can object</li>
      </ul>

      <h2>Where the money sits</h2>
      <p>
        The treasury binds to the founder&rsquo;s own Ethereum account on GOAT Network (an email
        account holds one too). Sage deploys, funds and activates each campaign itself, inside the
        per-campaign cap the mandate enforces, and the founder&rsquo;s wallet is the only place
        unspent money can go back to. What the agent may do with that money is bounded twice: by the
        policy above, and by the vault every campaign settles through — see{" "}
        <Link href="/docs/safety">the safety model</Link>.
      </p>

      <Next
        items={[
          { href: "/docs/safety", title: "The safety model" },
          { href: "/docs/missions", title: "Missions & budget", label: "Or" },
        ]}
      />
    </Doc>
  );
}
