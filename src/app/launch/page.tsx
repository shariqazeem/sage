import type { Metadata } from "next";
import "./launch.css";
import "@/styles/wallet-connect.css";
import { LaunchForm } from "@/components/launch/launch-form";
import { RecentInspectionsList } from "@/components/launch/recent-inspections-list";
import { TesterSupplyProof } from "@/components/launch/tester-supply-proof";

export const metadata: Metadata = {
  title: "Launch with Sage — pay real people for verified work",
  description:
    "Test your product with paid missions, or fund a gig, a bounty, or a milestone grant. Sage verifies every claim before it pays — and every payout has a public receipt.",
};

/**
 * The founder Launch workspace — Sage's first compelling product experience. Sage
 * inspects a real product and returns product-specific, payable testing missions. This
 * page is warm + calm by design (not the /app terminal); chain internals stay out of
 * the opening step.
 */
export default function LaunchPage() {
  return (
    <div className="lx">
      <div className="lx-wrap">
        <div className="lx-hero">
          <h1 className="lx-h1">Pay real people for verified work.</h1>
          <p className="lx-sub">
            Testing missions, gigs, bounties, milestone grants — say it once, and Sage verifies the
            work before a cent moves. Every payout lands with a public receipt.
          </p>
        </div>

        <LaunchForm />

        {/* Proof of supply before they type a URL — the objection arrives before the plan does. */}
        <TesterSupplyProof compact />
        <RecentInspectionsList />
      </div>
    </div>
  );
}
