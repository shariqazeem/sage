import type { Metadata } from "next";
import "./launch.css";
import { LaunchForm } from "@/components/launch/launch-form";

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
          <h1 className="lx-h1">Turn your product into a paid testing plan.</h1>
          <p className="lx-sub">
            Give Sage your product, what you want to learn, and a budget. Sage opens your product, understands it,
            and designs specific testing missions real people get paid to complete — no generic bounty form.
          </p>
        </div>

        <LaunchForm />
      </div>
    </div>
  );
}
