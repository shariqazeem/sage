import "./claim.css";
import type { Metadata } from "next";

import { starknetAddresses } from "@/lib/starknet/config";

import { ClaimClient } from "./claim-client";

/**
 * The page a worker lands on to collect what they earned.
 *
 * `noindex` deliberately: a claim URL carries a bearer secret in its fragment, and while a crawler
 * would not receive the fragment, this page has no purpose in a search result and every reason not
 * to accumulate one.
 */
export const metadata: Metadata = {
  title: "Collect your payout",
  description: "Collect a payout from Sage. No wallet, no gas, no account needed.",
  robots: { index: false, follow: false },
};

export default function ClaimPage() {
  // Only the public addresses — the private door needs a contract to name, not a credential.
  // Absent or malformed, the private door is simply not offered and the public one still works.
  const addresses = starknetAddresses();

  return (
    <main className="claim-page">
      <div className="claim-card">
        <p className="claim-brand">
          <strong>Sage</strong> <span aria-hidden>·</span> payout
        </p>
        <ClaimClient claims={addresses?.claims ?? null} token={addresses?.token ?? null} />
      </div>
    </main>
  );
}
