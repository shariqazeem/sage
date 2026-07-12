import type { Metadata } from "next";
import Link from "next/link";
import "./launch.css";
import { LaunchWorkspace } from "@/components/launch/launch-workspace";

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
        <header className="lx-head">
          <Link href="/" className="lx-mark" aria-label="Sage home"><span /></Link>
          <span className="lx-word">Sage</span>
          <span className="lx-kicker" style={{ marginLeft: "auto" }}>Launch</span>
        </header>

        <div className="lx-hero">
          <h1 className="lx-h1">Turn your product into a paid testing plan.</h1>
          <p className="lx-sub">
            Give Sage your product, what you want to learn, and a budget. Sage opens your product, understands it,
            and designs specific testing missions real people get paid to complete — no generic bounty form.
          </p>
        </div>

        <LaunchWorkspace />
      </div>
    </div>
  );
}
