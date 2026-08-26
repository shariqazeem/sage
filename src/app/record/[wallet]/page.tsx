import "../../sage-proof.css";
import "../record.css";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buildWalletRecord } from "@/lib/campaigns/record";
import { money, short } from "@/lib/format";
import { siteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * THE VERIFIED WORK RECORD — a wallet's portable, receipt-anchored history of paid verified work
 * (move 3: the "MSME credit" answer). Every line links to its own /proof page; nothing on this
 * page is asserted that a receipt can't back. Public and indexable: the whole point is that a
 * worker or small business can hand this URL to anyone — a funder, a program, a lender.
 */

const KIND_LABEL = { testing: "testing", grant: "grant", gig: "gig" } as const;

export async function generateMetadata({ params }: { params: Promise<{ wallet: string }> }): Promise<Metadata> {
  const { wallet } = await params;
  const record = buildWalletRecord(wallet);
  const title = "Verified Work Record · Sage";
  const description = record
    ? `${short(record.wallet)} — ${record.completions} verified completion${record.completions === 1 ? "" : "s"}, $${record.totalUsd.toFixed(2)} earned across ${record.distinctCampaigns} campaign${record.distinctCampaigns === 1 ? "" : "s"}. Every entry anchored to an on-chain receipt.`
    : "A wallet's verified, receipt-anchored history of paid work on Sage.";
  return {
    metadataBase: new URL(siteUrl()),
    title,
    description,
    alternates: { canonical: `/record/${wallet.toLowerCase()}` },
    openGraph: { title, description, siteName: "Sage", type: "profile" },
    twitter: { card: "summary", title, description },
  };
}

const dateOf = (unix: number): string =>
  new Date(unix * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function RecordPage({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const record = buildWalletRecord(wallet);
  if (!record) notFound();

  return (
    <div className="spp">
      <div className="spp-col">
        <div className="spp-top spp-reveal">
          <Link href="/" className="spp-brand" style={{ textDecoration: "none", color: "inherit" }}>
            <span className="spp-mark">
              <span className="spp-mark-ring" />
            </span>
            <span className="spp-wordmark">Sage</span>
          </Link>
          <span className="spp-kicker">Verified work record</span>
        </div>

        <header className="rec-head spp-reveal">
          <h1 className="rec-title">Verified Work Record</h1>
          <div className="rec-wallet">{record.wallet}</div>
        </header>

        <section className="rec-stats spp-reveal" aria-label="Record totals">
          <div className="rec-stat">
            <div className="rec-stat-v">${record.totalUsd.toFixed(2)}</div>
            <div className="rec-stat-k">Earned, verified</div>
          </div>
          <div className="rec-stat">
            <div className="rec-stat-v">{record.completions}</div>
            <div className="rec-stat-k">Completions</div>
          </div>
          <div className="rec-stat">
            <div className="rec-stat-v">{record.distinctCampaigns}</div>
            <div className="rec-stat-k">Campaigns</div>
          </div>
          <div className="rec-stat">
            <div className="rec-stat-v">{record.lastAt ? dateOf(record.lastAt) : "—"}</div>
            <div className="rec-stat-k">Last verified</div>
          </div>
        </section>

        {record.entries.length === 0 ? (
          <p className="rec-empty spp-reveal">No verified work on this wallet yet.</p>
        ) : (
          <ul className="rec-list spp-reveal" aria-label="Verified completions">
            {record.entries.map((e) => (
              <li key={e.txHash}>
                <Link href={e.proofPath} className="rec-row">
                  <span className="rec-what">
                    <span className="rec-mission">{e.missionTitle ?? e.campaignTitle}</span>
                    <span className="rec-meta">
                      <span className="rec-kind">{KIND_LABEL[e.kind]}</span>
                      {e.campaignTitle} · {dateOf(e.at)}
                    </span>
                  </span>
                  <span className="rec-amt">
                    {money(e.amountUsd, e.chainId)}
                    <small>receipt →</small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <footer className="rec-trust spp-reveal">
          Every entry above was <b>verified before it was paid</b> — checked against Sage&apos;s own
          observations, an on-chain fact, or the created artifact itself — and links to its public,
          on-chain settlement receipt. Sage refuses work it cannot verify, so a record here is
          earned, not granted. Machine-readable:{" "}
          <a href={`/api/record/${record.wallet}`}>JSON</a> · How it works:{" "}
          <Link href="/docs">sagepays.xyz/docs</Link>
        </footer>
      </div>
    </div>
  );
}
