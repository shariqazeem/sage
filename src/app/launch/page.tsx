import type { Metadata } from "next";
import "./launch.css";
import { LaunchForm } from "@/components/launch/launch-form";
import { RecentInspectionsList } from "@/components/launch/recent-inspections-list";
import { TesterSupplyProof } from "@/components/launch/tester-supply-proof";

export const metadata: Metadata = {
  title: "Launch with Sage — turn your product into a paid testing plan",
  description:
    "Give Sage your product, your goal, and a budget. Sage inspects the real product and designs specific, payable testing missions — ready to fund.",
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
            Paste your product and Sage opens it, designs the testing missions, and pays people for verified
            reports. Or describe work you want funded — a milestone grant, a gig, a deliverable — and Sage sets
            that up instead. Every payout is checked first, and every one has a public receipt.
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
