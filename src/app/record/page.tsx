import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Braces, Users, Wallet } from "lucide-react";
import { ReadHead, ReadPage } from "@/components/site/read-page";
import { getSessionAddress } from "@/lib/auth/session";
import { getStarknetSessionAddress } from "@/lib/auth/starknet-session";
import { buildWalletRecord } from "@/lib/campaigns/record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verified work records: proof of work anyone can check",
  description:
    "Every payout Sage makes adds a line to the person's own record of verified work: what they were paid for, when and by whom, each line anchored to an on-chain receipt. Open any record, share it, or print a statement.",
  alternates: { canonical: "/record" },
};

/** A wallet as Sage stores records under it: an Ethereum address, or a Starknet one. */
const WALLET = /^0x[0-9a-f]{1,64}$/;

/**
 * THE RECORDS, AS ONE PLACE (20 Oct 2026; reframed at the relaunch, 20 Nov 2026). A record lives at
 * /record/<wallet>; this is the page above it: what a record holds, who reads it and a lookup that works
 * without JavaScript. The advance was retired at the relaunch, so a record is proof of work, not a
 * credit file: the person's own history of paid, checked work.
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
      <ReadHead eyebrow="Records" title="Every payout leaves a record that is yours.">
        <p className="lead">
          For many people the work is real and nothing proves it. Sage checks the work before it pays, so each payout
          adds a verified line to the person&apos;s own record, anchored to a receipt anyone can check.
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
              <p>The record is theirs: share the link, print the statement, and take it from one job to the next. Working through Sage is free, always.</p>
              <Link href="/earn" className="more">
                Find a paid test
              </Link>
            </div>
            <div className="read-card">
              <span className="card-icon">
                <Users size={18} strokeWidth={1.75} />
              </span>
              <h3>Anyone they show it to</h3>
              <p>A builder choosing testers, a team, a programme or an employer: every line checks against the chain without taking Sage&apos;s word for it.</p>
              <Link href="/ledger" className="more">
                Open the ledger
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
            printed copy to the live record, so anyone can check that nothing was edited. It opens from any record, at{" "}
            <code>/record/&lt;wallet&gt;/statement</code>.
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
