import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/site";
import { Doc, Next, Cards } from "./parts";

export const metadata: Metadata = {
  title: "Sage documentation — an AI agent that pays people to test your product",
  description:
    "How Sage works: it browses your product, writes the testing missions, judges what real testers submit, and settles USDC from an on-chain vault it cannot exceed. Architecture, guarantees, and interfaces.",
  alternates: { canonical: `${siteUrl()}/docs` },
};

export default function DocsOverview() {
  return (
    <Doc crumb="Documentation">
      <h1>Sage documentation</h1>

      <div className="prose-answer">
        <p>
          <strong>What Sage is.</strong> An AI agent that turns one product URL and one budget into
          paid, verified testing. It browses the product itself, designs the missions, judges what
          real people submit, and pays them in USDC on GOAT Network. Three separate model layers do
          the reasoning; none of them can move money — an on-chain vault computes every amount and
          enforces every limit.
        </p>
      </div>

      <h2>Where to start</h2>
      <Cards
        items={[
          {
            href: "/docs/how-it-works",
            title: "How it works",
            body: "The five steps end to end, and the two moments a human is actually involved.",
          },
          {
            href: "/docs/architecture",
            title: "Architecture",
            body: "Three model layers, one settlement core, and why autonomy here is a gate rather than a loop.",
          },
          {
            href: "/docs/safety",
            title: "The safety model",
            body: "What still holds if the model is wrong, jailbroken, or offline entirely.",
          },
          {
            href: "/docs/settlement",
            title: "Settlement & proof",
            body: "How a payout is computed, capped, signed, and published as a receipt anyone can check.",
          },
        ]}
      />

      <h2>Who it is for</h2>
      <p>
        Founders with a live product and not enough real users to know what breaks. You have a URL
        and a hypothesis about what a first-time visitor should do, but not enough traffic to learn
        whether they actually get it. Sage turns that into paid missions and pays the testers for
        you.
      </p>
      <p>
        It is deliberately narrow. It is not a generic agent platform, a chatbot, or a bug bounty —
        it turns one product and one budget into verified testing, and it is judged on whether the
        payouts hold up.
      </p>

      <h2>What it costs and who holds the money</h2>
      <p>
        You set the budget and it sits in a vault you own. Rewards are derived from it
        deterministically, so the sum of every possible payout equals exactly what you funded. Money
        that is never claimed is recoverable: stopping a campaign revokes the vault and returns the
        balance on-chain. Sage never holds your keys.
      </p>

      <h2>Is any of this real?</h2>
      <p>
        Every payout resolves to a public transaction on GOAT Network with a receipt page citing the
        evidence it paid for. The{" "}
        <Link href="/case-studies/autonomous-paid-testing">case study</Link> reports the full Stage 2
        result — products inspected, submissions judged, how many were refused — with the place each
        figure can be re-derived from.
      </p>

      <Next
        items={[
          { href: "/docs/how-it-works", title: "How it works", label: "Start here" },
          { href: "/docs/architecture", title: "Architecture", label: "Or skip to" },
        ]}
      />
    </Doc>
  );
}
