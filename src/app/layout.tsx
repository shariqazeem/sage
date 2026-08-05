import type { Metadata } from "next";
import { siteUrl } from "@/lib/site";
import { StructuredData } from "@/components/seo/structured-data";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "../styles/tokens.css";
import { AppShell } from "@/components/shell/app-shell";
import { geist } from "@/components/landing/fonts";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

/**
 * SITE METADATA.
 *
 * `metadataBase` was missing, which is why every build printed a warning and why every relative OG
 * and canonical URL resolved against localhost. With it set, share cards and canonicals point at the
 * real origin.
 *
 * The description is written to be QUOTED, not just crawled. An answer engine summarising "who pays
 * people to test products" will lift a sentence, so the sentences say what Sage does, who it pays,
 * in what currency, and what the reader can verify, rather than positioning language that reads well
 * to a human and tells a model nothing.
 */
const SITE = siteUrl();
const TITLE = "Sage: hire an AI worker, give it a budget, not your keys";
const DESCRIPTION =
  "Sage points an AI agent at your live product, designs paid user-testing missions from what it actually sees, and pays human testers in USDC for verified evidence. Every payout comes from an on-chain vault the agent cannot exceed and publishes a receipt anyone can check.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: TITLE,
    // Page titles read "Marketplace · Sage" rather than each page inventing its own suffix.
    template: "%s · Sage",
  },
  description: DESCRIPTION,
  applicationName: "Sage",
  keywords: [
    "paid user testing",
    "AI agent payments",
    "USDC payouts",
    "get paid to test products",
    "autonomous agent budget",
    "on-chain escrow for agents",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Sage",
    url: SITE,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Font CSS variables live on <html> because globals.css applies `font-sans`
    // to <html>; defining them on <body> would leave the root font-family
    // unresolved and fall back to the browser default serif.
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} ${geist.variable}`}>
      <body className="antialiased">
        <StructuredData />
        {children}
        <AppShell />
      </body>
    </html>
  );
}
