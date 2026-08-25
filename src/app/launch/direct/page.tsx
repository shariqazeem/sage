import type { Metadata } from "next";
import Link from "next/link";
import "../launch.css";
import { DirectCampaignForm } from "@/components/launch/direct-form";

export const metadata: Metadata = {
  title: "Sage — fund work you define, verified before it pays",
  description:
    "Milestone grants and gig payouts: state the work, the proof, and the tranche prices. Sage verifies every submission deterministically and pays USDC with a public receipt — or refuses with the reason.",
};

/**
 * WORK PROOF front door — the operator authors the plan (no inspection, no model). The form
 * compiles into the same claim → deploy → fund → attach wizard every campaign uses.
 */
export default function DirectLaunchPage() {
  return (
    <div className="lx">
      <div className="lx-wrap">
        <div className="lx-hero">
          <h1 className="lx-h1">Fund work you define. Sage verifies, then pays.</h1>
          <p className="lx-sub">
            Milestone grants and gig payouts: state the work, the proof it must produce, and what each tranche pays.
            Every submission is checked deterministically — on-chain, or against the artifact itself — before a cent
            moves, and every payout or refusal gets a public receipt.
          </p>
          <p className="lx-crosslink">
            Want Sage to design the work from your product instead? <Link href="/launch">Launch a testing campaign →</Link>
          </p>
        </div>

        <DirectCampaignForm />
      </div>
    </div>
  );
}
