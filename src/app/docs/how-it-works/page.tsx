import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/site";
import { Doc, Next } from "../parts";

export const metadata: Metadata = {
  title: "How Sage works — the five steps",
  description:
    "Sage opens your product in a real browser, writes testing missions from what it saw, real people complete them, it checks each report against its own browsing, then pays in USDC or refuses. A human is in none of those five steps.",
  alternates: { canonical: `${siteUrl()}/docs/how-it-works` },
};

export default function HowItWorks() {
  return (
    <Doc crumb="Start here">
      <h1>How it works</h1>

      <div className="prose-answer">
        <p>
          <strong>Five steps, in this order.</strong> Sage opens your product in a real headless
          browser and explores it. It writes testing missions from what it observed. Real people
          complete them. It checks each report against its own observations. Then it pays in USDC,
          or refuses. A human is in none of those five steps.
        </p>
      </div>

      <h2>1 · It looks at your product</h2>
      <p>
        Sage loads the product in a real browser rather than reading the HTML. It follows links,
        opens what a visitor can open, and records the states it can actually reach — screenshots,
        rendered content, console errors, forms it could fill. The output is a map of the product as
        a visitor experiences it, not as the marketing copy describes it.
      </p>
      <p>
        It reads only public pages by default. It never signs in or spends anything unless you hand
        it a dedicated test account, and even then it uses a mailbox it owns rather than asking you
        for an inbox credential.
      </p>

      <h2>2 · It writes the missions</h2>
      <p>
        Missions come out of what it saw. If it found a signup flow, there is a mission about the
        signup flow; if it never reached one, there is not. A deterministic gate sits between the
        model and the plan — a mission that cannot be verified, or that asks a tester to do
        something the agent could not confirm exists, is discarded before you are shown it.
      </p>
      <p>
        You review the plan once and approve it. That is the first of the two human moments. See{" "}
        <Link href="/docs/missions">Missions &amp; budget</Link> for how rewards are derived.
      </p>

      <h2>3 · Real people complete them</h2>
      <p>
        Funded campaigns appear on a public board. Testers pick a mission, do the work, and submit a
        written account of what they saw. There is no application process and no interview — the
        work is the application.
      </p>

      <h2>4 · It checks the work against its own browsing</h2>
      <p>
        This is the part that makes a payout mean something. A tester&rsquo;s account has to line up
        with what Sage itself observed in the product, so a report that could have been written
        without opening it does not clear. Any quote in a decision must be an exact substring of the
        evidence; anything else is dropped. See{" "}
        <Link href="/docs/judging">Judging evidence</Link>.
      </p>

      <h2>5 · It pays, or it refuses</h2>
      <p>
        If the work clears, the vault computes the reward and settles USDC on-chain, and a public
        receipt is published citing the evidence it paid for. If it does not clear, the submission
        is refused with a written reason — and the reason says plainly when the refusal is not a
        judgement on the tester&rsquo;s work, which is often the case when a campaign has simply
        ended or filled.
      </p>

      <h2>The same loop pays for anything you can define</h2>
      <p>
        Testing is one instance of a more general machine: <em>verify a claim against evidence the
        agent gathers itself, then move money inside hard limits</em>. So the same five steps run{" "}
        <strong>gigs</strong> (&ldquo;pay my designer $50 when the logo page is live&rdquo;) and{" "}
        <strong>milestone grants</strong> (&ldquo;split J$10,000 across two milestones&rdquo;) —
        composed by hand on <Link href="/launch">/launch</Link>, compiled deterministically with no
        model in the path, and priced in the founder&rsquo;s own currency: the Caribbean
        denominations are first-class, converted once at a stamped, source-attributed rate, settled
        in USDC.
      </p>
      <p>
        And the loop leaves something behind: every payout lands on the earner&rsquo;s{" "}
        <strong>verified work record</strong>, which the{" "}
        <Link href="/lender">Advance facility</Link> can lend against — repaid by the waterfall from
        their next verified payouts. Money out, a record built, capital back in.
      </p>

      <h2>Where the human actually is</h2>
      <p>
        Exactly twice in the whole lifecycle: <strong>approve the plan</strong>, and{" "}
        <strong>fund it</strong>. Everything after that the agent does on its own and narrates
        afterwards with an artifact backing each claim.
      </p>

      <Next
        items={[
          { href: "/docs/architecture", title: "Architecture" },
          { href: "/docs/missions", title: "Missions & budget", label: "Or" },
        ]}
      />
    </Doc>
  );
}
