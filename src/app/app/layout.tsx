import type { Metadata } from "next";
import "../hire/hire.css";
import "./app.css";
import "./motion.css";
import "./demo-moments.css";

export const metadata: Metadata = {
  title: "Sage — your AI workers",
  description:
    "Hire an AI agent you can trust with a wallet. It gets people paid — inside spending limits it can't break.",
};

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="hire sage-app">{children}</div>;
}
