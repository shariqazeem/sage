import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/site";
import { Doc, Next } from "../parts";

export const metadata: Metadata = {
  title: "Missions and budget — how Sage designs work and prices it",
  description:
    "Missions come from what the agent observed, pass a deterministic gate, and are priced by a budget compiler where the sum of every possible payout equals exactly what was funded. No model computes a money amount.",
  alternates: { canonical: `${siteUrl()}/docs/missions` },
};

export default function Missions() {
  return (
    <Doc crumb="The agent">
      <h1>Missions &amp; budget</h1>

      <div className="prose-answer">
        <p>
          <strong>Missions come from observation, and money comes from arithmetic.</strong> The model
          proposes missions from what it actually saw in your product; a deterministic gate accepts or
          discards each one. Rewards are then compiled from your budget so that the sum of every
          possible payout equals exactly what you funded, to the base unit.
        </p>
      </div>

      <h2>How a mission gets designed</h2>
      <p>
        An architect pass proposes missions from the product map. A critic pass attacks them. Then a
        deterministic gate — ordinary code, not a model — decides what ships. The gate is the reason
        a weak model cannot produce a weak plan: it can only produce fewer missions.
      </p>
      <p>The gate discards a mission when:</p>
      <ul>
        <li>the evidence it asks for could not be checked afterwards</li>
        <li>it names a page, flow or destination the agent never actually reached</li>
        <li>it is a comprehension check — &ldquo;confirm that page X explains Y&rdquo; — which founders do not pay for and testers learn nothing from doing</li>
        <li>it asks the tester for a credential, a payment, or anything a stranger should never be asked to share</li>
      </ul>
      <p>
        A plan of pure reading is refused outright. If not one accepted mission asks the tester to
        interact with the product, the architect is asked again before the plan can ship.
      </p>

      <h2>How rewards are derived</h2>
      <p>
        You set a total budget. A deterministic compiler splits it across the missions, and the
        invariant it holds is exact: <strong>Σ(reward × completions) = the total you funded</strong>,
        in six-decimal base units, with no rounding drift.
      </p>
      <p>
        Within that, a completion is priced by the work it takes rather than by the size of the
        budget. Each mission carries an effort estimate, and the fair rate is anchored to that
        estimate with a floor beneath it, so a large budget buys <em>more testers</em> rather than
        absurd rewards for a handful.
      </p>

      <h2>You cannot overpay by accident</h2>
      <p>
        A plan can only absorb so much honestly. Every mission is capped at a maximum number of
        testers, and every completion is capped at what the work is worth, so the plan has a real
        ceiling. If your budget exceeds it, the allocator spends what the plan can absorb and tells
        you the remainder is deliberately unspent — it will not inflate rewards to burn a budget.
      </p>

      <h2>No model ever computes an amount</h2>
      <p>
        The mission model never sees or states money. The judging model is forbidden from stating an
        amount. The concierge is told never to do its own arithmetic and to relay what the tools
        return. Every figure a tester or founder sees comes from the compiler or from the vault. See{" "}
        <Link href="/docs/safety">the safety model</Link> for why that separation is load-bearing.
      </p>

      <Next
        items={[
          { href: "/docs/judging", title: "Judging evidence" },
          { href: "/docs/settlement", title: "Settlement & proof", label: "Or" },
        ]}
      />
    </Doc>
  );
}
