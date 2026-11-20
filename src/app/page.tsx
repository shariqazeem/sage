import type { Metadata } from "next";
import { HomeSignedIn } from "@/components/sage/home-signed-in";
import { HomeSignedOut } from "@/components/sage/home-signed-out";
import { SiteFooter } from "@/components/site/site-footer";
import { getFounderAddress } from "@/lib/auth/founder";

// Read on every request: who is signed in, and the ledger as it is now, never a build-time snapshot.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CATEGORY FIRST, BRAND LAST: "Sage" alone loses to Sage Group, Sage Pay and Ask Sage, and the
 * category has no incumbent. Written to be quoted: what it does, who is paid, in what, and what a
 * reader can check.
 */
export const metadata: Metadata = {
  title: "Real people try what you built | Sage",
  description:
    "Paste your product's link. Sage tries it first in a real browser, brings real people to try it, pays each one in USDC on Metis only for an honest try it can check, and shows you where they got stuck. Every payout has a public receipt.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Sage: real people try what you built",
    description: "Paste your link. Sage tries it first, brings real people to try it, pays each one for an honest try, and shows you where they got stuck.",
    type: "website",
  },
};

/**
 * HOME (relaunch, 20 Nov 2026). One address, two states of the same place:
 *  - signed out, the front door: one paste box, a real test, what Sage has really paid;
 *  - signed in, Tests: the paste box and everything you started, as live cards.
 *
 * The long landing page with a section per feature is gone from here on purpose (the founder:
 * "remove the SaaS feel"). Every page it linked is still reachable, from the footer. The second
 * product keeps its own page at /parallaxpay.
 */
export default async function HomePage() {
  const founder = await getFounderAddress();
  return (
    <div className="sg">
      <main className="sg-main">{founder ? <HomeSignedIn founder={founder} /> : <HomeSignedOut />}</main>
      <SiteFooter />
    </div>
  );
}
