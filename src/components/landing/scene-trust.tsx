import Link from "next/link";
import { usd } from "@/lib/format";

/**
 * THE FACTS STRIP — what a judge can click, under the hero. Every item is live or a link to
 * the thing itself; nothing here is a sticker. (The old "ships with" band was never mounted.)
 */
export function SceneTrust({
  paidUsd,
  payoutCount,
  refusedCount,
  refusalPct,
  networkName,
}: {
  paidUsd: number;
  payoutCount: number;
  refusedCount: number;
  /** computed once in settled-ledger.ts (decidedOnMainnet) — never re-derived here. */
  refusalPct: number;
  networkName: string;
}) {
  const facts: { k: string; v: string; href: string }[] = [
    { k: "Mainnet rails", v: networkName, href: "/docs/settlement" },
    { k: "Settled, verified", v: `${usd(paidUsd)} · ${payoutCount} payouts`, href: "/explorer" },
    { k: "Refused on record", v: `${refusedCount} · ${refusalPct}%`, href: "/explorer" },
    { k: "Live batteries", v: "P-GEN · P-DIRECT · P-JUDGE · P-WORK · P-ROUTE · P-VERIFY", href: "/docs/safety" },
    { k: "Open source", v: "github.com/shariqazeem/sage", href: "https://github.com/shariqazeem/sage" },
    { k: "Metis Stage 2", v: "1st place", href: "/case-studies/autonomous-paid-testing" },
  ];
  return (
    <section className="tr" aria-label="Facts">
      <div className="wrap tr-in">
        {facts.map((f) => (
          <Link key={f.k} href={f.href} className="tr-fact" {...(f.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            <span className="tr-k mono">{f.k}</span>
            <span className="tr-v">{f.v}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
