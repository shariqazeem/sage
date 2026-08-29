import "./lender.css";
import type { Metadata } from "next";

import { LenderClient } from "./lender-client";
import { siteUrl } from "@/lib/site";

/**
 * The page a credit officer opens.
 *
 * Indexed deliberately: the point of a verified cash-flow file is that a lender who has never
 * heard of Sage can find it, read it, and check any row against the chain without an account.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: "Underwrite verified cash flow",
  description:
    "Paste a wallet to see its verified payment history: every job checked before the money moved, every row anchored to an on-chain transaction. Sage reports the inputs and computes no credit score.",
  alternates: { canonical: "/lender" },
};

export default function LenderPage() {
  return (
    <main className="lend-page">
      <LenderClient />
    </main>
  );
}
