import Link from "next/link";
import type { ReactNode } from "react";
import { PaidStamp } from "./paid-stamp";

/**
 * THE TESTER TICKET: one person's try, as a receipt with a tear line. It moves through
 * took a place → answered → checking → paid (the stamp lands, and the ticket opens its receipt) or
 * not paid (with the reason). The handle is whatever names the person honestly: an X handle, or a
 * shortened wallet.
 */
export type TicketState = "took-a-place" | "answered" | "checking" | "paid" | "not-paid";

const STATE_WORDS: Record<TicketState, string> = {
  "took-a-place": "Took a place",
  answered: "Answered",
  checking: "Sage is checking the answer",
  paid: "Checked and paid",
  "not-paid": "Not paid",
};

export interface TicketProps {
  handle: string;
  /** the first line is words (a mission's title on your own record), not a handle */
  words?: boolean;
  state: TicketState;
  /** what this place pays, already formatted: "$2.00" */
  amount: string;
  /** why it was not paid, in Sage's own words */
  reason?: string | null;
  /** one quiet line: the product, when it happened */
  meta?: ReactNode;
  /** the receipt, for a paid ticket */
  href?: string;
  /** true only on the render where this ticket becomes paid */
  land?: boolean;
  /** the builder, not Sage, reads this test's answers (a test Sage designed with no model): said on a waiting ticket */
  byBuilder?: boolean;
  /** the whole ticket opens something on the page (the builder opens a person's try); takes the place of `href` */
  onOpen?: () => void;
  /** Sage read this answer and held it for the builder, who is the one reading this ticket */
  heldForYou?: boolean;
}

export function Ticket({ handle, words, state, amount, reason, meta, href, land, byBuilder, onOpen, heldForYou }: TicketProps) {
  const inner = (
    <>
      <span className="sg-ticket-body">
        <span className="sg-ticket-handle" data-words={words || undefined}>
          {handle}
        </span>
        <span className="sg-ticket-state">
          {state === "not-paid" ? (
            <>
              <b>Not paid</b>
              {reason ? `: ${reason}` : ""}
            </>
          ) : heldForYou && state === "checking" ? (
            "Held for you to read"
          ) : byBuilder && state === "checking" ? (
            "Waiting for the builder to read the answer"
          ) : byBuilder && state === "paid" ? (
            "Read by the builder and paid"
          ) : (
            STATE_WORDS[state]
          )}
        </span>
        {meta ? <span className="sg-ticket-meta">{meta}</span> : null}
      </span>
      <span className="sg-ticket-stub">
        <span className="sg-ticket-amount">{amount}</span>
        {state === "paid" ? <PaidStamp land={land} seed={href ?? handle} size={56} /> : null}
      </span>
    </>
  );
  if (onOpen) {
    return (
      <button type="button" className="sg-ticket" data-state={state} onClick={onOpen} aria-label={`${handle}, ${STATE_WORDS[state].toLowerCase()}, ${amount}. Open their try.`}>
        {inner}
      </button>
    );
  }
  if (href) {
    return (
      <Link href={href} className="sg-ticket" data-state={state} aria-label={`${handle}, ${STATE_WORDS[state].toLowerCase()}, ${amount}. Open the receipt.`}>
        {inner}
      </Link>
    );
  }
  return (
    <div className="sg-ticket" data-state={state}>
      {inner}
    </div>
  );
}
