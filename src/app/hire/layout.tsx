import type { Metadata } from "next";
import "./hire.css";

export const metadata: Metadata = {
  title: "Stipend — Hire an AI worker",
  description:
    "Hire an autonomous operator to do real economic work while an on-chain vault enforces its budget, vendors, caps, and kill switch.",
};

export default function HireLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="hire">{children}</div>;
}
