import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Banknote, BarChart3, Blocks, FileText, Globe2, Landmark, ShieldCheck, Users } from "lucide-react";
import { short, since, usd } from "@/lib/format";

export interface CapitalView {
  workspace: { name: string };
  totals: { paidUsd: number; payouts: number; people: number; refused: number; campaigns: number };
  earners: { wallet: string; paidUsd: number; payouts: number; lastAt: number; member: string | null }[];
  advance: { armed: boolean; maxUsd: number; multiple: number; waterfallPct: number };
}

/**
 * CAPITAL — verified payouts as a credit record. Payments infrastructure for organizations that
 * pay people for work: what has been paid, to whom, on which rail, and what that record unlocks —
 * for the person (an advance), for a programme (a lender view), for anyone (the public explorer).
 */
export function CapitalPanel({ view }: { view: CapitalView }) {
  const t = view.totals;
  return (
    <main className="ws-shell ws-stagger">
      <header className="ws-head">
        <div>
          <Link href="/workspace" className="ws-back"><ArrowLeft size={12} /> {view.workspace.name}</Link>
          <h1 className="ws-title" style={{ marginTop: 8 }}>Capital</h1>
          <p className="ws-sub">Every payout Sage makes is a receipt on chain, and every receipt is a row in someone&rsquo;s record. That record is what a programme underwrites and what an advance is drawn against.</p>
        </div>
        <div className="ws-nav">
          <Link className="ws-chip" href="/explorer"><Blocks size={12} /> Public explorer</Link>
          <Link className="ws-chip" href="/lender"><Landmark size={12} /> Lender view</Link>
          <Link className="ws-chip" href="/outcomes"><BarChart3 size={12} /> Outcomes</Link>
        </div>
      </header>

      <section className="ws-stats" aria-label="Verified money">
        <div className={`ws-stat${t.paidUsd > 0 ? " pos" : ""}`}><span className="ws-stat-v">{usd(t.paidUsd)}</span><span className="ws-stat-k">Paid on verified work</span></div>
        <div className="ws-stat"><span className="ws-stat-v">{t.payouts}</span><span className="ws-stat-k">Receipts</span></div>
        <div className="ws-stat"><span className="ws-stat-v">{t.people}</span><span className="ws-stat-k">People paid · clusters collapsed</span></div>
        <div className="ws-stat"><span className="ws-stat-v">{t.refused}</span><span className="ws-stat-k">Refused with a reason</span></div>
      </section>

      <div className="ws-grid">
        <div>
          <section className="ws-card">
            <div className="ws-card-h"><h2><FileText size={15} /> Records this workspace has built</h2></div>
            {view.earners.length === 0 ? (
              <p className="ws-empty"><Banknote size={18} /><span>No verified payout yet. The first one starts a record for the person who earned it — a history of verified, paid work they carry to the next programme.</span></p>
            ) : (
              <ul className="ws-list">
                {view.earners.map((e) => (
                  <li key={e.wallet} className="ws-row">
                    <div className="ws-member">
                      <span className="ws-avatar">{(e.member?.[0] ?? e.wallet.replace(/^0x0*/, "")[0] ?? "?").toUpperCase()}</span>
                      <div className="ws-row-main">
                        <p className="ws-row-title"><span className="t">{e.member ?? short(e.wallet)}</span></p>
                        <p className="ws-row-meta">{e.payouts} verified payout{e.payouts === 1 ? "" : "s"} · last {since(e.lastAt)}</p>
                      </div>
                    </div>
                    <div className="ws-row-side">
                      <span className="mono" style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{usd(e.paidUsd)}</span>
                      <Link className="ws-chip" href={`/record/${e.wallet}`}>record <ArrowUpRight size={11} /></Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ws-card">
            <div className="ws-card-h"><h2><Globe2 size={15} /> Built for the region, priced in its currencies</h2></div>
            <p className="ws-note" style={{ margin: 0 }}>
              Post a grant in J$ or another local currency and Sage stamps one rate at launch; the vault settles in USDC and the receipt shows both. Supplier payments bound to an invoice, two-tranche seller grants and diaspora-funded milestones are first-class shapes in the composer. Regulated fiat disbursement is a licensed-partner door with a typed contract, labelled pending until a partner signs.
            </p>
          </section>
        </div>

        <div>
          <section className="ws-card">
            <div className="ws-card-h"><h2><Landmark size={15} /> What the record unlocks</h2></div>
            <ul className="ws-list">
              <li className="ws-row">
                <div className="ws-row-main">
                  <p className="ws-row-title"><Banknote size={14} /> <span className="t">Working-capital advance</span></p>
                  <p className="ws-row-meta">{view.advance.armed ? `Self-serve on a member's record: up to ${usd(view.advance.maxUsd)} at ${view.advance.multiple}× monthly verified inflow, repaid from ${view.advance.waterfallPct}% of each next payout.` : "Operator-run today; self-serve switches on per deployment."}</p>
                </div>
                <span className={`ws-chip${view.advance.armed ? " live" : ""}`}>{view.advance.armed ? "armed" : "operator"}</span>
              </li>
              <li className="ws-row">
                <div className="ws-row-main">
                  <p className="ws-row-title"><Landmark size={14} /> <span className="t">Lender view</span></p>
                  <p className="ws-row-meta">Published arithmetic over receipt-anchored inflow — never a score. A JSON contract any institution can consume.</p>
                </div>
                <Link className="ws-chip" href="/lender">open <ArrowUpRight size={11} /></Link>
              </li>
              <li className="ws-row">
                <div className="ws-row-main">
                  <p className="ws-row-title"><BarChart3 size={14} /> <span className="t">Outcomes</span></p>
                  <p className="ws-row-meta">The system&rsquo;s readings against the track&rsquo;s own bar, computed live, gaps stated.</p>
                </div>
                <Link className="ws-chip" href="/outcomes">open <ArrowUpRight size={11} /></Link>
              </li>
              <li className="ws-row">
                <div className="ws-row-main">
                  <p className="ws-row-title"><ShieldCheck size={14} /> <span className="t">Public explorer</span></p>
                  <p className="ws-row-meta">Every settlement and every refusal, on two mainnet rails, each a transaction anyone can open.</p>
                </div>
                <Link className="ws-chip" href="/explorer">open <ArrowUpRight size={11} /></Link>
              </li>
              <li className="ws-row">
                <div className="ws-row-main">
                  <p className="ws-row-title"><Users size={14} /> <span className="t">Programmes and partners</span></p>
                  <p className="ws-row-meta">Running a cohort, a cooperative or a grant fund? The docs cover the record API, the advance policy and the fiat door.</p>
                </div>
                <Link className="ws-chip" href="/docs">docs <ArrowUpRight size={11} /></Link>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
