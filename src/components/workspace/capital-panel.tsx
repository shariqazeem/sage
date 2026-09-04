import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Banknote, BarChart3, Blocks, FileText, Globe2, Landmark, ShieldCheck, Users, Wallet } from "lucide-react";
import { short, since, usd } from "@/lib/format";

export interface CapitalView {
  workspace: { name: string };
  totals: { paidUsd: number; payouts: number; people: number; refused: number; campaigns: number };
  earners: { wallet: string; paidUsd: number; payouts: number; lastAt: number; member: string | null }[];
  /** the live quote the composer would stamp a local-currency grant at — null when unavailable. */
  rate: { code: string; rate: number; asOf: number; source: string } | null;
  advance: { armed: boolean; maxUsd: number; multiple: number; waterfallPct: number };
}

/**
 * CAPITAL — verified payouts as a credit record. Payments infrastructure for organizations that
 * pay people for work: what has been paid, to whom, on which rail, and what that record unlocks —
 * for the person (an advance), for a programme (a lender view), for anyone (the public explorer).
 */
/**
 * The money shapes this workspace can actually post, each with its own state. They were three
 * clauses of one sentence, so the one that is NOT yet available read exactly like the three that
 * are — and that difference is the only thing a programme evaluating Sage needs to see at a glance.
 */
const SHAPES = [
  // A composer preset that verifies a published delivery confirmation — a payment template, not
  // invoice financing. Saying "live" here read as a financing product the code does not have.
  { Icon: FileText, label: "Supplier payment, verified by a published delivery confirmation", live: true },
  { Icon: Blocks, label: "Two-tranche seller grant", live: true },
  { Icon: Users, label: "Diaspora-funded milestones", live: true },
  { Icon: Banknote, label: "Regulated fiat disbursement", live: false },
];

export function CapitalPanel({ view }: { view: CapitalView }) {
  const t = view.totals;
  return (
    <main className="ws-shell ws-stagger">
      <header className="ws-head">
        <div>
          <Link href="/workspace" className="ws-back"><ArrowLeft size={12} /> {view.workspace.name}</Link>
          <span className="ws-eyebrow" style={{ marginTop: 10 }}>Verified payouts as a credit record</span>
          <h1 className="ws-title">Capital</h1>
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
                      <span className="ws-avatar">{e.member ? e.member[0].toUpperCase() : <Wallet size={14} />}</span>
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

          {/*
            THE REGION, DRAWN.
            One paragraph carried the whole local-currency argument and four separate money shapes,
            which is the FC track's centre stated in the form a reader skips. The mechanic is a
            sequence, so it is a sequence: a founder's own number, the rate stamped once at launch,
            what the vault actually settles, and a receipt carrying both. The rate is the live quote
            the composer would use, and when there is none the figure keeps its mechanism and drops
            the arithmetic — never a stale or invented number on the page that argues Sage invents none.
          */}
          <section className="ws-card">
            <div className="ws-card-h"><h2><Globe2 size={15} /> Priced in the founder&rsquo;s currency, settled in USDC</h2></div>
            <ol className="cap-rail" aria-label="How a local-currency grant is priced and settled">
              <li>
                <span className="cap-rail-v mono">J$10,000</span>
                <span className="cap-rail-k">what the founder types</span>
              </li>
              <li>
                <span className="cap-rail-v mono">{view.rate ? `÷ ${view.rate.rate.toFixed(2)}` : "one rate"}</span>
                <span className="cap-rail-k">stamped once, at launch</span>
              </li>
              <li>
                <span className="cap-rail-v mono ok">{view.rate ? usd(10_000 / view.rate.rate) : "USDC"}</span>
                <span className="cap-rail-k">what the vault releases</span>
              </li>
              <li>
                <span className="cap-rail-v"><ShieldCheck size={17} /></span>
                <span className="cap-rail-k">the receipt shows both</span>
              </li>
            </ol>
            {view.rate && (
              <p className="cap-rail-src">
                {view.rate.code} · {view.rate.source} · {since(view.rate.asOf)}
              </p>
            )}
            <ul className="cap-shapes">
              {SHAPES.map((sh) => (
                <li key={sh.label}>
                  <sh.Icon size={13} strokeWidth={1.8} />
                  <span className="cap-shape-l">{sh.label}</span>
                  <span className={`ws-chip${sh.live ? " live" : ""}`}>{sh.live ? "live" : "pending a partner"}</span>
                </li>
              ))}
            </ul>
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
