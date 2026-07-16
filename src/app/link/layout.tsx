import type { Metadata } from "next";
import "../hire/hire.css";
import "../app/app.css";
import "../app/motion.css";

export const metadata: Metadata = {
  title: "Link your agent wallet — Sage",
  description:
    "Connect a wallet and set a spending cap so Sage can fund your testing campaigns straight from Telegram.",
};

/**
 * Standalone surface for the Telegram agent-wallet link flow. It reuses the founder-facing `.hire`
 * theme + the `.sage-app` component styles so the page is visually identical to the web app the
 * founder already knows — same buttons, inputs, and light premium surface.
 */
export default function LinkLayout({ children }: { children: React.ReactNode }) {
  return <div className="hire sage-app">{children}</div>;
}
