import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Reveal } from "./reveal";

/**
 * THE ROADMAP — the vision in the finance track's language, drawn as a rail with three stages:
 * what is live (proven on the ledger), what settles this week, and the horizon that needs a licensed
 * partner in each market. Every horizon item says HOW and what it needs, so it reads as a plan a
 * bank could hold us to, not a wish list.
 */
type Item = { title: string; body: string; how?: string; needs?: string; href?: string; cta?: string };
const LIVE: Item[] = [
  { title: "Verified payments in minutes, at a flat $0.10", body: "Two settlement rails, a public receipt for every payout, a written reason for every refusal.", how: "the agent judges · the vault enforces the limits in code", href: "/explorer", cta: "the ledger" },
  { title: "A cash-flow record per worker, and a lender's view", body: "JSON, CSV and a printable statement a loan officer can check line by line.", how: "published formulas over receipts · never a score", href: "/lender", cta: "for lenders" },
  { title: "Obligations in 14 currencies, Caribbean first", body: "J$, TT$, EC$, Bds$ and ten more, converted once at a stamped, source-attributed rate.", how: "priced in your money · settled in digital dollars", href: "/launch", cta: "the composer" },
  { title: "One person, one slot · sanctions screening on every payout", body: "A bounty for fifty people is earned by fifty people; every recipient is screened.", how: "World ID at the mission · OFAC SDN on every path", href: "/docs/compliance", cta: "controls" },
  { title: "A grant priced in J$, paid in two milestones on the private rail", body: "J$1,600 to a market seller, released one milestone at a time, each escrowed behind a commitment; settled 6 September.", how: "the vault looks the reward up · the claim is the money", href: "/proof/0x2337afda7ef311c4bd515d66feb78f0903f16b3cc23e49ef7fb7702fe1bb54", cta: "the receipt" },
  { title: "A working-capital advance, disbursed and repaid", body: "$1.85 drawn against her verified inflow, repaid in full by the waterfall on her next payout, the same day.", how: "capacity = 1× monthly verified inflow · 50% of each next payout", href: "/record/0x04f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434", cta: "her record" },
  { title: "WhatsApp-ready onboarding", body: "Paste your people, forward each a single-use door; share receipts and statements from the phone.", how: "the person's own WhatsApp · no API, no approval", href: "/workspace/people", cta: "invite a list" },
  { title: "Cash-out today, on the private rail", body: "A worker collects a payout straight to their exchange's Starknet deposit address — Binance takes native USDC on Starknet with no bridge — and turns it into J$ or TT$ by P2P.", how: "native USDC · a claim collected to any Starknet address · no partner needed", href: "/docs/privacy", cta: "how the private rail pays" },
];
const WEEK: Item[] = [
  { title: "Treasuries that run themselves", body: "An organisation funds once; the agent proposes each move with its reason and launches inside the ceilings.", how: "the operator, on real treasuries" },
];
const NEXT: Item[] = [
  { title: "Fund a treasury from a bank account or card", body: "A licensed on-ramp turns local money into digital dollars inside the organisation's treasury, so a cooperative never touches a crypto exchange.", how: "the same vault deployed on a rail the on-ramps support (Base), beside the two live today", needs: "a licensed on-ramp partner" },
  { title: "Cash out in local currency", body: "A worker withdraws J$, TT$ or Bds$ to a bank account or a mobile wallet from inside Sage.", how: "licensed off-ramp partners behind Your wallet · KYC by the partner where the law requires it", needs: "a licensed partner in each market" },
  { title: "A WhatsApp door", body: "Launch work, submit it and get paid in the chat the region already uses, as the Telegram door does today.", how: "the same agent behind the WhatsApp Business API", needs: "Meta business approval" },
  { title: "Institutions", body: "Lender API keys, a portfolio view of verified cash flows, signed attestations, programme cohorts for grant-makers.", how: "the record API, extended · the lender's view for a whole book", needs: "a first institution pilot" },
  { title: "Inter-island corridors", body: "Priced in the payer's currency, received in the worker's, both rates stamped, one settlement.", how: "the stamped-rate mechanism, applied twice", needs: "the first cross-currency obligation" },
];

function Stage({ tone, label, count, items }: { tone: "live" | "week" | "next"; label: string; count: string; items: Item[] }) {
  return (
    <div className={`rm-stage rm-${tone}`}>
      <div className="rm-stage-h">
        <span className="rm-node" aria-hidden />
        <span className="rm-stage-k mono">{count}</span>
        <h3 className="rm-stage-t">{label}</h3>
      </div>
      <ul className="rm-list">
        {items.map((it) => (
          <li key={it.title} className="rm-item">
            <h4 className="rm-it">{it.title}</h4>
            <p className="rm-ib">{it.body}</p>
            {it.how && <p className="rm-how mono"><span className="rm-hk">how</span>{it.how}</p>}
            {it.needs && <p className="rm-how mono"><span className="rm-hk">needs</span>{it.needs}</p>}
            {it.href && <Link href={it.href} className="rm-link">{it.cta} <ArrowRight size={12} strokeWidth={2} /></Link>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SceneRoadmap() {
  return (
    <section className="rm" id="roadmap" aria-label="Roadmap">
      <Reveal className="reveal rm-in">
        <span className="eyebrow rm-eyebrow"><span className="dot" aria-hidden />Roadmap</span>
        <h2 className="rm-h">From verified payouts<br /><span className="soft">to a payments layer for the region.</span></h2>
        <p className="rm-lede">
          What is live is on the ledger; what is next is written the way a bank would hold us to it — with the how, and what each step needs.
          Sage is not a bank and never holds customer money in local currency: every step that touches it is done by a licensed party in its market.
        </p>
        <div className="rm-rail" aria-hidden><span className="rm-rail-line" /></div>
        <div className="rm-grid">
          <Stage tone="live" label="Live now" count="01 · proven" items={LIVE} />
          <Stage tone="week" label="This week" count="02 · next" items={WEEK} />
          <Stage tone="next" label="Next, with licensed partners" count="03 · horizon" items={NEXT} />
        </div>
      </Reveal>
    </section>
  );
}
