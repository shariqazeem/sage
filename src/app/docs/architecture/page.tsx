import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/site";
import { Doc, Next } from "../parts";

export const metadata: Metadata = {
  title: "Sage architecture — three model layers and one settlement core",
  description:
    "Sage separates mission design, evidence judgement and conversation into three model layers that do not share state, sitting on top of an on-chain settlement core. Autonomy is a stateless gate, not a running loop.",
  alternates: { canonical: `${siteUrl()}/docs/architecture` },
};

export default function Architecture() {
  return (
    <Doc crumb="The agent">
      <h1>Architecture</h1>

      <div className="prose-answer">
        <p>
          <strong>Three model layers and one settlement core.</strong> One layer designs missions,
          one judges evidence, one talks to founders. They are split on purpose and do not share
          state. Underneath them, an on-chain vault computes every amount and enforces every limit —
          it is the only thing that can release funds.
        </p>
      </div>

      <h2>Why three layers instead of one model</h2>
      <p>
        Because a single model that designs the work, judges the work and talks to the customer can
        be talked out of all three at once. Splitting them means a conversation cannot reach the
        layer that decides payouts, and a product page cannot reach the layer that decides whether a
        tester gets paid.
      </p>

      <div className="prose-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Layer</th>
              <th>What it does</th>
              <th>What it is forbidden to do</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Mission Brain</td>
              <td>Designs missions from an inspected product — architect, then critic, then a deterministic validation gate</td>
              <td>Ship anything the gate rejects. Its output is untrusted until it passes.</td>
            </tr>
            <tr>
              <td>Payout Brain</td>
              <td>Judges tester evidence and proposes pay, review or hold</td>
              <td>State an amount. Ever.</td>
            </tr>
            <tr>
              <td>Concierge</td>
              <td>The conversational front door on Telegram and on the web</td>
              <td>Do its own money arithmetic, or import the judging layer at all</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p>
        The concierge does not import the judging code, so no conversation can perturb the layer that
        decides payouts. The two share an LLM endpoint and nothing else.
      </p>

      <h2>Is there an agent loop running somewhere?</h2>
      <p>
        No, and that is deliberate. Autonomy here is a <strong>stateless gate with two triggers</strong>.
        A tester submits, and the decision pipeline runs once. Separately, an authenticated sweep
        re-evaluates pending work, settles matured approvals and pays operator fees on a short
        cadence, with a lock that makes overlapping ticks harmless.
      </p>
      <p>
        The pipeline never throws for control flow. Any failure resets the work to pending so the
        next sweep picks it up — nothing is lost because a request died halfway through.
      </p>

      <h2>The settlement core</h2>
      <p>
        Each campaign has its own on-chain vault. The vault derives the exact reward from the funded
        budget, enforces the per-mission cap and the completion limit, rejects replays, and emits the
        settlement event that is the single source of truth. A model output is a recommendation
        arriving at a contract that has its own opinion.
      </p>
      <p>
        <strong>The agent proposes. The vault disposes.</strong> That sentence is the security model,
        and it is enforced by a contract rather than by careful behaviour. See{" "}
        <Link href="/docs/settlement">Settlement &amp; proof</Link>.
      </p>

      <h2>Degradation</h2>
      <p>
        With no model available, the judging layer falls back to a transparent keyword heuristic that{" "}
        <strong>cannot auto-pay anything</strong> — it can only hold work for review. The failure mode
        of losing the model is that money stops moving, never that it moves wrongly.
      </p>

      <Next
        items={[
          { href: "/docs/missions", title: "Missions & budget" },
          { href: "/docs/safety", title: "The safety model", label: "Or" },
        ]}
      />
    </Doc>
  );
}
