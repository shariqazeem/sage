import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { marketplace } from "@/lib/campaigns/marketplace";
import { short } from "@/lib/format";
import { sageNumbers } from "@/lib/numbers/sage-numbers";
import { showableReceipts } from "@/lib/site/live-work";
import { DEFAULT_TEST } from "@/lib/site/paste-link";
import { realTest } from "@/lib/site/real-test";
import { testPath } from "@/lib/site/test-path";
import { count, dayOf, dollars, howLong, whenAgo } from "@/lib/site/when";
import { SAGE_X_URL } from "@/components/site/site-footer";
import { ButtonLink } from "./button";
import { Frame } from "./frame";
import { PasteBox } from "./paste-box";
import { Ticket } from "./ticket";

/** "a", "a and b", "a, b and c": mission titles inside a sentence. */
function listed(items: string[]): string {
  const q = items.map((t) => `“${t}”`);
  if (q.length <= 1) return q[0] ?? "";
  return `${q.slice(0, -1).join(", ")} and ${q[q.length - 1]}`;
}

/**
 * HOME, SIGNED OUT. One box, then the product doing its job with real data: a test Sage really ran,
 * what it has really paid, and the way in for people who want to earn. Every number is read at
 * request time from the same derivations the ledger uses; a section with nothing real to show is
 * left out, never filled in.
 */
export function HomeSignedOut() {
  const test = realTest();
  const numbers = sageNumbers();
  const latest = showableReceipts(1)[0] ?? null;
  const open = marketplace().totals;
  // Sage answers a tag on X only once the founder has switched that on; until then the line is not shown.
  const tagOnX = process.env.X_REPLIES === "on";

  return (
    <>
      <section className="sg-col sg-open sg-hero">
        <h1 className="sg-display">Real people try what you built.</h1>
        <p className="sg-lead">Paste your link. Sage tries it first, brings real people to try it, pays each one for an honest try, and shows you where they got stuck.</p>
        <PasteBox
          note={
            <>
              A test is {DEFAULT_TEST.people} people at {dollars(DEFAULT_TEST.eachUsd)} each. Sage only reads your product, and nothing is paid until you say so.
            </>
          }
        />
        {tagOnX ? (
          <p className="sg-small">
            or tag{" "}
            <a className="sg-link" href={SAGE_X_URL} target="_blank" rel="noreferrer">
              @sagepaysai
            </a>{" "}
            with your link on X
          </p>
        ) : null}
      </section>

      {test ? (
        <section className="sg-wrap sg-section" aria-labelledby="real-test">
          <div className="sg-real-head">
            <p className="sg-label">A real test · {dayOf(test.at)}</p>
            <h2 className="sg-title" id="real-test">
              Sage tried <span className="sg-mono">{test.host}</span> the way a stranger would: <span className="sg-n">{count(test.steps, "step", "steps")}</span>
              {test.seconds ? (
                <>
                  {" "}
                  in <span className="sg-n">{howLong(test.seconds)}</span>
                </>
              ) : null}
              .
            </h2>
          </div>
          <div className="sg-shots" data-count={test.frames.length}>
            {test.frames.map((f, i) => (
              <Frame key={f.n} n={f.n} url={f.url} src={f.src} note={f.note} saw={f.saw} priority={i === 0} />
            ))}
          </div>
          <div className="sg-real-after">
            {test.missions.length > 0 ? (
              <p className="sg-text sg-measure">
                From what it saw, it wrote {count(test.missions.length, "mission", "missions")} for people: {listed(test.missions.slice(0, 3))}.
              </p>
            ) : null}
            {test.people.length > 0 ? (
              <div className="sg-tickets">
                {test.people.map((p, i) => (
                  <Ticket key={i} handle={p.handle} state={p.state} amount={dollars(p.amount)} href={p.proofPath ?? undefined} />
                ))}
              </div>
            ) : null}
            <Link className="sg-link" href={testPath(test.inspectionId)}>
              Open this test <ArrowRight size={16} aria-hidden />
            </Link>
          </div>
        </section>
      ) : null}

      {numbers.payouts > 0 ? (
        <section className="sg-wrap sg-section" aria-labelledby="so-far">
          <div className="sg-split">
            <div className="sg-split-words">
              <p className="sg-label">So far</p>
              <h2 className="sg-title" id="so-far">
                Sage has paid <span className="sg-n">{count(numbers.people, "person", "people")}</span> <span className="sg-n">{dollars(numbers.paidUsd)}</span> for work it checked
                {numbers.refused > 0 ? (
                  <>
                    , and turned down <span className="sg-n">{count(numbers.refused, "answer", "answers")}</span> with a reason
                  </>
                ) : null}
                .
              </h2>
              <p className="sg-text">A vault on Metis decides what can be paid, not the AI. Every payout has a public receipt, and every refusal says why.</p>
              <Link className="sg-link" href="/ledger">
                See the ledger <ArrowRight size={16} aria-hidden />
              </Link>
            </div>
            {latest ? (
              <div className="sg-stack sg-gap-3">
                <p className="sg-label">The latest payout</p>
                <Ticket
                  handle={latest.recipient ? short(latest.recipient) : "A tester"}
                  state="paid"
                  amount={dollars(latest.amountUsd)}
                  meta={`${latest.network} · ${whenAgo(latest.at)}`}
                  href={`/proof/${latest.txHash}`}
                />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="sg-wrap sg-section" aria-labelledby="earn">
        <hr className="sg-rule" />
        <div className="sg-split sg-earn-invite">
          <div className="sg-split-words">
            <p className="sg-label">Earn</p>
            <h2 className="sg-title" id="earn">
              Get paid to try new products.
            </h2>
            <p className="sg-text">
              {open.slots > 0 ? (
                <>
                  <span className="sg-n">{count(open.slots, "place", "places")}</span> open right now across <span className="sg-n">{count(open.missions, "test", "tests")}</span>. Try one, answer honestly, and Sage pays you in USDC once it has checked.
                </>
              ) : (
                <>No tests are open right now. Sage can tell you when the next one opens.</>
              )}
            </p>
          </div>
          <div>
            <ButtonLink href="/earn" variant="quiet">
              See open tests <ArrowRight size={16} aria-hidden />
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
