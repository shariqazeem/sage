import type { Metadata } from "next";
import { siteUrl } from "@/lib/site";
import { StructuredData } from "@/components/seo/structured-data";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "../styles/tokens.css";
import { AppShell } from "@/components/shell/app-shell";
import { FeedbackWidget } from "@/components/shell/feedback-widget";
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
/**
 * CATEGORY FIRST, BRAND LAST — and this is a search decision, not a copy preference.
 *
 * The previous title led with the bare word "Sage", which is owned by Sage Group (FTSE 100
 * accounting software), Sage Pay/Opayo (a payments processor whose name our own domain echoes), and
 * Ask Sage. Leading on it means competing with all three for our own homepage and losing. It also
 * spent the rest of the tag on a metaphor nobody searches: people type "paid beta testers for my
 * app", never "hire an AI worker".
 *
 * So the tag now opens on the CATEGORY, which has no incumbent, and closes on the brand. The
 * "hire an AI worker, give it a budget, not your keys" line is still the hero headline, where it is
 * strong — it just should not be the string we ask to be indexed on.
 */
const TITLE =
  "AI agent that pays testers for verified product feedback · Sage";
const DESCRIPTION =
  "Sage is an AI agent that pays people for work it has verified: it tests your product with paid missions, runs gigs, bounties and milestone grants, and pays human workers in USDC from an on-chain vault it can never exceed. Public receipts on GOAT Network, private payouts on Starknet, every refusal on record.";

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
  // THE CARD IS NOT THE <title>. An explicit root twitter/openGraph title overrides every page's own
  // (Next merges per top-level key), so a gig link on X showed the SEO string "AI agent that pays
  // testers…" instead of the mission's name — measured on launch day. The root now sets only the
  // card TYPE and site; each page's title and description flow into its own card.
  openGraph: {
    type: "website",
    siteName: "Sage",
    url: SITE,
  },
  twitter: {
    card: "summary_large_image",
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
    // Font CSS variables live on <html> because tokens.css sets font-family from them
    // to <html>; defining them on <body> would leave the root font-family
    // unresolved and fall back to the browser default serif.
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} ${geist.variable}`}>
      <body>
        <StructuredData />
        {children}
        <AppShell />
        <FeedbackWidget />
      </body>
    </html>
  );
}
