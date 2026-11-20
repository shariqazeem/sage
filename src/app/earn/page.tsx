import "@/styles/live.css";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { WorkAlerts } from "@/components/live/work-alerts";
import { EarnCard } from "@/components/sage/earn-card";
import { EmptyState } from "@/components/sage/empty-state";
import { SignInButton } from "@/components/sage/sign-in-button";
import { Ticket } from "@/components/sage/ticket";
import { SiteFooter } from "@/components/site/site-footer";
import { getFounderAddress } from "@/lib/auth/founder";
import { marketplace, type MarketplaceRow } from "@/lib/campaigns/marketplace";
import { buildWalletRecord } from "@/lib/campaigns/record";
import { short } from "@/lib/format";
import { testPath } from "@/lib/site/test-path";
import { count, dollars, howLong, whenAgo } from "@/lib/site/when";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Get paid to try new products",
  description:
    "Every test open on Sage right now. Try a product, answer honestly, and Sage checks your answer and pays you in USDC on Metis, to a wallet you control, with a public receipt. Never a fee.",
  alternates: { canonical: "/earn" },
};

/** About how long, from what the test asks for. Coarse on purpose: it is never a promise. */
const ABOUT: Record<MarketplaceRow["effort"], string> = {
  quick: "a few minutes",
  standard: "about 10 min",
  deep: "20 min or more",
};

/**
 * EARN (relaunch, 20 Nov 2026; /marketplace and /missions land here). The open tests, as cards, from
 * the one listing source (`marketplace()`): only work that can pay right now, so an empty list says
 * so and offers the alert, and never shows a card that isn't real. Signed in, your record leads.
 */
export default async function EarnPage() {
  const me = await getFounderAddress();
  const { rows, speed } = marketplace();
  const record = me ? buildWalletRecord(me) : null;
  const tries = record?.completions ?? 0;

  return (
    <div className="sg">
      <main className="sg-main">
        <section className="sg-wrap sg-open sg-earn-head">
          <h1 className="sg-display">Get paid to try new products.</h1>
          <p className="sg-lead">
            Pick a test, try the product, and answer honestly. Sage checks your answer and pays you in USDC, to your own wallet.
            {speed.medianSeconds !== null && speed.measured >= 3 ? (
              <>
                {" "}
                So far the median wait from answer to money is <span className="sg-n">{howLong(speed.medianSeconds)}</span>.
              </>
            ) : null}
          </p>
          {!me ? (
            <div>
              <SignInButton why="Sign in to take a place. Sage pays to the wallet you sign in with.">Sign in to earn</SignInButton>
            </div>
          ) : null}
        </section>

        {me ? (
          <section className="sg-wrap sg-section sg-section-near" aria-labelledby="your-record">
            <div className="sg-split" data-top>
              <div className="sg-split-words">
                <p className="sg-label">Your record</p>
                <h2 className="sg-title" id="your-record">
                  {tries > 0 && record ? (
                    <>
                      You&apos;ve been paid for <span className="sg-n">{count(tries, "try", "tries")}</span>: <span className="sg-n">{dollars(record.totalUsd)}</span> in all.
                    </>
                  ) : (
                    <>Nothing paid yet. Your first paid try shows here, with its receipt.</>
                  )}
                </h2>
                <Link className="sg-link" href={`/record/${me}`}>
                  Open your record <ArrowRight size={16} aria-hidden />
                </Link>
              </div>
              {record && record.entries.length > 0 ? (
                <div className="sg-stack sg-gap-3">
                  {record.entries.slice(0, 3).map((e) => (
                    <Ticket key={e.txHash} handle={e.missionTitle ?? e.campaignTitle} words state="paid" amount={dollars(e.amountUsd)} meta={`${short(me)} · ${whenAgo(e.at)}`} href={e.proofPath} />
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="sg-wrap sg-section sg-section-near" aria-labelledby="open-tests">
          <div className="sg-row-head sg-row-head-list">
            <h2 className="sg-label" id="open-tests">
              Open tests
            </h2>
            {rows.length > 0 ? <p className="sg-label">{count(rows.length, "test", "tests")}</p> : null}
          </div>
          {rows.length === 0 ? (
            <EmptyState title="No open tests right now." action={me ? <WorkAlerts wallet={me} /> : <SignInButton variant="quiet" why="Sign in, and you can ask Sage to tell you when a test opens.">Sign in to be told when one opens</SignInButton>}>
              Every test is funded before it is listed, so this is empty between tests.
            </EmptyState>
          ) : (
            <div className="sg-cards">
              {rows.map((r) => (
                <EarnCard
                  key={r.key}
                  href={testPath(r.campaignId)}
                  product={r.productHost ?? r.campaignTitle}
                  title={r.title}
                  objective={r.objective}
                  each={dollars(r.rewardUsd)}
                  placesLeft={r.remainingSlots}
                  places={r.maxCompletions}
                  about={ABOUT[r.effort]}
                />
              ))}
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
