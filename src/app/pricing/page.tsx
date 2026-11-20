import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/sage/button";
import { SiteFooter } from "@/components/site/site-footer";
import { NEW_TEST_HREF } from "@/components/shell/routes";
import { DEFAULT_TEST } from "@/lib/site/paste-link";
import { dollars } from "@/lib/site/when";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Sage is free to use. You pay only what the people who try your product earn, in USDC on Metis: 10 people at $2.00 each is $20.00, all of it to them. Testers never pay.",
  alternates: { canonical: "/pricing" },
};

/**
 * PRICING, on one honest screen (the founder's decision, 20 Nov 2026): no Sage fee and no plan tiers
 * on the front. A builder pays what the testers earn and nothing else. The plans and /checkout are
 * still in the code and their routes are alive; nothing here links them.
 */
export default function PricingPage() {
  const { people, eachUsd, budgetUsd } = DEFAULT_TEST;
  return (
    <div className="sg">
      <main className="sg-main">
        <section className="sg-col sg-open sg-stack sg-gap-5">
          <h1 className="sg-display">Sage is free to use.</h1>
          <p className="sg-lead">You pay only what the people who try your product earn.</p>
        </section>

        <section className="sg-col sg-section sg-section-near sg-stack sg-gap-4" aria-labelledby="one-test">
          <h2 className="sg-label" id="one-test">
            One test
          </h2>
          <div className="sg-sum">
            <div className="sg-sum-row">
              <span>People who try it</span>
              <b>{people}</b>
            </div>
            <div className="sg-sum-row">
              <span>Each earns, for an honest try</span>
              <b>{dollars(eachUsd)}</b>
            </div>
            <div className="sg-sum-row">
              <span>Sage&apos;s fee</span>
              <b>{dollars(0)}</b>
            </div>
            <div className="sg-sum-row" data-total>
              <span>You pay</span>
              <b>{dollars(budgetUsd)}</b>
            </div>
          </div>
          <p className="sg-text">
            All {dollars(budgetUsd)} goes to the testers, in USDC on Metis, from a wallet you control. You choose how many people and what each earns. An answer Sage can&apos;t check isn&apos;t paid, and what isn&apos;t paid is still yours
            when you end the test. Sending money on Metis costs a network fee of under a cent, paid in METIS to the network, not to Sage.
          </p>
          <div>
            <ButtonLink href={NEW_TEST_HREF}>
              Start a test <ArrowRight size={16} aria-hidden />
            </ButtonLink>
          </div>
        </section>

        <section className="sg-col sg-section sg-stack sg-gap-4" aria-labelledby="testers">
          <hr className="sg-rule" />
          <h2 className="sg-title" id="testers">
            Testers never pay.
          </h2>
          <p className="sg-text">Sage takes nothing from a tester: no fee to take a place, and none from what they are paid. What a test says it pays is what arrives, with a public receipt. Moving it on later costs the network&apos;s own fee, under a cent in METIS.</p>
          <Link className="sg-link" href="/earn">
            See open tests <ArrowRight size={16} aria-hidden />
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
