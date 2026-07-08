import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

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

export const metadata: Metadata = {
  title: "Sage — an allowance for AI agents, not your keys",
  description:
    "Sage is the control layer for AI agents that spend real money. Give an AI worker a budget and a rule; it pays real people for real work, autonomously, from an on-chain vault it physically cannot exceed.",
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
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
