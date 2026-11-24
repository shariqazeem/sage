import { SagePrivyProvider } from "@/components/auth/privy-provider";
import type { Metadata } from "next";
import { siteUrl } from "@/lib/site";
import { StructuredData } from "@/components/seo/structured-data";
import { Fira_Mono, Fira_Sans, Fira_Sans_Extra_Condensed } from "next/font/google";
import "./globals.css";
import "../styles/tokens.css";
// The two sign-in doors (an email, or MetaMask) render on many pages, from FounderSignIn: their styles are
// global so every page draws them the same. Both are class-scoped (es-*, wc-*).
import "../styles/email-sign-in.css";
import "../styles/wallet-connect.css";
// The relaunch kit (20 Nov 2026): the one top bar and the footer are on every page, so its sheet is global.
// Every class is prefixed sg-.
import "../styles/sage.css";
import { AppShell } from "@/components/shell/app-shell";
import { FeedbackWidget } from "@/components/shell/feedback-widget";

// THE STOP (24 Nov 2026): one OFL superfamily. Fira Sans reads, Fira Sans Extra Condensed carries lines, stamps and
// numbers, Fira Mono carries hashes, times and serials. Latin, Turkish, Vietnamese and Cyrillic are native; CJK falls to
// the system's Noto/Hiragino/PingFang through the stacks in tokens.css.
// ONLY the Latin files are preloaded: every preload is a `link:` response header, and four subsets × three
// families made a 6 KB header that nginx refused (502 on every dynamic page, 24 Nov 2026). The other scripts'
// files still load on demand through their unicode ranges.
const firaSans = Fira_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-fira-sans",
  display: "swap",
});

const firaDisplay = Fira_Sans_Extra_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-fira-xc",
  display: "swap",
});

const firaMono = Fira_Mono({
  subsets: ["latin"],
  preload: false, // hashes and serials: never on the first paint's critical path
  weight: ["400", "500"],
  variable: "--font-fira-mono",
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
 * So the tag now opens on the CATEGORY, which has no incumbent, and closes on the brand. (The old
 * "hire an AI worker" headline and any keys or allowance framing were retired on 5 Nov 2026; the public
 * line is "Proof of work, for people.")
 */
const TITLE =
  "Sage — an AI agent that moves money on verified work";
const DESCRIPTION =
  "Sage is autonomous payments infrastructure: an AI agent that takes a budget and an outcome, inspects products, designs paid work, verifies every deliverable, detects fraud, and pays in USDC from an on-chain vault it cannot exceed, on Metis, with a public receipt for every payout, a verified work record for every recipient, and working capital against it.";

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
    <html lang="en" className={`${firaSans.variable} ${firaDisplay.variable} ${firaMono.variable}`}>
      <body>
        <StructuredData />
        <SagePrivyProvider appId={process.env.NEXT_PUBLIC_PRIVY_LOGIN_APP_ID?.trim() || null}>
          <AppShell />
          {children}
        </SagePrivyProvider>
        <FeedbackWidget />
      </body>
    </html>
  );
}
