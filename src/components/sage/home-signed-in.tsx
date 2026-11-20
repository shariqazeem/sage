import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { homeTests } from "@/lib/site/home-tests";
import { whenAgo } from "@/lib/site/when";
import { EmptyState } from "./empty-state";
import { PasteBox } from "./paste-box";
import { TestCard } from "./test-card";

/** "2 live, 1 ready for you": the list in one line, from the cards themselves. */
function summary(states: string[]): string | null {
  const n = (s: string) => states.filter((x) => x === s).length;
  const parts = [
    n("question") + n("ready") > 0 ? `${n("question") + n("ready")} waiting for you` : null,
    n("trying") > 0 ? `${n("trying")} being tried` : null,
    n("live") > 0 ? `${n("live")} live` : null,
    n("done") > 0 ? `${n("done")} done` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/**
 * HOME, SIGNED IN: Tests. The paste box, compact, then everything you started as live cards, with
 * what needs you first. Nothing here is a setting or a statistic: each card is a test, and it opens.
 */
export function HomeSignedIn({ founder }: { founder: string }) {
  const { tests, more } = homeTests(founder);
  const line = summary(tests.map((t) => t.state));

  return (
    <>
      <section className="sg-wrap sg-home-top">
        <div className="sg-row-head">
          <h1 className="sg-title">Your tests</h1>
          {line ? <p className="sg-small">{line}</p> : null}
        </div>
        <PasteBox compact />
      </section>

      <section className="sg-wrap sg-home-list" aria-label="Your tests">
        {tests.length === 0 ? (
          <EmptyState
            title="Paste a link to start your first test."
            action={
              <Link className="sg-link" href="/earn">
                Here to earn? See open tests <ArrowRight size={16} aria-hidden />
              </Link>
            }
          >
            Sage tries your product first. Then real people do, and each is paid only for an honest try.
          </EmptyState>
        ) : (
          <>
            <div className="sg-cards">
              {tests.map((t) => (
                <TestCard key={t.key} href={t.href} host={t.host} state={t.state} line={t.line} places={t.places} event={t.event} when={whenAgo(t.at)} />
              ))}
            </div>
            {more > 0 ? (
              <Link className="sg-link" href="/workspace/jobs">
                {more} more in Jobs <ArrowRight size={16} aria-hidden />
              </Link>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
