import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Braces, Landmark, Users, Wallet } from "lucide-react";
import { ReadHead, ReadPage } from "@/components/site/read-page";
import { getSessionAddress } from "@/lib/auth/session";
import { getStarknetSessionAddress } from "@/lib/auth/starknet-session";
import { buildWalletRecord } from "@/lib/campaigns/record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verified work records: income anyone can check",
  description:
    "Every payout Sage makes adds a line to the person's own record of verified work: what they were paid for, when and by whom, each line anchored to an on-chain receipt. Open any record, print a statement, or read it as a lender.",
  alternates: { canonical: "/record" },
};

/** A wallet as Sage stores records under it: an Ethereum address, or a Starknet one. */
const WALLET = /^0x[0-9a-f]{1,64}$/;

/**
 * THE RECORDS, AS ONE PLACE (20 Oct 2026). A record lives at /record/<wallet>; this is the page above
 * it: what a record holds, who reads it (the person, their team, a lender, a program) and a lookup that
 * works without JavaScript. The credit story the old landing told lives here now, so it is one link
 * from the home page, the footer, Team and the lender's view instead of nowhere.
 */
export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = (Array.isArray(params.wallet) ? (params.wallet[0] ?? "") : (params.wallet ?? "")).trim().toLowerCase().slice(0, 80);
  if (raw && WALLET.test(raw)) redirect(`/record/${raw}`);
  const bad = raw !== "";

  // The signed-in person's own record, when they have one: the first thing they came for.
  const [evm, starknet] = await Promise.all([getSessionAddress(), getStarknetSessionAddress()]);
  const mine = [evm, starknet]
    .filter((w): w is NonNullable<typeof w> => !!w)
    .map((w) => buildWalletRecord(w))
    .find((rec) => rec && rec.completions > 0);

  return (
    <ReadPage>
      <ReadHead eyebrow="Records" title="Every payout leaves a record a lender can read.">
        <p className="lead">
          For many people the work is real and the paperwork doesn&apos;t exist: no payslip, no filings, no credit file.
          Sage checks the work before it pays, so each payout adds a verified line to the person&apos;s own record,
          anchored to a receipt anyone can check.
        </p>
      </ReadHead>

      <div className="site-wrap read-col">
        <section className="read-sec" id="find">
          <h2>Open a record</h2>
          <p>Paste a wallet address. Every record is public unless its owner withholds the amounts, and even then the counts, dates and transactions stay checkable.</p>
          <form className="read-lookup" action="/record" method="get">
            <input
              id="wallet"
              name="wallet"
              aria-label="Wallet address"
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="0x… wallet address"
              defaultValue={bad ? raw : undefined}
              aria-invalid={bad || undefined}
              aria-describedby="wallet-msg"
            />
            <button type="submit" className="btn btn-primary">
              Open record
            </button>
          </form>
          <p id="wallet-msg" className={bad ? "read-lookup-msg bad" : "read-lookup-msg"}>
            {bad ? (
              <>That isn&apos;t a wallet address. Paste one that starts with 0x.</>
            ) : mine ? (
              <>
                Signed in: <Link href={`/record/${mine.wallet}`}>open your own record</Link> ({mine.completions} verified{" "}
                {mine.completions === 1 ? "payment" : "payments"}).
              </>
            ) : (
              <>
                Or start from any payout on the <Link href="/ledger">ledger</Link>: every receipt links to the record of
                the person it paid.
              </>
            )}
          </p>
        </section>

        <section className="read-sec" id="contents">
          <h2>What a record holds</h2>
          <ul>
            <li>
              <strong>Every verified payout</strong>: the job, who paid, the amount, the date and the transaction, each
              line linked to its receipt. Real money only.
            </li>
            <li>
              <strong>Income signals</strong>: verified income over 30 and 90 days, distinct payers, months active, the
              share of work that passed, and how much came from the largest payer. Published formulas, never a score.
            </li>
            <li>
              <strong>Linked wallets</strong>: a person or a business paid on more than one network can join their wallets
              into one record.
            </li>
            <li>
              <strong>Advances</strong> drawn against the record, and how each was repaid.
            </li>
          </ul>
          <p>The person decides whether the amounts are public. Sage never makes that choice for them.</p>
        </section>

        <section className="read-sec" id="readers">
          <h2>Who reads it</h2>
          <div className="read-cards">
            <div className="read-card">
              <span className="card-icon">
                <Wallet size={18} strokeWidth={1.75} />
              </span>
              <h3>The person paid</h3>
              <p>The record is theirs: share the link, print the statement, and keep it from one team to the next. Working through Sage is free, always.</p>
              <Link href="/marketplace" className="more">
                Find paid work
              </Link>
            </div>
            <div className="read-card">
              <span className="card-icon">
                <Users size={18} strokeWidth={1.75} />
              </span>
              <h3>Teams</h3>
              <p>On Team, every member&apos;s record and statement are one click away. From Pro, export every payout your team has made as a spreadsheet.</p>
              <Link href="/workspace/people" className="more">
                Open Team
              </Link>
            </div>
            <div className="read-card">
              <span className="card-icon">
                <Landmark size={18} strokeWidth={1.75} />
              </span>
              <h3>Lenders and programs</h3>
              <p>Paste a wallet to see its verified income and the published arithmetic for what can be advanced against it. The lender sets the multiple.</p>
              <Link href="/lender" className="more">
                The lender&apos;s view
              </Link>
            </div>
            <div className="read-card">
              <span className="card-icon">
                <Braces size={18} strokeWidth={1.75} />
              </span>
              <h3>Developers</h3>
              <p>
                <code>GET /api/record/&lt;wallet&gt;</code> returns the record as JSON, and <code>/export</code> as CSV. No
                key is needed to read a public record.
              </p>
              <Link href="/docs/build#api" className="more">
                Build on Sage
              </Link>
            </div>
          </div>
        </section>

        <section className="read-sec" id="statement">
          <h2>The statement</h2>
          <p>
            Every record prints as a verified income statement: the period, each verified payment with its payer and
            transaction, total and 90-day income, the pass rate and months active. A digest at the bottom matches a
            printed copy to the live record, so a bank can check that nothing was edited. It opens from any record, at{" "}
            <code>/record/&lt;wallet&gt;/statement</code>.
          </p>
        </section>

        <section className="read-sec" id="advance">
          <h2>The advance</h2>
          <p>
            A lender supplies the multiple; Sage applies it to verified 90-day income and publishes the arithmetic. An
            advance drawn against the record is repaid from the person&apos;s next verified payouts, so the money can move
            before the next job clears, under the same limits that release every other dollar.
          </p>
        </section>

        <div className="read-foot">
          <p>
            Records are built from the same settled transactions as the <Link href="/ledger">ledger</Link>. What they add
            up to across everyone is on <Link href="/outcomes">outcomes</Link>.
          </p>
        </div>
      </div>
    </ReadPage>
  );
}
