import { Geist } from "next/font/google";

/**
 * Landing V2 display/body face. Geist — a precise, low-contrast grotesk — carries the
 * cinematic type at light weights and large scale. Scoped to the landing via its CSS
 * variable on the page root; the rest of the app keeps its own font stack. JetBrains
 * Mono (global `--font-mono`) still owns all data/proof/agent-event type.
 */
export const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});
