import type { Metadata } from "next";
import "../hire/hire.css";
import "./app.css";
import "./motion.css";
import "./demo-moments.css";

export const metadata: Metadata = {
  title: "Sage — your AI workers",
  description:
    "Hire AI workers that can spend safely. The agent proposes; the vault enforces.",
};

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="hire sage-app">{children}</div>;
}
